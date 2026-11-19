import {
  CardDensity,
  ManualRelation,
  ProjectConfig,
  applyConfigToSchema,
  cloneProjectConfig,
  configAddManualRelation,
  configConfirmRelation,
  configRejectRelation,
  configRemoveManualRelation,
  configResetRelation,
  configUpdateManualRelationNote,
  savePersistedConfig,
} from '../core/config';
import { ENABLE_INFERENCE } from '../core/featureFlags';
import { LoadedSource, SourceSpec } from '../core/fixtures';
import {
  AmbiguousColumn,
  DEFAULT_INFER_CONFIG,
  RelationCandidate,
  inferRelations,
} from '../core/infer';
import {
  RelationKind,
  RelationStatus,
  Schema,
  Table,
  cloneSchema,
  tableById,
} from '../core/model';
import {
  Point,
  computeDensityTableHeight,
  computeReloadDiff,
  getColumnAnchorY,
  routeOrthogonalEdge,
} from '../layout/routing';
import {
  DEFAULT_LAYOUT_CONFIG,
  LayoutResult,
  NodeBox,
  focusSubgraph,
  groupedSugiyamaLayout,
  nodeBoxCenter,
  sugiyamaLayout,
} from '../layout/sugiyama';

export const GROUP_NODE_PREFIX = 'group::';
export const GROUP_CARD_WIDTH = 240;
export const GROUP_CARD_HEIGHT = 84;
export const FLASH_DURATION_MS = 1600;

export interface GroupContainer {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  tableCount: number;
}

export type RenderNodeKind =
  | { type: 'table'; tableIdx: number; group: string }
  | { type: 'collapsed_group'; group: string; tableIds: string[] };

export interface RenderNode {
  id: string;
  kind: RenderNodeKind;
  bounds: NodeBox;
}

export interface RenderEdge {
  relationId: string;
  fromNodeIdx: number;
  toNodeIdx: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  label: string;
  kind: RelationKind;
  status: RelationStatus;
  evidence: string[];
  note?: string | null;
  typeMismatch?: boolean;
  missingTarget?: string | null;
  points: Point[];
  fromSide: 'left' | 'right';
  toSide: 'left' | 'right';
}

export interface SceneGraph {
  nodes: RenderNode[];
  edges: RenderEdge[];
  containers: GroupContainer[];
  tableToNode: Record<string, number>;
  highlightedNodes: Set<number>;
  highlightedEdges: Set<number>;
  hasSelectionHighlight: boolean;
  totalWidth: number;
  totalHeight: number;
}

export interface SearchMatch {
  tableId: string;
  tableName: string;
  group: string;
  matchedColumns: string[];
}

export interface AppState {
  schema: Schema;
  rawSql: string | null;
  rawFormat: 'sql' | 'graphql' | 'json';
  sourceLabel: string;
  sourceKey: string;
  sourceSpec: SourceSpec;
  snapshotVersion?: string;
  snapshotTime?: string;
  config: ProjectConfig;
  ambiguous: AmbiguousColumn[];

  cardDensity: CardDensity;
  linkMode: boolean;
  expandedTables: Set<string>;
  selectedTableId: string | null;
  selectedRelationId: string | null;
  hoveredRelationId: string | null;
  searchQuery: string;

  focusMode: boolean;
  focusHops: number;
  autoGroup: boolean;

  baseLayout: LayoutResult;
  layoutMs: number;
  lastError: string | null;
  statusBanner: string | null;

  /** Lightweight D3 reload indicators (no full schema diff view) */
  newTableIds: Set<string>;
  changedColumns: Record<string, Set<string>>;

  flashTable: { tableId: string; startedAt: number } | null;

  scene: SceneGraph;
  version: number;
}

function naiveSingular(word: string): string {
  if (word.endsWith('ies') && word.length >= 5) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length >= 4) {
    return word.slice(0, -1);
  }
  return word;
}

function extractDomainStem(tableName: string): string | null {
  const lower = tableName.toLowerCase();
  const stripped = lower.startsWith('tbl_')
    ? lower.slice(4)
    : lower.startsWith('t_')
      ? lower.slice(2)
      : lower;
  const prefix = stripped.split('_')[0] ?? stripped;
  return prefix.length >= 2 ? naiveSingular(prefix) : null;
}

