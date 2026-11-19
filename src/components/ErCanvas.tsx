import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ManualRelation } from '../core/config';
import { ENABLE_INFERENCE } from '../core/featureFlags';
import { Relation, tableById } from '../core/model';
import {
  Point,
  getColumnAnchorY,
  getVisibleColumnLimit,
  routeOrthogonalEdge,
} from '../layout/routing';
import { DEFAULT_LAYOUT_CONFIG, nodeBoxCenter } from '../layout/sugiyama';
import { AppState, FLASH_DURATION_MS } from '../state/appState';

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.5;
const LOD_FULL_THRESHOLD = 0.45;
const LOD_TITLE_THRESHOLD = 0.18;

export interface ErCanvasHandle {
  fitToView: () => void;
  jumpToTable: (tableId: string, nextState?: AppState) => void;
  resetCameraForNewSource: (nextState: AppState) => void;
}

interface ErCanvasProps {
  state: AppState;
  isDark: boolean;
  onZoomChange: (zoomPct: number) => void;
  onSelectTable: (tableId: string | null) => void;
  onSelectRelation: (relationId: string | null) => void;
  onToggleTableExpanded: (tableId: string) => void;
  onToggleGroupCollapsed: (groupName: string) => void;
  onDropNode: (
    nodeId: string,
    isTable: boolean,
    x: number,
    y: number,
    zoom: number,
    panX: number,
    panY: number,
  ) => void;
  onCreateManualRelation: (manual: ManualRelation) => void;
  onDeleteManualRelation: (relationId: string) => void;
  onClearFlash: () => void;
}

interface CachedColumnRow {
  rawName: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  isUq: boolean;
  nullable: boolean;
  isChanged: boolean;
  comment: string | null;
}

interface CachedTableVisual {
  id: string;
  title: string;
  badgeTag: string | null;
  isView: boolean;
  isNew: boolean;
  comment: string | null;
  rows: CachedColumnRow[];
  footerLabel: string | null;
}

interface ColumnHit {
  nodeIdx: number;
  tableId: string;
  columnName: string;
  typeFamily: string;
  anchorX: number;
  anchorY: number;
  side: 'left' | 'right';
}

interface CommentHoverInfo {
  title: string;
  body: string;
  x: number;
  y: number;
}

type DragMode =
  | { type: 'pan'; lastX: number; lastY: number }
  | {
      type: 'node';
      nodeIdx: number;
      nodeId: string;
      isTable: boolean;
      lastX: number;
      lastY: number;
      curX: number;
      curY: number;
      moved: boolean;
    }
  | {
      type: 'link';
      fromTableId: string;
      fromColumn: string;
      fromTypeFamily: string;
      startWorldX: number;
      startWorldY: number;
      curWorldX: number;
      curWorldY: number;
      target: ColumnHit | null;
    };

function pointToSegDist(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 8) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo > 0 ? `${text.slice(0, lo)}…` : '';
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FONT_STACK =
  'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';

