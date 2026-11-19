import { CardDensity, NodePosition, ProjectConfig } from '../core/config';
import { Schema, Table } from '../core/model';
import { DEFAULT_LAYOUT_CONFIG, LayoutConfig, NodeBox } from './sugiyama';

export interface Point {
  x: number;
  y: number;
}

export interface RoutedEdge {
  points: Point[];
  fromSide: 'left' | 'right';
  toSide: 'left' | 'right';
}

export function getVisibleColumnLimit(
  density: CardDensity,
  isExpanded: boolean,
  totalColumns: number,
): number {
  if (density === 'compact') return 0;
  if (density === 'detailed' || isExpanded) return totalColumns;
  // Standard density: concise top 4 columns
  return Math.min(4, totalColumns);
}

export function computeDensityTableHeight(
  table: Table,
  density: CardDensity,
  isExpanded: boolean,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): number {
  if (density === 'compact') {
    return config.headerHeight + 6;
  }
  const limit = getVisibleColumnLimit(density, isExpanded, table.columns.length);
  const shownCols = Math.min(table.columns.length, limit);
  const hasMore = density === 'standard' && table.columns.length > 4 ? 1 : 0;
  return config.headerHeight + (shownCols + hasMore) * config.rowHeight + config.footerPadding;
}

/**
 * Track D2: Compute exact Y coordinate of a column's row on a rendered table card.
 * Falls back to header center when the card is compact or the column is hidden below the fold.
 */
export function getColumnAnchorY(
  table: Table | undefined,
  box: NodeBox,
  columnName: string | undefined,
  density: CardDensity,
  isExpanded: boolean,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): number {
  if (!table || !columnName || density === 'compact') {
    return box.y + Math.min(config.headerHeight * 0.5, box.height * 0.5);
  }
  const limit = getVisibleColumnLimit(density, isExpanded, table.columns.length);
  const idx = table.columns.findIndex((c) => c.name === columnName);
  if (idx < 0 || idx >= limit) {
    // Hidden below fold -> anchor to card footer or header
    return box.y + Math.min(config.headerHeight * 0.5, box.height * 0.5);
  }
  // Matches ErCanvas rendering: rowY = y + hdrH + 4 + idx * rowHeight, vertical center = +10
  return box.y + config.headerHeight + 4 + idx * config.rowHeight + config.rowHeight * 0.45;
}

function segmentIntersectsRect(
  p1: Point,
  p2: Point,
  rect: NodeBox,
  margin = 2,
): boolean {
  const rx1 = rect.x - margin;
  const ry1 = rect.y - margin;
  const rx2 = rect.x + rect.width + margin;
  const ry2 = rect.y + rect.height + margin;

  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);

  // Axis-aligned orthogonal segment test
  if (Math.abs(p1.x - p2.x) < 1e-4) {
    // Vertical segment
    return p1.x > rx1 && p1.x < rx2 && maxY > ry1 && minY < ry2;
  }
  if (Math.abs(p1.y - p2.y) < 1e-4) {
    // Horizontal segment
    return p1.y > ry1 && p1.y < ry2 && maxX > rx1 && minX < rx2;
  }
  // Fallback bounding-box check
  return maxX > rx1 && minX < rx2 && maxY > ry1 && minY < ry2;
}

export function countEdgeCardCrossings(points: Point[], unrelatedObstacles: NodeBox[]): number {
  let count = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4) continue;
    for (const obs of unrelatedObstacles) {
      if (segmentIntersectsRect(a, b, obs, 1)) {
        count += 1;
      }
    }
  }
  return count;
}

function polylineLength(pts: Point[]): number {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  }
  return total;
}