export function resolveTableGroups(
  schema: Schema,
  config: ProjectConfig,
  autoGroup: boolean,
): Record<string, string> {
  const prefixCounts = new Map<string, number>();
  const stems = new Map<string, string>();

  for (const tbl of schema.tables) {
    if (tbl.domain) continue;
    const stem = extractDomainStem(tbl.name);
    if (stem) {
      prefixCounts.set(stem, (prefixCounts.get(stem) ?? 0) + 1);
      stems.set(tbl.id, stem);
    }
  }

  const result: Record<string, string> = {};
  for (const tbl of schema.tables) {
    const manual = config.table_groups[tbl.id];
    if (manual) {
      result[tbl.id] = manual;
    } else if (autoGroup) {
      if (tbl.domain) {
        result[tbl.id] = tbl.domain;
      } else {
        const stem = stems.get(tbl.id);
        if (stem && (prefixCounts.get(stem) ?? 0) >= 2) {
          result[tbl.id] = stem;
        } else if (tbl.schema !== 'main' && tbl.schema !== 'public') {
          result[tbl.id] = tbl.schema;
        } else {
          result[tbl.id] = 'core';
        }
      }
    } else {
      result[tbl.id] = tbl.schema;
    }
  }
  return result;
}

export function getGroupSummary(state: AppState): Array<[string, string[]]> {
  const resolved = resolveTableGroups(state.schema, state.config, state.autoGroup);
  const groups = new Map<string, string[]>();
  for (const tbl of state.schema.tables) {
    const g = resolved[tbl.id] ?? 'core';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(tbl.id);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export function getSearchMatches(state: AppState): SearchMatch[] {
  const q = state.searchQuery.trim().toLowerCase();
  const groups = resolveTableGroups(state.schema, state.config, state.autoGroup);
  const matches: SearchMatch[] = [];

  for (const tbl of state.schema.tables) {
    const group = groups[tbl.id] ?? 'core';
    if (!q) {
      matches.push({
        tableId: tbl.id,
        tableName: tbl.name,
        group,
        matchedColumns: [],
      });
      continue;
    }
    const tableHit =
      tbl.name.toLowerCase().includes(q) ||
      tbl.id.toLowerCase().includes(q) ||
      (tbl.comment?.toLowerCase().includes(q) ?? false);
    const colHits = tbl.columns
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.comment?.toLowerCase().includes(q) ?? false),
      )
      .map((c) => c.name);
    if (tableHit || colHits.length > 0) {
      matches.push({
        tableId: tbl.id,
        tableName: tbl.name,
        group,
        matchedColumns: colHits,
      });
    }
  }
  return matches;
}

export function formatColumnBadges(
  tbl: Table,
  colName: string,
  fkColumns?: Set<string>,
): string[] {
  const tags: string[] = [];
  if (tbl.primary_key.includes(colName)) tags.push('PK');
  if (fkColumns?.has(colName)) tags.push('FK');
  if (tbl.unique_keys.some((uk) => uk.includes(colName)) && !tbl.primary_key.includes(colName)) {
    tags.push('UQ');
  }
  return tags;
}

function recomputeAmbiguousRemaining(schema: Schema): AmbiguousColumn[] {
  if (!ENABLE_INFERENCE) return [];
  const base = inferRelations(schema, DEFAULT_INFER_CONFIG).ambiguous;
  const resolved = new Set<string>();
  for (const r of schema.relations) {
    if (r.status === 'confirmed') {
      for (const c of r.from_columns) {
        resolved.add(`${r.from_table}::${c}`);
      }
    }
  }
  return base.filter((a) => !resolved.has(`${a.from_table}::${a.from_column}`));
}