export const ErCanvas = forwardRef<ErCanvasHandle, ErCanvasProps>(
  (
    {
      state,
      isDark,
      onZoomChange,
      onSelectTable,
      onSelectRelation,
      onToggleTableExpanded,
      onToggleGroupCollapsed,
      onDropNode,
      onCreateManualRelation,
      onDeleteManualRelation,
      onClearFlash,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const stateRef = useRef(state);
    stateRef.current = state;

    const isDarkRef = useRef(isDark);
    isDarkRef.current = isDark;

    const cameraRef = useRef({
      zoom:
        state.config.viewport.zoom !== 1 ||
        state.config.viewport.pan_x !== 0 ||
        state.config.viewport.pan_y !== 0
          ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.config.viewport.zoom))
          : state.schema.tables.length > 100
            ? 0.65
            : 1.0,
      panX:
        state.config.viewport.zoom !== 1 ||
        state.config.viewport.pan_x !== 0 ||
        state.config.viewport.pan_y !== 0
          ? state.config.viewport.pan_x
          : 40,
      panY:
        state.config.viewport.zoom !== 1 ||
        state.config.viewport.pan_x !== 0 ||
        state.config.viewport.pan_y !== 0
          ? state.config.viewport.pan_y
          : 40,
    });

    const targetPanRef = useRef<{ x: number; y: number } | null>(null);
    const dragRef = useRef<DragMode | null>(null);
    const dragOverrideRef = useRef<{ nodeIdx: number; x: number; y: number } | null>(null);
    const hoveredEdgeIdxRef = useRef<number | null>(null);
    const hoveredColRef = useRef<ColumnHit | null>(null);

    const [hoveredRelationId, setHoveredRelationId] = useState<string | null>(null);
    const [commentHover, setCommentHover] = useState<CommentHoverInfo | null>(null);
    const [cursorStyle, setCursorStyle] = useState<
      'default' | 'grab' | 'grabbing' | 'pointer' | 'crosshair'
    >('default');
    const rafIdRef = useRef<number | null>(null);

    const cachedTables = useMemo(() => {
      const map = new Map<string, CachedTableVisual>();
      const fkByTable = new Map<string, Set<string>>();
      for (const rel of state.schema.relations) {
        if (rel.status === 'rejected' || (!ENABLE_INFERENCE && rel.kind === 'inferred')) continue;
        if (!fkByTable.has(rel.from_table)) fkByTable.set(rel.from_table, new Set());
        for (const c of rel.from_columns) fkByTable.get(rel.from_table)!.add(c);
      }

      for (const tbl of state.schema.tables) {
        const pkSet = new Set(tbl.primary_key);
        const fkSet = fkByTable.get(tbl.id) ?? new Set<string>();
        const uqSet = new Set(tbl.unique_keys.filter((k) => k.length === 1).map((k) => k[0]));
        const expanded = state.expandedTables.has(tbl.id);
        const limit = getVisibleColumnLimit(state.cardDensity, expanded, tbl.columns.length);
        const changedSet = state.changedColumns[tbl.id];

        const rows: CachedColumnRow[] = tbl.columns.slice(0, limit).map((col) => ({
          rawName: col.name,
          type: col.data_type,
          isPk: pkSet.has(col.name),
          isFk: fkSet.has(col.name),
          isUq: uqSet.has(col.name) && !pkSet.has(col.name),
          nullable: col.nullable,
          isChanged: Boolean(changedSet?.has(col.name)),
          comment: col.comment ?? null,
        }));

        let footerLabel: string | null = null;
        if (state.cardDensity === 'standard' && tbl.columns.length > 4) {
          footerLabel = expanded
            ? '收起字段'
            : `展开其余 ${tbl.columns.length - 4} 个字段`;
        }

        const badgeTag =
          tbl.kind === 'materialized_view'
            ? 'MVIEW'
            : tbl.kind === 'view'
              ? 'VIEW'
              : tbl.is_partition
                ? 'PART'
                : null;

        map.set(tbl.id, {
          id: tbl.id,
          title: tbl.name,
          badgeTag,
          isView: tbl.kind === 'view' || tbl.kind === 'materialized_view',
          isNew: state.newTableIds.has(tbl.id),
          comment: tbl.comment ?? null,
          rows,
          footerLabel,
        });
      }
      return map;
    }, [
      state.schema.tables,
      state.schema.relations,
      state.expandedTables,
      state.cardDensity,
      state.newTableIds,
      state.changedColumns,
    ]);

    const cachedTablesRef = useRef(cachedTables);
    cachedTablesRef.current = cachedTables;

    const getPalette = useCallback(() => {
      if (isDarkRef.current) {
        return {
          canvasBg: '#0b1120',
          cardBg: '#1e293b',
          headerBg: '#273449',
          viewHeaderBg: '#1e3a5f',
          groupBg: 'rgba(30, 41, 59, 0.42)',
          groupHeaderBg: 'rgba(51, 65, 85, 0.65)',
          groupBorder: '#334155',
          cardBorder: '#334155',
          selectedBorder: '#3b82f6',
          flashBorder: '#f59e0b',
          manualLine: '#a78bfa',
          declaredLine: '#94a3b8',
          rowHighlightBg: 'rgba(59, 130, 246, 0.22)',
          manualRowHighlightBg: 'rgba(167, 139, 250, 0.24)',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          fg: '#f1f5f9',
          mutedFg: '#94a3b8',
        };
      }
      return {
        canvasBg: '#f8fafc',
        cardBg: '#ffffff',
        headerBg: '#e2e8f0',
        viewHeaderBg: '#dbeafe',
        groupBg: 'rgba(226, 232, 240, 0.36)',
        groupHeaderBg: 'rgba(203, 213, 225, 0.55)',
        groupBorder: '#cbd5e1',
        cardBorder: '#cbd5e1',
        selectedBorder: '#2563eb',
        flashBorder: '#d97706',
        manualLine: '#7c3aed',
        declaredLine: '#64748b',
        rowHighlightBg: 'rgba(37, 99, 235, 0.14)',
        manualRowHighlightBg: 'rgba(124, 58, 237, 0.14)',
        success: '#16a34a',
        warning: '#d97706',
        danger: '#dc2626',
        fg: '#0f172a',
        mutedFg: '#64748b',
      };
    }, []);

    const paint = useCallback(() => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const rect = container.getBoundingClientRect();
      const vw = Math.max(1, rect.width);
      const vh = Math.max(1, rect.height);
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(vw * dpr);
      const targetH = Math.round(vh * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);

      const st = stateRef.current;
      const scene = st.scene;
      const { zoom, panX, panY } = cameraRef.current;
      const pal = getPalette();
      const dragOv = dragOverrideRef.current;
      const drag = dragRef.current;

      // Clear background
      ctx.fillStyle = pal.canvasBg;
      ctx.fillRect(0, 0, vw, vh);

      // Viewport culling bounds in world space
      const viewLeft = -panX / zoom - 160;
      const viewTop = -panY / zoom - 160;
      const viewRight = (vw - panX) / zoom + 160;
      const viewBottom = (vh - panY) / zoom + 160;

      const getNodeBounds = (idx: number) => {
        const b = scene.nodes[idx].bounds;
        if (dragOv && dragOv.nodeIdx === idx) {
          return { x: dragOv.x, y: dragOv.y, width: b.width, height: b.height };
        }
        return b;
      };

      // Active hovered or selected edge endpoints for Track D2 column highlighting
      const hoveredEdgeIdx = hoveredEdgeIdxRef.current;
      const activeEndpointCols = new Map<string, { col: string; isManual: boolean }>();
      const activeEdge =
        hoveredEdgeIdx !== null
          ? scene.edges[hoveredEdgeIdx]
          : st.selectedRelationId
            ? scene.edges.find((e) => e.relationId === st.selectedRelationId)
            : undefined;
      if (activeEdge) {
        activeEndpointCols.set(activeEdge.fromTable, {
          col: activeEdge.fromColumn,
          isManual: activeEdge.kind === 'manual',
        });
        activeEndpointCols.set(activeEdge.toTable, {
          col: activeEdge.toColumn,
          isManual: activeEdge.kind === 'manual',
        });
      }

      // 1. Track D4: Domain Group Containers with Titled Header Bar + Collapse Button
      for (const containerBox of scene.containers) {
        if (
          containerBox.x + containerBox.width < viewLeft ||
          containerBox.x > viewRight ||
          containerBox.y + containerBox.height < viewTop ||
          containerBox.y > viewBottom
        ) {
          continue;
        }
        const gx = panX + containerBox.x * zoom;
        const gy = panY + containerBox.y * zoom;
        const gw = containerBox.width * zoom;
        const gh = containerBox.height * zoom;
        const rad = Math.max(4, Math.min(12, 10 * zoom));
        const hdrH = Math.max(16, Math.min(28, 24 * zoom));

        ctx.save();
        drawRoundedRect(ctx, gx, gy, gw, gh, rad);
        ctx.fillStyle = pal.groupBg;
        ctx.fill();
        ctx.clip();

        if (zoom >= LOD_TITLE_THRESHOLD) {
          ctx.fillStyle = pal.groupHeaderBg;
          ctx.fillRect(gx, gy, gw, hdrH);

          const labelPx = Math.max(8, Math.min(12, 11 * zoom));
          ctx.font = `600 ${labelPx}px ${FONT_STACK}`;
          ctx.fillStyle = pal.fg;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          const lbl = `${containerBox.name} · ${containerBox.tableCount} 张表`;
          ctx.fillText(truncateText(ctx, lbl, Math.max(20, gw - 36 * zoom)), gx + 10 * zoom, gy + hdrH * 0.5);

          // Collapse button icon "−" on top-right of container header
          if (zoom >= LOD_FULL_THRESHOLD) {
            const btnSize = 16 * zoom;
            const bx = gx + gw - btnSize - 6 * zoom;
            const by = gy + (hdrH - btnSize) * 0.5;
            drawRoundedRect(ctx, bx, by, btnSize, btnSize, 3 * zoom);
            ctx.fillStyle = pal.cardBg;
            ctx.fill();
            ctx.strokeStyle = pal.groupBorder;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = pal.mutedFg;
            ctx.font = `700 ${Math.max(9, 11 * zoom)}px ${FONT_STACK}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('−', bx + btnSize * 0.5, by + btnSize * 0.5);
          }
        }
        ctx.restore();

        drawRoundedRect(ctx, gx, gy, gw, gh, rad);
        ctx.lineWidth = 1;
        ctx.strokeStyle = pal.groupBorder;
        ctx.stroke();
      }

      // 2. Track D1 + D2: Obstacle-Avoiding Orthogonal Edges anchored to Column Rows
      for (let edgeIdx = 0; edgeIdx < scene.edges.length; edgeIdx++) {
        const edge = scene.edges[edgeIdx];
        const isDraggedEndpoint =
          dragOv !== null && (dragOv.nodeIdx === edge.fromNodeIdx || dragOv.nodeIdx === edge.toNodeIdx);

        let pts: Point[] = edge.points;
        if (isDraggedEndpoint) {
          // Live lightweight re-route while user drags a table
          const fromB = getNodeBounds(edge.fromNodeIdx);
          const toB = getNodeBounds(edge.toNodeIdx);
          const fromNode = scene.nodes[edge.fromNodeIdx];
          const toNode = scene.nodes[edge.toNodeIdx];
          const fromTbl =
            fromNode.kind.type === 'table' ? st.schema.tables[fromNode.kind.tableIdx] : undefined;
          const toTbl =
            toNode.kind.type === 'table' ? st.schema.tables[toNode.kind.tableIdx] : undefined;
          const fy = getColumnAnchorY(
            fromTbl,
            fromB,
            edge.fromColumn,
            st.cardDensity,
            fromTbl ? st.expandedTables.has(fromTbl.id) : false,
            DEFAULT_LAYOUT_CONFIG,
          );
          const ty = getColumnAnchorY(
            toTbl,
            toB,
            edge.toColumn,
            st.cardDensity,
            toTbl ? st.expandedTables.has(toTbl.id) : false,
            DEFAULT_LAYOUT_CONFIG,
          );
          pts = routeOrthogonalEdge(fromB, toB, fy, ty, [], edgeIdx).points;
        }

        if (pts.length < 2) continue;

        let eMinX = Number.POSITIVE_INFINITY;
        let eMaxX = Number.NEGATIVE_INFINITY;
        let eMinY = Number.POSITIVE_INFINITY;
        let eMaxY = Number.NEGATIVE_INFINITY;
        for (const p of pts) {
          if (p.x < eMinX) eMinX = p.x;
          if (p.x > eMaxX) eMaxX = p.x;
          if (p.y < eMinY) eMinY = p.y;
          if (p.y > eMaxY) eMaxY = p.y;
        }
        if (eMaxX < viewLeft || eMinX > viewRight || eMaxY < viewTop || eMinY > viewBottom) {
          continue;
        }

        const isHovered = hoveredEdgeIdx === edgeIdx;
        const isEdgeSelected = st.selectedRelationId === edge.relationId;
        const isHl = isHovered || isEdgeSelected || scene.highlightedEdges.has(edgeIdx);
        const dim = scene.hasSelectionHighlight && !isHl;
        const isManual = edge.kind === 'manual';

        let baseColor = isManual ? pal.manualLine : pal.declaredLine;
        if (isHovered || isEdgeSelected) {
          baseColor = isManual ? pal.manualLine : pal.selectedBorder;
        }

        const strokeW =
          isHovered || isEdgeSelected
            ? Math.max(1.8, Math.min(3.8, 2.6 * zoom))
            : isHl && scene.hasSelectionHighlight
              ? Math.max(1.5, Math.min(3.0, 2.2 * zoom))
              : Math.max(1.1, Math.min(2.4, 1.55 * zoom));

        const strokeStyle = dim
          ? withAlpha(baseColor, 0.16)
          : !isManual && !isHovered && !isEdgeSelected
            ? withAlpha(baseColor, 0.78)
            : baseColor;

        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = strokeW;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        if (isManual) {
          ctx.setLineDash([6, 4]);
        }

        ctx.beginPath();
        ctx.moveTo(panX + pts[0].x * zoom, panY + pts[0].y * zoom);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(panX + pts[i].x * zoom, panY + pts[i].y * zoom);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoint markers distinguishing Declared FK (filled arrow) vs Manual Relation (hollow circle + diamond)
        if (zoom >= LOD_TITLE_THRESHOLD) {
          const p0 = pts[0];
          const pLast = pts[pts.length - 1];
          const pPrev = pts[pts.length - 2];
          const ex = panX + pLast.x * zoom;
          const ey = panY + pLast.y * zoom;
          const angle = Math.atan2(pLast.y - pPrev.y, pLast.x - pPrev.x);
          const sz = Math.max(4, Math.min(8, 6.5 * zoom));

          if (isManual) {
            // Hollow start dot
            const sx = panX + p0.x * zoom;
            const sy = panY + p0.y * zoom;
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(2.5, 3.5 * zoom), 0, Math.PI * 2);
            ctx.fillStyle = pal.cardBg;
            ctx.fill();
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = Math.max(1.2, 1.6 * zoom);
            ctx.stroke();

            // Diamond end marker
            ctx.save();
            ctx.translate(ex, ey);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-sz * 0.8, -sz * 0.55);
            ctx.lineTo(-sz * 1.6, 0);
            ctx.lineTo(-sz * 0.8, sz * 0.55);
            ctx.closePath();
            ctx.fillStyle = strokeStyle;
            ctx.fill();
            ctx.restore();
          } else {
            // Solid triangular arrow for declared foreign key
            ctx.save();
            ctx.translate(ex, ey);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-sz * 1.25, -sz * 0.55);
            ctx.lineTo(-sz * 1.25, sz * 0.55);
            ctx.closePath();
            ctx.fillStyle = strokeStyle;
            ctx.fill();
            ctx.restore();
          }
        }
        ctx.restore();
      }

      // 3. Nodes (Table Cards & Collapsed Group Cards)
      const showCols = zoom >= LOD_FULL_THRESHOLD && st.cardDensity !== 'compact';
      const showTitle = zoom >= LOD_TITLE_THRESHOLD;
      const titlePx = Math.max(8, Math.min(17, 12.5 * zoom));
      const colPx = Math.max(7.5, Math.min(14, 11.0 * zoom));
      const badgePx = Math.max(7, Math.min(10.5, 9 * zoom));
      const now = performance.now();

      for (let nodeIdx = 0; nodeIdx < scene.nodes.length; nodeIdx++) {
        const node = scene.nodes[nodeIdx];
        const b = getNodeBounds(nodeIdx);
        if (
          b.x + b.width < viewLeft ||
          b.x > viewRight ||
          b.y + b.height < viewTop ||
          b.y > viewBottom
        ) {
          continue;
        }

        const x = panX + b.x * zoom;
        const y = panY + b.y * zoom;
        const w = b.width * zoom;
        const h = b.height * zoom;
        const isSelected = st.selectedTableId === node.id;
        const isHl = isSelected || scene.highlightedNodes.has(nodeIdx);
        const dim = scene.hasSelectionHighlight && !isHl;

        // Flash intensity check
        let flashIntensity: number | null = null;
        if (st.flashTable) {
          const elapsed = now - st.flashTable.startedAt;
          if (elapsed < FLASH_DURATION_MS) {
            const matches =
              node.kind.type === 'table'
                ? node.id === st.flashTable.tableId
                : node.kind.tableIds.includes(st.flashTable.tableId);
            if (matches) {
              const phase = elapsed / FLASH_DURATION_MS;
              const pulse = Math.abs(Math.sin(phase * Math.PI * 4)) * (1 - phase);
              flashIntensity = Math.max(0.15, Math.min(1, pulse));
            }
          }
        }

        if (flashIntensity !== null) {
          const glow = 4 + flashIntensity * 6;
          drawRoundedRect(ctx, x - glow, y - glow, w + glow * 2, h + glow * 2, 10);
          ctx.fillStyle = withAlpha(pal.flashBorder, 0.28 * flashIntensity);
          ctx.fill();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = withAlpha(pal.flashBorder, 0.85 * flashIntensity);
          ctx.stroke();
        }

        const alphaMul = dim ? 0.32 : 1.0;
        const radius = Math.max(3, Math.min(8, 6 * zoom));

        let borderColor = pal.cardBorder;
        if (flashIntensity !== null) borderColor = pal.flashBorder;
        else if (isSelected) borderColor = pal.selectedBorder;
        else if (scene.hasSelectionHighlight && isHl)
          borderColor = withAlpha(pal.selectedBorder, 0.78);
        else if (dim) borderColor = withAlpha(pal.cardBorder, 0.35);

        const borderW = isSelected || flashIntensity !== null ? 2.2 : 1.1;

        if (!showTitle) {
          drawRoundedRect(ctx, x, y, w, h, radius);
          ctx.fillStyle = withAlpha(pal.headerBg, alphaMul);
          ctx.fill();
          ctx.lineWidth = borderW;
          ctx.strokeStyle = borderColor;
          ctx.stroke();
          continue;
        }

        // Card container
        ctx.save();
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.fillStyle = withAlpha(pal.cardBg, alphaMul);
        ctx.fill();
        ctx.clip();

        const padX = Math.max(4, Math.min(12, 10 * zoom));

        if (node.kind.type === 'collapsed_group') {
          const hdrH = showCols ? Math.min(34 * zoom, h) : h;
          ctx.fillStyle = withAlpha(pal.viewHeaderBg, alphaMul);
          ctx.fillRect(x, y, w, hdrH);

          ctx.font = `600 ${titlePx}px ${FONT_STACK}`;
          ctx.fillStyle = withAlpha(pal.fg, alphaMul);
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          const titleText = `分组：${node.kind.group}`;
          ctx.fillText(truncateText(ctx, titleText, w - padX * 2), x + padX, y + hdrH * 0.5);

          if (zoom >= LOD_FULL_THRESHOLD) {
            ctx.font = `400 ${colPx}px ${FONT_STACK}`;
            ctx.fillStyle = withAlpha(pal.mutedFg, alphaMul);
            ctx.textBaseline = 'top';
            const sub = `${node.kind.tableIds.length} 张表 · 双击展开`;
            ctx.fillText(
              truncateText(ctx, sub, w - padX * 2),
              x + padX,
              y + hdrH + 10 * zoom,
            );
          }
        } else {
          const tbl = cachedTablesRef.current.get(node.id);
          if (tbl) {
            const hdrH = showCols ? Math.min(32 * zoom, h) : h;
            ctx.fillStyle = withAlpha(tbl.isView ? pal.viewHeaderBg : pal.headerBg, alphaMul);
            ctx.fillRect(x, y, w, hdrH);

            // Optional right-side header tag (VIEW / MVIEW / PART / NEW)
            let rightReserved = 0;
            const rightTag = tbl.isNew ? 'NEW' : tbl.badgeTag;
            if (rightTag && zoom >= LOD_FULL_THRESHOLD) {
              ctx.font = `700 ${badgePx}px ${FONT_STACK}`;
              const tw = ctx.measureText(rightTag).width + 8 * zoom;
              const th = 14 * zoom;
              const tx = x + w - padX - tw;
              const ty = y + (hdrH - th) * 0.5;
              drawRoundedRect(ctx, tx, ty, tw, th, 3 * zoom);
              ctx.fillStyle = tbl.isNew
                ? withAlpha(pal.success, 0.22 * alphaMul)
                : withAlpha(pal.selectedBorder, 0.18 * alphaMul);
              ctx.fill();
              ctx.fillStyle = withAlpha(tbl.isNew ? pal.success : pal.selectedBorder, alphaMul);
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(rightTag, tx + tw * 0.5, ty + th * 0.5);
              rightReserved = tw + 6 * zoom;
            }

            ctx.font = `600 ${titlePx}px ${FONT_STACK}`;
            ctx.fillStyle = withAlpha(pal.fg, alphaMul);
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(
              truncateText(ctx, tbl.title, w - padX * 2 - rightReserved),
              x + padX,
              y + hdrH * 0.5,
            );

            if (showCols) {
              const rowStep = 20 * zoom;
              let rowY = y + hdrH + 4 * zoom;
              const endpointHighlight = activeEndpointCols.get(tbl.id);

              for (const row of tbl.rows) {
                const isEndpointRow = endpointHighlight?.col === row.rawName;
                const isLinkHoverRow =
                  (drag?.type === 'link' &&
                    drag.target?.tableId === tbl.id &&
                    drag.target.columnName === row.rawName) ||
                  (hoveredColRef.current?.tableId === tbl.id &&
                    hoveredColRef.current?.columnName === row.rawName &&
                    st.linkMode);

                if (isEndpointRow || isLinkHoverRow) {
                  ctx.fillStyle =
                    isLinkHoverRow || endpointHighlight?.isManual
                      ? pal.manualRowHighlightBg
                      : pal.rowHighlightBg;
                  ctx.fillRect(x + 2, rowY - 2 * zoom, w - 4, rowStep - 1);
                }

                // Inline badges: PK / FK / UQ
                let cursorX = x + padX;
                const rowCenterY = rowY + rowStep * 0.44;
                const badges: Array<{ text: string; color: string }> = [];
                if (row.isPk) badges.push({ text: 'PK', color: pal.selectedBorder });
                if (row.isFk) badges.push({ text: 'FK', color: pal.manualLine });
                if (row.isUq) badges.push({ text: 'UQ', color: pal.warning });
                if (row.isChanged) badges.push({ text: 'MOD', color: pal.success });

                ctx.font = `700 ${badgePx}px ${FONT_STACK}`;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                for (const bdg of badges) {
                  const bw = ctx.measureText(bdg.text).width + 5 * zoom;
                  const bh = 12.5 * zoom;
                  drawRoundedRect(ctx, cursorX, rowCenterY - bh * 0.5, bw, bh, 2.5 * zoom);
                  ctx.fillStyle = withAlpha(bdg.color, 0.16 * alphaMul);
                  ctx.fill();
                  ctx.fillStyle = withAlpha(bdg.color, alphaMul);
                  ctx.fillText(bdg.text, cursorX + 2.5 * zoom, rowCenterY);
                  cursorX += bw + 3 * zoom;
                }

                // Column name
                const typeWidthBudget = w * 0.34;
                const nameBudget = Math.max(24, x + w - padX - typeWidthBudget - cursorX - 4 * zoom);
                ctx.font = `${row.isPk || isEndpointRow ? 600 : 400} ${colPx}px ${FONT_STACK}`;
                ctx.fillStyle = withAlpha(
                  isEndpointRow
                    ? endpointHighlight?.isManual
                      ? pal.manualLine
                      : pal.selectedBorder
                    : row.isPk
                      ? pal.selectedBorder
                      : pal.fg,
                  alphaMul,
                );
                ctx.textAlign = 'left';
                ctx.fillText(truncateText(ctx, row.rawName, nameBudget), cursorX, rowCenterY);

                // Column type + nullable `?` indicator
                const typeLabel = row.nullable ? `${row.type}?` : row.type;
                ctx.font = `400 ${colPx}px ${FONT_STACK}`;
                ctx.fillStyle = withAlpha(pal.mutedFg, alphaMul);
                ctx.textAlign = 'right';
                ctx.fillText(truncateText(ctx, typeLabel, typeWidthBudget), x + w - padX, rowCenterY);

                // Manual link connection port dots on card edge when Link Mode is active or row hovered
                if (
                  st.linkMode ||
                  (hoveredColRef.current?.tableId === tbl.id &&
                    hoveredColRef.current?.columnName === row.rawName)
                ) {
                  const dotR = Math.max(2.5, 3.6 * zoom);
                  ctx.beginPath();
                  ctx.arc(x + w - 3 * zoom, rowCenterY, dotR, 0, Math.PI * 2);
                  ctx.fillStyle = pal.manualLine;
                  ctx.fill();
                }

                rowY += rowStep;
              }

              if (tbl.footerLabel) {
                ctx.font = `500 ${colPx}px ${FONT_STACK}`;
                ctx.fillStyle = withAlpha(pal.selectedBorder, alphaMul);
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(truncateText(ctx, tbl.footerLabel, w - padX * 2), x + padX, rowY + 1);
              }
            }
          }
        }
        ctx.restore();

        // Card outer border
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.lineWidth = borderW;
        ctx.strokeStyle = borderColor;
        ctx.stroke();
      }

      // 4. Track B1: Live rubber-band manual link preview during column-to-column drag
      if (drag?.type === 'link') {
        const sx = panX + drag.startWorldX * zoom;
        const sy = panY + drag.startWorldY * zoom;
        const ex = panX + (drag.target ? drag.target.anchorX : drag.curWorldX) * zoom;
        const ey = panY + (drag.target ? drag.target.anchorY : drag.curWorldY) * zoom;
        const compatible =
          !drag.target ||
          drag.fromTypeFamily === 'other' ||
          drag.target.typeFamily === 'other' ||
          drag.fromTypeFamily === drag.target.typeFamily;

        ctx.save();
        ctx.strokeStyle = drag.target ? (compatible ? pal.manualLine : pal.warning) : pal.manualLine;
        ctx.lineWidth = 2.2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const midX = (sx + ex) * 0.5;
        ctx.moveTo(sx, sy);
        ctx.lineTo(midX, sy);
        ctx.lineTo(midX, ey);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(ex, ey, 5, 0, Math.PI * 2);
        ctx.fillStyle = drag.target ? (compatible ? pal.manualLine : pal.warning) : pal.manualLine;
        ctx.fill();

        if (drag.target && !compatible) {
          ctx.font = `600 11px ${FONT_STACK}`;
          const warnTxt = '类型族不同（仍可创建）';
          const tw = ctx.measureText(warnTxt).width + 12;
          drawRoundedRect(ctx, ex + 10, ey - 12, tw, 22, 4);
          ctx.fillStyle = pal.cardBg;
          ctx.fill();
          ctx.strokeStyle = pal.warning;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = pal.warning;
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';
          ctx.fillText(warnTxt, ex + 16, ey - 1);
        }
        ctx.restore();
      }

      ctx.restore();
    }, [getPalette]);

    const scheduleFrame = useCallback(() => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        let needMore = false;

        if (targetPanRef.current) {
          const cam = cameraRef.current;
          const dx = targetPanRef.current.x - cam.panX;
          const dy = targetPanRef.current.y - cam.panY;
          if (Math.abs(dx) < 0.75 && Math.abs(dy) < 0.75) {
            cam.panX = targetPanRef.current.x;
            cam.panY = targetPanRef.current.y;
            targetPanRef.current = null;
          } else {
            cam.panX += dx * 0.25;
            cam.panY += dy * 0.25;
            needMore = true;
          }
        }

        const flash = stateRef.current.flashTable;
        if (flash) {
          if (performance.now() - flash.startedAt < FLASH_DURATION_MS) {
            needMore = true;
          } else {
            onClearFlash();
          }
        }

        paint();
        if (needMore) {
          scheduleFrame();
        }
      });
    }, [paint, onClearFlash]);

    useEffect(() => {
      scheduleFrame();
    }, [state, isDark, scheduleFrame]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const ro = new ResizeObserver(() => scheduleFrame());
      ro.observe(container);
      return () => {
        ro.disconnect();
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
      };
    }, [scheduleFrame]);

    const computeFittedCamera = useCallback((st: AppState) => {
      const container = containerRef.current;
      if (!container) return null;
      const rect = container.getBoundingClientRect();
      const vw = Math.max(200, rect.width);
      const vh = Math.max(200, rect.height);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const n of st.scene.nodes) {
        minX = Math.min(minX, n.bounds.x);
        minY = Math.min(minY, n.bounds.y);
        maxX = Math.max(maxX, n.bounds.x + n.bounds.width);
        maxY = Math.max(maxY, n.bounds.y + n.bounds.height);
      }
      for (const c of st.scene.containers) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x + c.width);
        maxY = Math.max(maxY, c.y + c.height);
      }

      if (!Number.isFinite(minX)) {
        return { zoom: 1, panX: 40, panY: 40 };
      }

      const contentW = Math.max(1, maxX - minX);
      const contentH = Math.max(1, maxY - minY);
      const pad = 44;
      const z = Math.max(
        MIN_ZOOM,
        Math.min(1.0, Math.min((vw - pad * 2) / contentW, (vh - pad * 2) / contentH)),
      );
      const cx = (minX + maxX) * 0.5;
      const cy = (minY + maxY) * 0.5;
      return {
        zoom: z,
        panX: vw * 0.5 - cx * z,
        panY: vh * 0.5 - cy * z,
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        fitToView() {
          const fitted = computeFittedCamera(stateRef.current);
          if (!fitted) return;
          cameraRef.current = fitted;
          targetPanRef.current = null;
          onZoomChange(Math.round(fitted.zoom * 100));
          scheduleFrame();
        },
        jumpToTable(tableId: string, nextState?: AppState) {
          const container = containerRef.current;
          const vw = container ? container.getBoundingClientRect().width : 900;
          const vh = container ? container.getBoundingClientRect().height : 650;
          const st = nextState ?? stateRef.current;
          if (cameraRef.current.zoom < 0.75) {
            cameraRef.current.zoom = 0.95;
            onZoomChange(95);
          }
          const nodeIdx = st.scene.tableToNode[tableId];
          if (nodeIdx !== undefined) {
            const node = st.scene.nodes[nodeIdx];
            const [cxW, cyW] = nodeBoxCenter(node.bounds);
            const z = cameraRef.current.zoom;
            targetPanRef.current = {
              x: vw * 0.5 - cxW * z,
              y: vh * 0.5 - cyW * z,
            };
          }
          scheduleFrame();
        },
        resetCameraForNewSource(nextState: AppState) {
          const vp = nextState.config.viewport;
          if (vp.zoom !== 1 || vp.pan_x !== 0 || vp.pan_y !== 0) {
            const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom));
            cameraRef.current = { zoom: z, panX: vp.pan_x, panY: vp.pan_y };
            onZoomChange(Math.round(z * 100));
          } else if (nextState.schema.tables.length <= 120) {
            const fitted = computeFittedCamera(nextState);
            if (fitted) {
              cameraRef.current = fitted;
              onZoomChange(Math.round(fitted.zoom * 100));
            }
          } else {
            cameraRef.current = { zoom: 0.65, panX: 48, panY: 56 };
            onZoomChange(65);
          }
          targetPanRef.current = null;
          scheduleFrame();
        },
      }),
      [computeFittedCamera, onZoomChange, scheduleFrame],
    );

    const getLocalCoords = (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { lx: 0, ly: 0, vw: 800, vh: 600 };
      return { lx: clientX - rect.left, ly: clientY - rect.top, vw: rect.width, vh: rect.height };
    };

    const hitTestNode = (lx: number, ly: number): number | null => {
      const { zoom, panX, panY } = cameraRef.current;
      const wx = (lx - panX) / zoom;
      const wy = (ly - panY) / zoom;
      const nodes = stateRef.current.scene.nodes;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const b = nodes[i].bounds;
        if (wx >= b.x && wx <= b.x + b.width && wy >= b.y && wy <= b.y + b.height) {
          return i;
        }
      }
      return null;
    };

    const hitTestGroupCollapseButton = (lx: number, ly: number): string | null => {
      const { zoom, panX, panY } = cameraRef.current;
      if (zoom < LOD_FULL_THRESHOLD) return null;
      const containers = stateRef.current.scene.containers;
      for (const c of containers) {
        const gx = panX + c.x * zoom;
        const gy = panY + c.y * zoom;
        const gw = c.width * zoom;
        const hdrH = Math.max(16, Math.min(28, 24 * zoom));
        const btnSize = 16 * zoom;
        const bx = gx + gw - btnSize - 6 * zoom;
        const by = gy + (hdrH - btnSize) * 0.5;
        if (lx >= bx - 3 && lx <= bx + btnSize + 3 && ly >= by - 3 && ly <= by + btnSize + 3) {
          return c.name;
        }
      }
      return null;
    };

    const hitTestColumnRow = (lx: number, ly: number): ColumnHit | null => {
      const st = stateRef.current;
      if (st.cardDensity === 'compact') return null;
      const { zoom, panX, panY } = cameraRef.current;
      if (zoom < LOD_FULL_THRESHOLD) return null;
      const wx = (lx - panX) / zoom;
      const wy = (ly - panY) / zoom;
      const nodeIdx = hitTestNode(lx, ly);
      if (nodeIdx === null) return null;
      const node = st.scene.nodes[nodeIdx];
      if (node.kind.type !== 'table') return null;
      const tbl = st.schema.tables[node.kind.tableIdx];
      if (!tbl) return null;

      const limit = getVisibleColumnLimit(
        st.cardDensity,
        st.expandedTables.has(tbl.id),
        tbl.columns.length,
      );
      const localY = wy - (node.bounds.y + DEFAULT_LAYOUT_CONFIG.headerHeight + 4);
      if (localY < 0) return null;
      const rowIdx = Math.floor(localY / DEFAULT_LAYOUT_CONFIG.rowHeight);
      if (rowIdx < 0 || rowIdx >= limit) return null;
      const col = tbl.columns[rowIdx];
      if (!col) return null;

      const side: 'left' | 'right' =
        wx >= node.bounds.x + node.bounds.width * 0.5 ? 'right' : 'left';
      const anchorX = side === 'right' ? node.bounds.x + node.bounds.width : node.bounds.x;
      const anchorY =
        node.bounds.y +
        DEFAULT_LAYOUT_CONFIG.headerHeight +
        4 +
        rowIdx * DEFAULT_LAYOUT_CONFIG.rowHeight +
        DEFAULT_LAYOUT_CONFIG.rowHeight * 0.45;

      return {
        nodeIdx,
        tableId: tbl.id,
        columnName: col.name,
        typeFamily: col.type_family,
        anchorX,
        anchorY,
        side,
      };
    };

    const hitTestEdge = (lx: number, ly: number): number | null => {
      const { zoom, panX, panY } = cameraRef.current;
      const scene = stateRef.current.scene;
      let best: { idx: number; dist: number } | null = null;

      for (let idx = 0; idx < scene.edges.length; idx++) {
        const pts = scene.edges[idx].points;
        if (pts.length < 2) continue;
        let minDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pts.length - 1; i++) {
          const sx = panX + pts[i].x * zoom;
          const sy = panY + pts[i].y * zoom;
          const ex = panX + pts[i + 1].x * zoom;
          const ey = panY + pts[i + 1].y * zoom;
          const d = pointToSegDist(lx, ly, sx, sy, ex, ey);
          if (d < minDist) minDist = d;
        }
        if (minDist <= 7.5 && (!best || minDist < best.dist)) {
          best = { idx, dist: minDist };
        }
      }
      return best ? best.idx : null;
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0 && e.button !== 1) return;
      const { lx, ly } = getLocalCoords(e.clientX, e.clientY);
      const st = stateRef.current;

      if (e.button === 0) {
        // Track D4: Click collapse button on group container header
        const groupCollapseName = hitTestGroupCollapseButton(lx, ly);
        if (groupCollapseName) {
          onToggleGroupCollapsed(groupCollapseName);
          return;
        }

        // Track B1: Start manual column-to-column link drag if Link Mode is ON,
        // or user starts drag near the right-edge port of a column row
        const colHit = hitTestColumnRow(lx, ly);
        if (colHit) {
          const { zoom, panX } = cameraRef.current;
          const node = st.scene.nodes[colHit.nodeIdx];
          const wx = (lx - panX) / zoom;
          const nearRightPort = wx >= node.bounds.x + node.bounds.width - 18;
          if (st.linkMode || nearRightPort) {
            targetPanRef.current = null;
            dragRef.current = {
              type: 'link',
              fromTableId: colHit.tableId,
              fromColumn: colHit.columnName,
              fromTypeFamily: colHit.typeFamily,
              startWorldX: node.bounds.x + node.bounds.width,
              startWorldY: colHit.anchorY,
              curWorldX: wx,
              curWorldY: colHit.anchorY,
              target: null,
            };
            setCursorStyle('crosshair');
            setCommentHover(null);
            scheduleFrame();
            return;
          }
        }

        const nodeIdx = hitTestNode(lx, ly);
        if (nodeIdx !== null) {
          targetPanRef.current = null;
          const node = st.scene.nodes[nodeIdx];
          const wy = (ly - cameraRef.current.panY) / cameraRef.current.zoom;

          if (node.kind.type === 'table') {
            const tbl = st.schema.tables[node.kind.tableIdx];
            const hasFooter = st.cardDensity === 'standard' && tbl && tbl.columns.length > 4;
            const inFooter = hasFooter && wy >= node.bounds.y + node.bounds.height - 24;
            if (inFooter) {
              onToggleTableExpanded(node.id);
              return;
            }
            onSelectTable(node.id);
            dragRef.current = {
              type: 'node',
              nodeIdx,
              nodeId: node.id,
              isTable: true,
              lastX: lx,
              lastY: ly,
              curX: node.bounds.x,
              curY: node.bounds.y,
              moved: false,
            };
            setCursorStyle('grabbing');
            return;
          } else {
            if (e.detail >= 2) {
              onToggleGroupCollapsed(node.kind.group);
              return;
            }
            dragRef.current = {
              type: 'node',
              nodeIdx,
              nodeId: node.id,
              isTable: false,
              lastX: lx,
              lastY: ly,
              curX: node.bounds.x,
              curY: node.bounds.y,
              moved: false,
            };
            setCursorStyle('grabbing');
            return;
          }
        }

        const edgeIdx = hitTestEdge(lx, ly);
        if (edgeIdx !== null) {
          targetPanRef.current = null;
          const edge = st.scene.edges[edgeIdx];
          if (edge) {
            onSelectRelation(edge.relationId);
          }
          return;
        }
      }

      targetPanRef.current = null;
      if (e.button === 0) {
        onSelectTable(null);
      }
      dragRef.current = { type: 'pan', lastX: lx, lastY: ly };
      setCursorStyle('grabbing');
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { lx, ly, vw, vh } = getLocalCoords(e.clientX, e.clientY);
      const drag = dragRef.current;
      const st = stateRef.current;

      if (!drag) {
        const colHit = hitTestColumnRow(lx, ly);
        const prevCol = hoveredColRef.current;
        const colChanged =
          prevCol?.tableId !== colHit?.tableId || prevCol?.columnName !== colHit?.columnName;
        if (colChanged) {
          hoveredColRef.current = colHit;
          scheduleFrame();
        }

        const nodeIdx = hitTestNode(lx, ly);
        const edgeIdx = nodeIdx !== null ? null : hitTestEdge(lx, ly);
        if (hoveredEdgeIdxRef.current !== edgeIdx) {
          hoveredEdgeIdxRef.current = edgeIdx;
          const rid = edgeIdx !== null ? (st.scene.edges[edgeIdx]?.relationId ?? null) : null;
          setHoveredRelationId(rid);
          scheduleFrame();
        }

        // Track C3: Hover tooltip for table/column comments (clamped inside viewport)
        if (colHit) {
          const tbl = tableById(st.schema, colHit.tableId);
          const col = tbl?.columns.find((c) => c.name === colHit.columnName);
          if (col?.comment) {
            setCommentHover({
              title: `${tbl?.name}.${col.name}`,
              body: col.comment,
              x: Math.min(vw - 290, Math.max(12, lx + 14)),
              y: Math.min(vh - 110, Math.max(12, ly + 14)),
            });
          } else {
            setCommentHover(null);
          }
        } else if (nodeIdx !== null) {
          const node = st.scene.nodes[nodeIdx];
          if (node.kind.type === 'table') {
            const tbl = st.schema.tables[node.kind.tableIdx];
            if (tbl?.comment) {
              setCommentHover({
                title: tbl.name,
                body: tbl.comment,
                x: Math.min(vw - 290, Math.max(12, lx + 14)),
                y: Math.min(vh - 110, Math.max(12, ly + 14)),
              });
            } else {
              setCommentHover(null);
            }
          } else {
            setCommentHover(null);
          }
        } else {
          setCommentHover(null);
        }

        if (st.linkMode && colHit) {
          setCursorStyle('crosshair');
        } else {
          setCursorStyle(nodeIdx !== null || edgeIdx !== null ? 'pointer' : 'grab');
        }
        return;
      }

      if (drag.type === 'link') {
        const { zoom, panX, panY } = cameraRef.current;
        drag.curWorldX = (lx - panX) / zoom;
        drag.curWorldY = (ly - panY) / zoom;
        const target = hitTestColumnRow(lx, ly);
        drag.target =
          target &&
          !(target.tableId === drag.fromTableId && target.columnName === drag.fromColumn)
            ? target
            : null;
        scheduleFrame();
        return;
      }

      if (drag.type === 'pan') {
        cameraRef.current.panX += lx - drag.lastX;
        cameraRef.current.panY += ly - drag.lastY;
        drag.lastX = lx;
        drag.lastY = ly;
        scheduleFrame();
        return;
      }

      const dx = (lx - drag.lastX) / cameraRef.current.zoom;
      const dy = (ly - drag.lastY) / cameraRef.current.zoom;
      if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
        drag.moved = true;
      }
      drag.curX += dx;
      drag.curY += dy;
      drag.lastX = lx;
      drag.lastY = ly;
      dragOverrideRef.current = { nodeIdx: drag.nodeIdx, x: drag.curX, y: drag.curY };
      scheduleFrame();
    };

    const finishDrag = useCallback(() => {
      const drag = dragRef.current;
      dragRef.current = null;
      dragOverrideRef.current = null;
      setCursorStyle(stateRef.current.linkMode ? 'crosshair' : 'grab');

      if (drag?.type === 'link') {
        if (drag.target) {
          onCreateManualRelation({
            from_table: drag.fromTableId,
            from_columns: [drag.fromColumn],
            to_table: drag.target.tableId,
            to_columns: [drag.target.columnName],
          });
        }
        scheduleFrame();
        return;
      }

      if (drag && drag.type === 'node' && drag.moved) {
        const cam = cameraRef.current;
        onDropNode(drag.nodeId, drag.isTable, drag.curX, drag.curY, cam.zoom, cam.panX, cam.panY);
      }
    }, [onDropNode, onCreateManualRelation, scheduleFrame]);

    useEffect(() => {
      const onWinUp = () => {
        if (dragRef.current) finishDrag();
      };
      window.addEventListener('mouseup', onWinUp);
      return () => window.removeEventListener('mouseup', onWinUp);
    }, [finishDrag]);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const lx = e.clientX - rect.left;
        const ly = e.clientY - rect.top;
        const cam = cameraRef.current;
        const worldX = (lx - cam.panX) / cam.zoom;
        const worldY = (ly - cam.panY) / cam.zoom;

        const dy = -e.deltaY;
        const factor = Math.max(0.75, Math.min(1.35, 1 + dy * 0.002));
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));
        cam.zoom = nextZoom;
        cam.panX = lx - worldX * nextZoom;
        cam.panY = ly - worldY * nextZoom;
        targetPanRef.current = null;
        onZoomChange(Math.round(nextZoom * 100));
        scheduleFrame();
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => canvas.removeEventListener('wheel', onWheel);
    }, [onZoomChange, scheduleFrame]);

    // Floating tooltip for hovered or selected relation
    const selectedRel: Relation | undefined = state.selectedRelationId
      ? state.schema.relations.find((r) => r.id === state.selectedRelationId)
      : undefined;
    const hoveredRel: Relation | undefined = hoveredRelationId
      ? state.schema.relations.find((r) => r.id === hoveredRelationId)
      : undefined;
    const tooltipRel = hoveredRel ?? selectedRel;

    return (
      <div
        ref={containerRef}
        data-testid="er-canvas-container"
        data-table-count={state.schema.tables.length}
        data-edge-count={state.scene.edges.length}
        data-density={state.cardDensity}
        className="relative flex-1 min-w-0 h-full overflow-hidden bg-[var(--canvas-bg)] select-none"
      >
        <canvas
          ref={canvasRef}
          data-testid="er-canvas"
          aria-label="ER 图交互画布"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={finishDrag}
          onMouseLeave={() => {
            setCommentHover(null);
            hoveredColRef.current = null;
            if (!dragRef.current && hoveredEdgeIdxRef.current !== null) {
              hoveredEdgeIdxRef.current = null;
              setHoveredRelationId(null);
              scheduleFrame();
            }
          }}
          style={{ cursor: cursorStyle }}
          className="block w-full h-full"
        />

        {/* Track B1: Link mode helper banner */}
        {state.linkMode && (
          <div className="pointer-events-none absolute top-2.5 left-3 px-2.5 py-1 rounded-md border border-[var(--manual)]/50 bg-[var(--popover)]/95 text-xs text-[var(--manual)] font-medium shadow-sm">
            手动连线模式：从任意字段按住拖到目标表字段即可创建手动关系（按 Esc 退出）
          </div>
        )}

        {/* Track F1 + E2: Legend overlay bottom-right (Declared FK & Manual only — zero inference) */}
        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-3 px-2.5 py-1 rounded-md border border-[var(--border)] bg-[var(--popover)]/92 text-[11px] text-[var(--muted-fg)] shadow-sm">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3.5 h-[2px] bg-[var(--muted-fg)]" /> 声明外键
          </span>
          <span className="flex items-center gap-1 text-[var(--manual)]">
            <span className="inline-block w-3.5 border-t-2 border-dashed border-[var(--manual)]" />{' '}
            手动关系
          </span>
        </div>

        {/* Track C3: Wrapped Chinese-friendly comment hover tooltip */}
        {commentHover && (
          <div
            className="pointer-events-none absolute z-20 max-w-[275px] p-2 rounded-[6px] border border-[var(--border)] bg-[var(--popover)]/96 shadow-md text-[var(--fg)]"
            style={{ left: commentHover.x, top: commentHover.y }}
          >
            <div className="text-[11px] font-semibold mb-0.5 break-all">{commentHover.title}</div>
            <div className="text-[11px] text-[var(--muted-fg)] whitespace-pre-wrap break-words leading-relaxed">
              {commentHover.body}
            </div>
          </div>
        )}

        {/* Floating relation info popover */}
        {tooltipRel && (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute bottom-3 left-3 max-w-[560px] p-2.5 rounded-[8px] bg-[var(--popover)]/96 border shadow-lg flex flex-col gap-1.5 text-[var(--fg)] ${
              selectedRel?.id === tooltipRel.id
                ? 'border-[var(--primary)]'
                : 'border-[var(--border)]'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold break-words">
                {tooltipRel.from_table} ({tooltipRel.from_columns.join(', ')}) →{' '}
                {tooltipRel.to_table} ({tooltipRel.to_columns.join(', ')})
              </div>
              <span
                className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 font-medium ${
                  tooltipRel.kind === 'manual'
                    ? 'bg-[var(--manual)]/15 text-[var(--manual)]'
                    : 'bg-[var(--secondary)] text-[var(--secondary-fg)]'
                }`}
              >
                {tooltipRel.kind === 'manual' ? '来源：手动' : '来源：声明外键'}
              </span>
            </div>
            <div className="text-xs text-[var(--muted-fg)] break-words">
              {tooltipRel.kind === 'manual'
                ? tooltipRel.note
                  ? `备注：${tooltipRel.note}`
                  : '由用户手动建立的关系（可在右侧详情面板补充备注）'
                : tooltipRel.evidence.length > 0
                  ? tooltipRel.evidence.join(' · ')
                  : '来自数据库 / Schema 元数据声明的外键约束'}
            </div>
            {tooltipRel.type_mismatch && (
              <div className="text-[11px] text-[var(--warning)]">
                提示：两端字段的类型族不一致，请核对业务语义。
              </div>
            )}
            {tooltipRel.kind === 'manual' && (
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => onDeleteManualRelation(tooltipRel.id)}
                  className="px-2 py-1 rounded text-xs font-medium bg-[var(--danger)] text-white hover:opacity-90 cursor-pointer"
                >
                  删除手动关系
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  },
);

ErCanvas.displayName = 'ErCanvas';