function simplifyOrthogonal(pts: Point[]): Point[] {
  if (pts.length <= 2) return pts;
  const dedup: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = dedup[dedup.length - 1];
    if (Math.abs(pts[i].x - prev.x) > 0.25 || Math.abs(pts[i].y - prev.y) > 0.25) {
      dedup.push(pts[i]);
    }
  }
  if (dedup.length <= 2) return dedup;
  const out: Point[] = [dedup[0]];
  for (let i = 1; i < dedup.length - 1; i++) {
    const a = out[out.length - 1];
    const b = dedup[i];
    const c = dedup[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.25 && Math.abs(b.x - c.x) < 0.25;
    const sameY = Math.abs(a.y - b.y) < 0.25 && Math.abs(b.y - c.y) < 0.25;
    if (!sameX && !sameY) {
      out.push(b);
    }
  }
  out.push(dedup[dedup.length - 1]);
  return out;
}

/**
 * Track D1 + D2: Deterministic obstacle-avoiding orthogonal edge router.
 *
 * Guarantees 0 segments crossing unrelated cards by evaluating direct L/Z/U
 * corridors first, then clear inter-row/inter-column channels, and finally
 * clean outer-perimeter channels if dense cards block direct paths.
 */
export function routeOrthogonalEdge(
  fromBox: NodeBox,
  toBox: NodeBox,
  fromY: number,
  toY: number,
  unrelatedObstacles: NodeBox[],
  slotOffset = 0,
): RoutedEdge {
  // Self-loop on right side of card
  if (
    Math.abs(fromBox.x - toBox.x) < 0.5 &&
    Math.abs(fromBox.y - toBox.y) < 0.5 &&
    Math.abs(fromBox.width - toBox.width) < 0.5
  ) {
    const sx = fromBox.x + fromBox.width;
    const sy = Math.max(fromBox.y + 10, Math.min(fromBox.y + fromBox.height - 10, fromY));
    const ey =
      Math.abs(toY - sy) > 10
        ? Math.max(fromBox.y + 10, Math.min(fromBox.y + fromBox.height - 10, toY))
        : Math.min(fromBox.y + fromBox.height - 8, sy + 20);
    const loopX = sx + 22 + (slotOffset % 3) * 8;
    return {
      fromSide: 'right',
      toSide: 'right',
      points: [
        { x: sx, y: sy },
        { x: loopX, y: sy },
        { x: loopX, y: ey },
        { x: sx, y: ey },
      ],
    };
  }

  const clampedFromY = Math.max(fromBox.y + 8, Math.min(fromBox.y + fromBox.height - 8, fromY));
  const clampedToY = Math.max(toBox.y + 8, Math.min(toBox.y + toBox.height - 8, toY));

  // Keep stubs comfortably inside half of typical horizontal gap (hGap = 64 -> half = 32)
  const stub = 12 + (slotOffset % 4) * 4;
  const fromCenter = fromBox.x + fromBox.width * 0.5;
  const toCenter = toBox.x + toBox.width * 0.5;

  // Compute global perimeter bounds across all boxes for guaranteed collision-free fallback channels
  let minX = Math.min(fromBox.x, toBox.x);
  let maxX = Math.max(fromBox.x + fromBox.width, toBox.x + toBox.width);
  let minY = Math.min(fromBox.y, toBox.y);
  let maxY = Math.max(fromBox.y + fromBox.height, toBox.y + toBox.height);
  for (const ob of unrelatedObstacles) {
    if (ob.x < minX) minX = ob.x;
    if (ob.x + ob.width > maxX) maxX = ob.x + ob.width;
    if (ob.y < minY) minY = ob.y;
    if (ob.y + ob.height > maxY) maxY = ob.y + ob.height;
  }

  // Compute row-band Y bounds for fromBox and toBox so horizontal corridors clear taller cards in the same row
  const computeRowBand = (box: NodeBox): { top: number; bottom: number } => {
    let top = box.y;
    let bottom = box.y + box.height;
    let changed = true;
    while (changed) {
      changed = false;
      for (const ob of unrelatedObstacles) {
        if (ob.y < bottom + 4 && ob.y + ob.height > top - 4) {
          if (ob.y < top) {
            top = ob.y;
            changed = true;
          }
          if (ob.y + ob.height > bottom) {
            bottom = ob.y + ob.height;
            changed = true;
          }
        }
      }
    }
    return { top, bottom };
  };

  const fromBand = computeRowBand(fromBox);
  const toBand = computeRowBand(toBox);

  const lanePad = 14 + (slotOffset % 5) * 4;
  const channelPad = 24 + (slotOffset % 6) * 6;

  // Candidate horizontal Y channels (midline, row-band gaps above/below from/to, outer top/bottom)
  const candidateYs = [
    (clampedFromY + clampedToY) * 0.5,
    fromBand.top - lanePad,
    fromBand.bottom + lanePad,
    toBand.top - lanePad,
    toBand.bottom + lanePad,
    fromBox.y - lanePad,
    fromBox.y + fromBox.height + lanePad,
    toBox.y - lanePad,
    toBox.y + toBox.height + lanePad,
    minY - channelPad,
    maxY + channelPad,
  ];

  // Candidate vertical X channels
  const safeLeftX = minX - channelPad - 10;
  const safeRightX = maxX + channelPad + 10;
  const candidateXs = [
    (fromBox.x + fromBox.width + toBox.x) * 0.5,
    (toBox.x + toBox.width + fromBox.x) * 0.5,
    Math.max(fromBox.x + fromBox.width, toBox.x + toBox.width) + stub,
    Math.min(fromBox.x, toBox.x) - stub,
    safeLeftX,
    safeRightX,
  ];

  // Preferred port combinations ordered by natural visual flow
  const sidePairs: Array<['left' | 'right', 'left' | 'right']> =
    toCenter >= fromCenter
      ? [
          ['right', 'left'],
          ['right', 'right'],
          ['left', 'left'],
          ['left', 'right'],
        ]
      : [
          ['left', 'right'],
          ['left', 'left'],
          ['right', 'right'],
          ['right', 'left'],
        ];

  const bestState: { best: { route: RoutedEdge; crossings: number; cost: number } | null } = {
    best: null,
  };

  const evaluate = (
    fromSide: 'left' | 'right',
    toSide: 'left' | 'right',
    rawPts: Point[],
    turnPenalty = 0,
  ) => {
    const pts = simplifyOrthogonal(rawPts);
    const innerPts = pts.length > 2 ? pts.slice(1, -1) : [];
    let crossings = countEdgeCardCrossings(pts, unrelatedObstacles);
    if (innerPts.length >= 2) {
      crossings += countEdgeCardCrossings(innerPts, [fromBox, toBox]);
    }
    const cost = polylineLength(pts) + pts.length * 16 + turnPenalty;
    if (
      !bestState.best ||
      crossings < bestState.best.crossings ||
      (crossings === bestState.best.crossings && cost < bestState.best.cost)
    ) {
      bestState.best = {
        route: { points: pts, fromSide, toSide },
        crossings,
        cost,
      };
    }
  };

  for (let pIdx = 0; pIdx < sidePairs.length; pIdx++) {
    const [fromSide, toSide] = sidePairs[pIdx];
    const sx = fromSide === 'right' ? fromBox.x + fromBox.width : fromBox.x;
    const ex = toSide === 'right' ? toBox.x + toBox.width : toBox.x;
    const sOutX = fromSide === 'right' ? sx + stub : sx - stub;
    const eOutX = toSide === 'right' ? ex + stub : ex - stub;
    const sideBias = pIdx * 12;

    // 1. Direct Z-shape via midpoint X if facing each other cleanly
    if (
      (fromSide === 'right' && toSide === 'left' && sOutX <= eOutX) ||
      (fromSide === 'left' && toSide === 'right' && sOutX >= eOutX)
    ) {
      const midX = (sOutX + eOutX) * 0.5;
      evaluate(
        fromSide,
        toSide,
        [
          { x: sx, y: clampedFromY },
          { x: midX, y: clampedFromY },
          { x: midX, y: clampedToY },
          { x: ex, y: clampedToY },
        ],
        sideBias,
      );
      if (bestState.best && bestState.best.crossings === 0 && pIdx === 0) {
        return bestState.best.route;
      }
    }

    // 2. U-shape via candidate vertical X channels
    for (const cx of candidateXs) {
      const validStart = fromSide === 'right' ? cx >= sx + 6 : cx <= sx - 6;
      const validEnd = toSide === 'right' ? cx >= ex + 6 : cx <= ex - 6;
      if (!validStart || !validEnd) continue;
      evaluate(
        fromSide,
        toSide,
        [
          { x: sx, y: clampedFromY },
          { x: cx, y: clampedFromY },
          { x: cx, y: clampedToY },
          { x: ex, y: clampedToY },
        ],
        sideBias + 10,
      );
    }

    // 3. 5-segment horizontal-corridor route (sOutX -> cy -> eOutX)
    for (const cy of candidateYs) {
      evaluate(
        fromSide,
        toSide,
        [
          { x: sx, y: clampedFromY },
          { x: sOutX, y: clampedFromY },
          { x: sOutX, y: cy },
          { x: eOutX, y: cy },
          { x: eOutX, y: clampedToY },
          { x: ex, y: clampedToY },
        ],
        sideBias + 24,
      );
    }

    if (bestState.best && bestState.best.crossings === 0) {
      return bestState.best.route;
    }
  }

  // 4. Multi-row corridor-to-corridor route via clear vertical gap or outer left/right perimeter
  // Escapes fromBox into its own clear horizontal row band, traverses vertically along a clear X,
  // then enters toBox's clear horizontal row band before stepping into eOutX.
  const fromCorridors = [fromBand.bottom + lanePad, fromBand.top - lanePad];
  const toCorridors = [toBand.top - lanePad, toBand.bottom + lanePad];
  const verticalChannels = [
    safeLeftX,
    safeRightX,
    ...candidateXs,
  ];

  // Also include local inter-card vertical gap midpoints near fromBox/toBox
  const midXBetween = (fromCenter + toCenter) * 0.5;
  verticalChannels.push(midXBetween);
  for (const ob of unrelatedObstacles) {
    if (
      Math.abs(ob.x - midXBetween) < 420 ||
      Math.abs(ob.x + ob.width - midXBetween) < 420
    ) {
      verticalChannels.push(ob.x - 16, ob.x + ob.width + 16);
    }
  }

  for (let pIdx = 0; pIdx < sidePairs.length; pIdx++) {
    const [fSide, tSide] = sidePairs[pIdx];
    const sx = fSide === 'right' ? fromBox.x + fromBox.width : fromBox.x;
    const ex = tSide === 'right' ? toBox.x + toBox.width : toBox.x;
    const sOutX = fSide === 'right' ? sx + stub : sx - stub;
    const eOutX = tSide === 'right' ? ex + stub : ex - stub;

    for (const fyCorr of fromCorridors) {
      for (const tyCorr of toCorridors) {
        for (const vx of verticalChannels) {
          evaluate(
            fSide,
            tSide,
            [
              { x: sx, y: clampedFromY },
              { x: sOutX, y: clampedFromY },
              { x: sOutX, y: fyCorr },
              { x: vx, y: fyCorr },
              { x: vx, y: tyCorr },
              { x: eOutX, y: tyCorr },
              { x: eOutX, y: clampedToY },
              { x: ex, y: clampedToY },
            ],
            44 + pIdx * 8,
          );
        }
      }
    }
    if (bestState.best && bestState.best.crossings === 0) {
      return bestState.best.route;
    }
  }

  return bestState.best!.route;
}