export function buildSceneGraph(state: AppState): SceneGraph {
  const visibleIds =
    state.focusMode && state.selectedTableId
      ? focusSubgraph(state.schema, state.selectedTableId, state.focusHops)
      : null;

  const resolvedGroups = resolveTableGroups(state.schema, state.config, state.autoGroup);
  const nodes: RenderNode[] = [];
  const tableToNode: Record<string, number> = {};
  const collapsedMembers = new Map<string, number[]>();

  state.schema.tables.forEach((tbl, tableIdx) => {
    if (visibleIds && !visibleIds.has(tbl.id)) return;
    const group = resolvedGroups[tbl.id] ?? 'core';
    const isCollapsed = state.autoGroup && Boolean(state.config.collapsed_groups[group]);
    if (isCollapsed) {
      if (!collapsedMembers.has(group)) collapsedMembers.set(group, []);
      collapsedMembers.get(group)!.push(tableIdx);
      return;
    }

    const baseBox = state.baseLayout.nodes[tbl.id] ?? {
      x: 40 + (tableIdx % 4) * 290,
      y: 40 + Math.floor(tableIdx / 4) * 200,
      width: DEFAULT_LAYOUT_CONFIG.nodeWidth,
      height: 100,
    };
    const savedPos = state.config.node_positions[tbl.id];
    const x = savedPos ? savedPos.x : baseBox.x;
    const y = savedPos ? savedPos.y : baseBox.y;
    const isExpanded = state.expandedTables.has(tbl.id);
    const height = computeDensityTableHeight(
      tbl,
      state.cardDensity,
      isExpanded,
      DEFAULT_LAYOUT_CONFIG,
    );
    const nodeIdx = nodes.length;
    tableToNode[tbl.id] = nodeIdx;
    nodes.push({
      id: tbl.id,
      kind: { type: 'table', tableIdx, group },
      bounds: { x, y, width: baseBox.width, height },
    });
  });

  // Collapsed group cards
  const sortedCollapsedGroups = Array.from(collapsedMembers.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );
  for (const [group, memberIndices] of sortedCollapsedGroups) {
    const groupId = `${GROUP_NODE_PREFIX}${group}`;
    let sumX = 0;
    let sumY = 0;
    const tableIds: string[] = [];
    for (const tIdx of memberIndices) {
      const tbl = state.schema.tables[tIdx];
      tableIds.push(tbl.id);
      const saved = state.config.node_positions[tbl.id];
      const base = state.baseLayout.nodes[tbl.id];
      const px = saved ? saved.x : base ? base.x : 80;
      const py = saved ? saved.y : base ? base.y : 80;
      sumX += px;
      sumY += py;
    }
    const count = Math.max(1, memberIndices.length);
    const savedGroupPos = state.config.node_positions[groupId];
    const gx = savedGroupPos ? savedGroupPos.x : sumX / count;
    const gy = savedGroupPos ? savedGroupPos.y : sumY / count;

    const nodeIdx = nodes.length;
    for (const tid of tableIds) {
      tableToNode[tid] = nodeIdx;
    }
    nodes.push({
      id: groupId,
      kind: { type: 'collapsed_group', group, tableIds },
      bounds: { x: gx, y: gy, width: GROUP_CARD_WIDTH, height: GROUP_CARD_HEIGHT },
    });
  }

  // Active visible relations (respecting Track F flag)
  const edges: RenderEdge[] = [];
  const seenGroupPairs = new Set<string>();
  const allNodeBoxes = nodes.map((n) => n.bounds);
  const useFastRouting = nodes.length > 260;

  let slotCounter = 0;
  for (const rel of state.schema.relations) {
    if (rel.status === 'rejected') continue;
    if (!ENABLE_INFERENCE && rel.kind === 'inferred') continue;
    if (rel.missing_target) continue;

    const fromNodeIdx = tableToNode[rel.from_table];
    const toNodeIdx = tableToNode[rel.to_table];
    if (fromNodeIdx === undefined || toNodeIdx === undefined) continue;

    const fromNode = nodes[fromNodeIdx];
    const toNode = nodes[toNodeIdx];
    const touchesCollapsed =
      fromNode.kind.type === 'collapsed_group' || toNode.kind.type === 'collapsed_group';
    if (touchesCollapsed && fromNodeIdx === toNodeIdx) continue;

    if (touchesCollapsed) {
      const pairKey = `${fromNodeIdx}:${toNodeIdx}:${rel.kind}`;
      if (seenGroupPairs.has(pairKey)) continue;
      seenGroupPairs.add(pairKey);
    }

    const fromTbl =
      fromNode.kind.type === 'table' ? state.schema.tables[fromNode.kind.tableIdx] : undefined;
    const toTbl =
      toNode.kind.type === 'table' ? state.schema.tables[toNode.kind.tableIdx] : undefined;

    const fromCol = rel.from_columns[0] ?? '';
    const toCol = rel.to_columns[0] ?? '';

    const fromY = getColumnAnchorY(
      fromTbl,
      fromNode.bounds,
      fromCol,
      state.cardDensity,
      fromTbl ? state.expandedTables.has(fromTbl.id) : false,
      DEFAULT_LAYOUT_CONFIG,
    );
    const toY = getColumnAnchorY(
      toTbl,
      toNode.bounds,
      toCol,
      state.cardDensity,
      toTbl ? state.expandedTables.has(toTbl.id) : false,
      DEFAULT_LAYOUT_CONFIG,
    );

    let routed;
    if (useFastRouting) {
      // Keep 500-table benchmark silky smooth: only check obstacles within local bounding corridor
      const minX = Math.min(fromNode.bounds.x, toNode.bounds.x) - 100;
      const maxX = Math.max(fromNode.bounds.x + fromNode.bounds.width, toNode.bounds.x + toNode.bounds.width) + 100;
      const minY = Math.min(fromNode.bounds.y, toNode.bounds.y) - 100;
      const maxY = Math.max(fromNode.bounds.y + fromNode.bounds.height, toNode.bounds.y + toNode.bounds.height) + 100;
      const localObs: NodeBox[] = [];
      for (let i = 0; i < allNodeBoxes.length; i++) {
        if (i === fromNodeIdx || i === toNodeIdx) continue;
        const b = allNodeBoxes[i];
        if (b.x + b.width >= minX && b.x <= maxX && b.y + b.height >= minY && b.y <= maxY) {
          localObs.push(b);
        }
      }
      routed = routeOrthogonalEdge(
        fromNode.bounds,
        toNode.bounds,
        fromY,
        toY,
        localObs,
        slotCounter++,
      );
    } else {
      const obstacles: NodeBox[] = [];
      for (let i = 0; i < allNodeBoxes.length; i++) {
        if (i !== fromNodeIdx && i !== toNodeIdx) obstacles.push(allNodeBoxes[i]);
      }
      routed = routeOrthogonalEdge(
        fromNode.bounds,
        toNode.bounds,
        fromY,
        toY,
        obstacles,
        slotCounter++,
      );
    }

    edges.push({
      relationId: rel.id,
      fromNodeIdx,
      toNodeIdx,
      fromTable: rel.from_table,
      fromColumn: fromCol,
      toTable: rel.to_table,
      toColumn: toCol,
      label: `${rel.from_columns.join(', ')} → ${rel.to_columns.join(', ')}`,
      kind: rel.kind,
      status: rel.status,
      evidence: rel.evidence,
      note: rel.note,
      typeMismatch: rel.type_mismatch,
      missingTarget: rel.missing_target,
      points: routed.points,
      fromSide: routed.fromSide,
      toSide: routed.toSide,
    });
  }

  // 1-hop upstream/downstream highlight
  const highlightedNodes = new Set<number>();
  const highlightedEdges = new Set<number>();
  let hasSelectionHighlight = false;

  if (state.selectedTableId && tableToNode[state.selectedTableId] !== undefined) {
    const selIdx = tableToNode[state.selectedTableId];
    hasSelectionHighlight = true;
    highlightedNodes.add(selIdx);
    edges.forEach((edge, eIdx) => {
      if (edge.fromNodeIdx === selIdx || edge.toNodeIdx === selIdx) {
        highlightedEdges.add(eIdx);
        highlightedNodes.add(edge.fromNodeIdx);
        highlightedNodes.add(edge.toNodeIdx);
      }
    });
  } else if (state.selectedRelationId) {
    edges.forEach((edge, eIdx) => {
      if (edge.relationId === state.selectedRelationId) {
        hasSelectionHighlight = true;
        highlightedEdges.add(eIdx);
        highlightedNodes.add(edge.fromNodeIdx);
        highlightedNodes.add(edge.toNodeIdx);
      }
    });
  }

  // Track D4: Domain group containers with header bar
  const containers: GroupContainer[] = [];
  if (state.autoGroup) {
    const perGroup = new Map<string, NodeBox[]>();
    for (const node of nodes) {
      if (node.kind.type === 'table') {
        const g = node.kind.group;
        if (!perGroup.has(g)) perGroup.set(g, []);
        perGroup.get(g)!.push(node.bounds);
      }
    }
    const sortedEntries = Array.from(perGroup.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, boxes] of sortedEntries) {
      if (boxes.length < 2) continue;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      for (const b of boxes) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
      }
      const pad = 20;
      containers.push({
        name,
        x: minX - pad,
        y: minY - pad - 28,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2 + 28,
        tableCount: boxes.length,
      });
    }
  }

  let maxW = 800;
  let maxH = 600;
  for (const n of nodes) {
    maxW = Math.max(maxW, n.bounds.x + n.bounds.width + 80);
    maxH = Math.max(maxH, n.bounds.y + n.bounds.height + 80);
  }

  return {
    nodes,
    edges,
    containers,
    tableToNode,
    highlightedNodes,
    highlightedEdges,
    hasSelectionHighlight,
    totalWidth: maxW,
    totalHeight: maxH,
  };
}

export function createAppStateFromLoaded(loaded: LoadedSource): AppState {
  const schema = cloneSchema(loaded.schema);
  const config = cloneProjectConfig(loaded.config);
  applyConfigToSchema(config, schema);

  const cardDensity: CardDensity = config.card_density ?? 'standard';
  const ambiguous = recomputeAmbiguousRemaining(schema);
  const t0 = performance.now();
  const resolvedGroups = resolveTableGroups(schema, config, true);
  const baseLayout = groupedSugiyamaLayout(schema, resolvedGroups, {
    ...DEFAULT_LAYOUT_CONFIG,
    maxVisibleCols: cardDensity === 'compact' ? 0 : cardDensity === 'detailed' ? 20 : 4,
  });
  const layoutMs = performance.now() - t0;

  const state: AppState = {
    schema,
    rawSql: loaded.rawSql,
    rawFormat: loaded.rawFormat ?? 'sql',
    sourceLabel: loaded.sourceLabel,
    sourceKey: loaded.sourceKey,
    sourceSpec: loaded.spec,
    snapshotVersion: loaded.snapshotVersion ?? schema.source_meta?.version,
    snapshotTime: loaded.snapshotTime ?? schema.source_meta?.fetched_at,
    config,
    ambiguous,
    cardDensity,
    linkMode: false,
    expandedTables: new Set<string>(),
    selectedTableId: null,
    selectedRelationId: null,
    hoveredRelationId: null,
    searchQuery: '',
    focusMode: false,
    focusHops: 2,
    autoGroup: true,
    baseLayout,
    layoutMs,
    lastError: null,
    statusBanner: null,
    newTableIds: new Set<string>(),
    changedColumns: {},
    flashTable: null,
    scene: {
      nodes: [],
      edges: [],
      containers: [],
      tableToNode: {},
      highlightedNodes: new Set(),
      highlightedEdges: new Set(),
      hasSelectionHighlight: false,
      totalWidth: 800,
      totalHeight: 600,
    },
    version: 1,
  };
  state.scene = buildSceneGraph(state);
  return state;
}