export interface ReloadDiffResult {
  mergedPositions: Record<string, NodePosition>;
  newTableIds: Set<string>;
  removedTableIds: string[];
  changedColumns: Record<string, Set<string>>;
  summaryMessage: string;
}

/**
 * Track D3: Reload current source while keeping existing node positions stable,
 * placing newly added tables near connected neighbors, warning on removed tables,
 * and surfacing lightweight NEW / MOD indicators (without building a full diff view).
 */
export function computeReloadDiff(
  prevSchema: Schema,
  nextSchema: Schema,
  prevPositions: Record<string, NodePosition>,
  baseLayoutNodes: Record<string, NodeBox>,
  nextConfig: ProjectConfig,
): ReloadDiffResult {
  const prevById = new Map<string, Table>(prevSchema.tables.map((t) => [t.id, t]));
  const nextById = new Map<string, Table>(nextSchema.tables.map((t) => [t.id, t]));

  const mergedPositions: Record<string, NodePosition> = {};
  const newTableIds = new Set<string>();
  const removedTableIds: string[] = [];
  const changedColumns: Record<string, Set<string>> = {};

  for (const prevTbl of prevSchema.tables) {
    if (!nextById.has(prevTbl.id)) {
      removedTableIds.push(prevTbl.id);
    }
  }

  // Keep existing coordinates for every surviving table
  let maxX = 40;
  let minY = 40;
  for (const tbl of nextSchema.tables) {
    const prevTbl = prevById.get(tbl.id);
    if (prevTbl) {
      const existingPos =
        prevPositions[tbl.id] ??
        nextConfig.node_positions[tbl.id] ??
        (baseLayoutNodes[tbl.id]
          ? { x: baseLayoutNodes[tbl.id].x, y: baseLayoutNodes[tbl.id].y }
          : null);
      if (existingPos) {
        mergedPositions[tbl.id] = { x: existingPos.x, y: existingPos.y };
        maxX = Math.max(maxX, existingPos.x + 280);
        minY = Math.min(minY, existingPos.y);
      }

      // Detect added or type-changed columns for lightweight badge
      const prevCols = new Map(prevTbl.columns.map((c) => [c.name, c]));
      const modCols = new Set<string>();
      for (const col of tbl.columns) {
        const oldCol = prevCols.get(col.name);
        if (!oldCol || oldCol.data_type !== col.data_type || oldCol.nullable !== col.nullable) {
          modCols.add(col.name);
        }
      }
      if (modCols.size > 0) {
        changedColumns[tbl.id] = modCols;
      }
    } else {
      newTableIds.add(tbl.id);
    }
  }

  // Place new tables near their connected neighbors (or cleanly to the right)
  let fallbackIndex = 0;
  for (const newId of newTableIds) {
    const neighborPos: NodePosition[] = [];
    for (const rel of nextSchema.relations) {
      if (rel.from_table === newId && mergedPositions[rel.to_table]) {
        neighborPos.push(mergedPositions[rel.to_table]);
      } else if (rel.to_table === newId && mergedPositions[rel.from_table]) {
        neighborPos.push(mergedPositions[rel.from_table]);
      }
    }
    if (neighborPos.length > 0) {
      const avgX = neighborPos.reduce((s, p) => s + p.x, 0) / neighborPos.length;
      const avgY = neighborPos.reduce((s, p) => s + p.y, 0) / neighborPos.length;
      mergedPositions[newId] = {
        x: avgX + 290,
        y: avgY + fallbackIndex * 40,
      };
    } else {
      mergedPositions[newId] = {
        x: maxX + 40,
        y: Math.max(40, minY) + fallbackIndex * 180,
      };
    }
    fallbackIndex += 1;
  }

  const changedTablesCount = Object.keys(changedColumns).length;
  const parts: string[] = [];
  if (newTableIds.size > 0) parts.push(`新增 ${newTableIds.size} 张表`);
  if (removedTableIds.length > 0) parts.push(`移除 ${removedTableIds.length} 张表`);
  if (changedTablesCount > 0) parts.push(`${changedTablesCount} 张表字段有更新`);
  const summaryMessage =
    parts.length > 0
      ? `重新读取完成（已保留现有节点布局）：${parts.join('，')}。`
      : '重新读取完成，表结构无变更，节点位置已保持不变。';

  return {
    mergedPositions,
    newTableIds,
    removedTableIds,
    changedColumns,
    summaryMessage,
  };
}