/**
 * Track D3: Reload the current source preserving every existing table's position
 * and surfacing lightweight NEW / MOD badges + removal warning.
 */
export function stateReloadFromLoaded(prev: AppState, loaded: LoadedSource): AppState {
  const nextSchema = cloneSchema(loaded.schema);
  const config = cloneProjectConfig(prev.config);
  applyConfigToSchema(config, nextSchema);

  const resolvedGroups = resolveTableGroups(nextSchema, config, prev.autoGroup);
  const layoutCfg = {
    ...DEFAULT_LAYOUT_CONFIG,
    maxVisibleCols: prev.cardDensity === 'compact' ? 0 : prev.cardDensity === 'detailed' ? 20 : 4,
  };
  const baseLayout = prev.autoGroup
    ? groupedSugiyamaLayout(nextSchema, resolvedGroups, layoutCfg)
    : sugiyamaLayout(nextSchema, layoutCfg);

  // Snapshot current live positions from scene nodes
  const currentPositions: Record<string, { x: number; y: number }> = { ...config.node_positions };
  for (const node of prev.scene.nodes) {
    if (node.kind.type === 'table') {
      currentPositions[node.id] = { x: node.bounds.x, y: node.bounds.y };
    }
  }

  const diff = computeReloadDiff(
    prev.schema,
    nextSchema,
    currentPositions,
    baseLayout.nodes,
    config,
  );
  config.node_positions = diff.mergedPositions;

  if (diff.removedTableIds.length > 0) {
    nextSchema.warnings.push(
      `重新读取发现以下表已从数据源移除：${diff.removedTableIds.join(', ')}`,
    );
  }

  const nextState: AppState = {
    ...prev,
    schema: nextSchema,
    rawSql: loaded.rawSql,
    rawFormat: loaded.rawFormat ?? prev.rawFormat,
    sourceLabel: loaded.sourceLabel,
    snapshotVersion: loaded.snapshotVersion ?? nextSchema.source_meta?.version,
    snapshotTime: loaded.snapshotTime ?? nextSchema.source_meta?.fetched_at,
    config,
    baseLayout,
    newTableIds: diff.newTableIds,
    changedColumns: diff.changedColumns,
    statusBanner: diff.summaryMessage,
    lastError: null,
  };

  return withRebuiltScene(nextState, true);
}

export function withRebuiltScene(state: AppState, persist = false): AppState {
  const next: AppState = {
    ...state,
    version: state.version + 1,
  };
  next.scene = buildSceneGraph(next);
  if (persist) {
    savePersistedConfig(next.sourceKey, next.config);
  }
  return next;
}

export function stateSetCardDensity(state: AppState, density: CardDensity): AppState {
  const config = cloneProjectConfig(state.config);
  config.card_density = density;
  return withRebuiltScene({ ...state, cardDensity: density, config }, true);
}

export function stateAddManualRelation(
  state: AppState,
  manual: ManualRelation,
): { nextState: AppState; relationId: string; typeMismatch: boolean } {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  const relationId = configAddManualRelation(config, manual);
  applyConfigToSchema(config, schema);

  const created = schema.relations.find((r) => r.id === relationId);
  const typeMismatch = Boolean(created?.type_mismatch);

  const fromTbl = tableById(schema, manual.from_table);
  const toTbl = tableById(schema, manual.to_table);
  const banner = typeMismatch
    ? `已创建手动关系（${fromTbl?.name ?? manual.from_table}.${manual.from_columns.join(',')} → ${toTbl?.name ?? manual.to_table}.${manual.to_columns.join(',')}）。注意：两端字段类型族不一致，已保留关系供核对。`
    : `已创建手动关系：${fromTbl?.name ?? manual.from_table}.${manual.from_columns.join(',')} → ${toTbl?.name ?? manual.to_table}.${manual.to_columns.join(',')}`;

  const nextState = withRebuiltScene(
    {
      ...state,
      config,
      schema,
      selectedRelationId: relationId,
      statusBanner: banner,
    },
    true,
  );
  return { nextState, relationId, typeMismatch };
}

export function stateUpdateManualRelationNote(
  state: AppState,
  relationId: string,
  note: string,
): AppState {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  configUpdateManualRelationNote(config, relationId, note);
  applyConfigToSchema(config, schema);
  return withRebuiltScene({ ...state, config, schema }, true);
}

export function stateDeleteManualRelation(state: AppState, relationId: string): AppState {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  configRemoveManualRelation(config, relationId);
  applyConfigToSchema(config, schema);
  const selectedRelationId =
    state.selectedRelationId === relationId ? null : state.selectedRelationId;
  return withRebuiltScene(
    {
      ...state,
      config,
      schema,
      selectedRelationId,
      statusBanner: '已删除该手动关系。',
    },
    true,
  );
}

export function stateResetAutoLayout(state: AppState): AppState {
  const config = cloneProjectConfig(state.config);
  config.node_positions = {};
  const t0 = performance.now();
  const resolvedGroups = resolveTableGroups(state.schema, config, state.autoGroup);
  const layoutCfg = {
    ...DEFAULT_LAYOUT_CONFIG,
    maxVisibleCols: state.cardDensity === 'compact' ? 0 : state.cardDensity === 'detailed' ? 20 : 4,
  };
  const baseLayout = state.autoGroup
    ? groupedSugiyamaLayout(state.schema, resolvedGroups, layoutCfg)
    : sugiyamaLayout(state.schema, layoutCfg);
  const layoutMs = performance.now() - t0;
  return withRebuiltScene({ ...state, config, baseLayout, layoutMs }, true);
}

export function stateConfirmRelation(state: AppState, relationId: string): AppState {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  configConfirmRelation(config, relationId);
  applyConfigToSchema(config, schema);
  return withRebuiltScene({ ...state, config, schema }, true);
}

export function stateRejectRelation(state: AppState, relationId: string): AppState {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  configRejectRelation(config, relationId);
  applyConfigToSchema(config, schema);
  const selectedRelationId =
    state.selectedRelationId === relationId ? null : state.selectedRelationId;
  return withRebuiltScene({ ...state, config, schema, selectedRelationId }, true);
}

export function stateResetRelation(state: AppState, relationId: string): AppState {
  const config = cloneProjectConfig(state.config);
  const schema = cloneSchema(state.schema);
  configResetRelation(config, relationId);
  for (const rel of schema.relations) {
    if (rel.id === relationId && rel.kind === 'inferred') {
      rel.status = 'auto';
    }
  }
  return withRebuiltScene({ ...state, config, schema }, true);
}

export function stateResolveAmbiguous(
  state: AppState,
  fromTable: string,
  fromColumn: string,
  candidate: RelationCandidate,
): AppState {
  return stateAddManualRelation(state, {
    from_table: fromTable,
    from_columns: [fromColumn],
    to_table: candidate.to_table,
    to_columns: [candidate.to_column],
  }).nextState;
}

export function stateSetTableGroup(state: AppState, tableId: string, groupRaw: string): AppState {
  const config = cloneProjectConfig(state.config);
  const groupName = groupRaw.trim();
  if (!groupName) {
    delete config.table_groups[tableId];
  } else {
    config.table_groups[tableId] = groupName;
  }
  return withRebuiltScene({ ...state, config }, true);
}

export function stateToggleGroupCollapsed(state: AppState, groupName: string): AppState {
  const config = cloneProjectConfig(state.config);
  config.collapsed_groups[groupName] = !config.collapsed_groups[groupName];
  return withRebuiltScene({ ...state, config }, true);
}

export function stateToggleTableExpanded(state: AppState, tableId: string): AppState {
  const expandedTables = new Set(state.expandedTables);
  if (expandedTables.has(tableId)) expandedTables.delete(tableId);
  else expandedTables.add(tableId);
  return withRebuiltScene({ ...state, expandedTables });
}

export function stateDropNode(
  state: AppState,
  nodeId: string,
  isTable: boolean,
  x: number,
  y: number,
  zoom: number,
  panX: number,
  panY: number,
): AppState {
  const config = cloneProjectConfig(state.config);
  config.node_positions[nodeId] = { x, y };
  config.viewport = { zoom, pan_x: panX, pan_y: panY };

  if (isTable && state.autoGroup) {
    const nodeIdx = state.scene.tableToNode[nodeId];
    const node = nodeIdx !== undefined ? state.scene.nodes[nodeIdx] : undefined;
    const width = node ? node.bounds.width : 240;
    const height = node ? node.bounds.height : 120;
    const [cxW, cyW] = nodeBoxCenter({ x, y, width, height });
    const currentGroup = resolveTableGroups(state.schema, config, state.autoGroup)[nodeId] ?? 'core';

    for (const n of state.scene.nodes) {
      if (
        n.kind.type === 'collapsed_group' &&
        n.kind.group !== currentGroup &&
        cxW >= n.bounds.x &&
        cxW <= n.bounds.x + n.bounds.width &&
        cyW >= n.bounds.y &&
        cyW <= n.bounds.y + n.bounds.height
      ) {
        config.table_groups[nodeId] = n.kind.group;
        break;
      }
    }

    if (!config.table_groups[nodeId] || config.table_groups[nodeId] === currentGroup) {
      for (const c of state.scene.containers) {
        if (
          c.name !== currentGroup &&
          cxW >= c.x &&
          cxW <= c.x + c.width &&
          cyW >= c.y &&
          cyW <= c.y + c.height
        ) {
          config.table_groups[nodeId] = c.name;
          break;
        }
      }
    }
  }

  return withRebuiltScene({ ...state, config }, true);
}
