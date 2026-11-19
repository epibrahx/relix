import { Schema, Table } from '../core/model';

export interface LayoutConfig {
  nodeWidth: number;
  headerHeight: number;
  rowHeight: number;
  footerPadding: number;
  maxVisibleCols: number;
  hGap: number;
  vGap: number;
  maxNodesPerRow: number;
}

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  nodeWidth: 240,
  headerHeight: 32,
  rowHeight: 20,
  footerPadding: 10,
  maxVisibleCols: 8,
  hGap: 64,
  vGap: 56,
  maxNodesPerRow: 16,
};

export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function nodeBoxCenter(b: NodeBox): [number, number] {
  return [b.x + b.width * 0.5, b.y + b.height * 0.5];
}

export interface LayoutResult {
  nodes: Record<string, NodeBox>;
  totalWidth: number;
  totalHeight: number;
}

export function computeTableHeight(table: Table, config: LayoutConfig): number {
  const shownCols = Math.min(table.columns.length, config.maxVisibleCols);
  const hasMore = table.columns.length > config.maxVisibleCols ? 1 : 0;
  return config.headerHeight + (shownCols + hasMore) * config.rowHeight + config.footerPadding;
}

function breakCyclesToDag(adj: number[][], n: number): Array<[number, number]> {
  // 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Uint8Array(n);
  const dagEdges: Array<[number, number]> = [];

  for (let start = 0; start < n; start++) {
    if (state[start] !== 0) continue;
    const startNbrs = [...adj[start]].sort((a, b) => a - b);
    const stack: Array<{ u: number; nbrs: number[]; cursor: number }> = [
      { u: start, nbrs: startNbrs, cursor: 0 },
    ];
    state[start] = 1;

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.cursor < top.nbrs.length) {
        const v = top.nbrs[top.cursor];
        top.cursor += 1;
        if (state[v] === 0) {
          dagEdges.push([top.u, v]);
          state[v] = 1;
          const vNbrs = [...adj[v]].sort((a, b) => a - b);
          stack.push({ u: v, nbrs: vNbrs, cursor: 0 });
        } else if (state[v] === 1) {
          if (v !== top.u) {
            dagEdges.push([v, top.u]);
          }
        } else {
          dagEdges.push([top.u, v]);
        }
      } else {
        state[top.u] = 2;
        stack.pop();
      }
    }
  }

  dagEdges.sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const deduped: Array<[number, number]> = [];
  for (const e of dagEdges) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== e[0] || prev[1] !== e[1]) {
      deduped.push(e);
    }
  }
  return deduped;
}

function assignLayers(n: number, dagEdges: Array<[number, number]>): number[] {
  const adj: number[][] = Array.from({ length: n }, () => []);
  const inDeg = new Int32Array(n);
  for (const [u, v] of dagEdges) {
    if (u !== v) {
      adj[u].push(v);
      inDeg[v] += 1;
    }
  }

  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (inDeg[i] === 0) queue.push(i);
  }

  const layers = new Array<number>(n).fill(0);
  let head = 0;
  let visited = 0;
  while (head < queue.length) {
    const u = queue[head++];
    visited += 1;
    const nextLayer = layers[u] + 1;
    for (const v of adj[u]) {
      if (layers[v] < nextLayer) {
        layers[v] = nextLayer;
      }
      inDeg[v] -= 1;
      if (inDeg[v] === 0) {
        queue.push(v);
      }
    }
  }

  if (visited < n) {
    for (let i = 0; i < n; i++) {
      if (inDeg[i] > 0) layers[i] = 0;
    }
  }

  return layers;
}

function minimizeCrossings(byLayer: number[][], dagEdges: Array<[number, number]>, n: number): void {
  if (byLayer.length <= 1) return;
  const parents: number[][] = Array.from({ length: n }, () => []);
  const children: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of dagEdges) {
    parents[v].push(u);
    children[u].push(v);
  }

  const pos = new Int32Array(n);
  for (const layer of byLayer) {
    layer.forEach((node, idx) => {
      pos[node] = idx;
    });
  }

  for (let sweep = 0; sweep < 2; sweep++) {
    // Top-down sweep
    for (let l = 1; l < byLayer.length; l++) {
      const layer = byLayer[l];
      const keyed = layer.map((node) => {
        const ps = parents[node];
        const avg =
          ps.length === 0
            ? pos[node]
            : ps.reduce((acc, p) => acc + pos[p], 0) / ps.length;
        return { avg, node };
      });
      keyed.sort((a, b) => (a.avg !== b.avg ? a.avg - b.avg : a.node - b.node));
      byLayer[l] = keyed.map((k) => k.node);
      byLayer[l].forEach((node, idx) => {
        pos[node] = idx;
      });
    }

    // Bottom-up sweep
    for (let l = byLayer.length - 2; l >= 0; l--) {
      const layer = byLayer[l];
      const keyed = layer.map((node) => {
        const cs = children[node];
        const avg =
          cs.length === 0
            ? pos[node]
            : cs.reduce((acc, c) => acc + pos[c], 0) / cs.length;
        return { avg, node };
      });
      keyed.sort((a, b) => (a.avg !== b.avg ? a.avg - b.avg : a.node - b.node));
      byLayer[l] = keyed.map((k) => k.node);
      byLayer[l].forEach((node, idx) => {
        pos[node] = idx;
      });
    }
  }
}

/**
 * Simplified Sugiyama layered layout matching `relix_layout::SugiyamaLayout`.
 */
export function sugiyamaLayout(
  schema: Schema,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): LayoutResult {
  const n = schema.tables.length;
  if (n === 0) {
    return { nodes: {}, totalWidth: 0, totalHeight: 0 };
  }

  const idToIdx = new Map<string, number>();
  const heights: number[] = [];
  for (let i = 0; i < n; i++) {
    idToIdx.set(schema.tables[i].id, i);
    heights.push(computeTableHeight(schema.tables[i], config));
  }

  const adj: number[][] = Array.from({ length: n }, () => []);
  const edgeSet = new Set<string>();
  for (const rel of schema.relations) {
    if (rel.status === 'rejected' || rel.from_table === rel.to_table) continue;
    const parent = idToIdx.get(rel.to_table);
    const child = idToIdx.get(rel.from_table);
    if (parent !== undefined && child !== undefined) {
      const key = `${parent}->${child}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        adj[parent].push(child);
      }
    }
  }

  const dagEdges = breakCyclesToDag(adj, n);
  const layers = assignLayers(n, dagEdges);
  const maxLayer = layers.reduce((m, l) => Math.max(m, l), 0);
  const byLayer: number[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (let idx = 0; idx < n; idx++) {
    byLayer[layers[idx]].push(idx);
  }

  minimizeCrossings(byLayer, dagEdges, n);

  const nodes: Record<string, NodeBox> = {};
  let curY = 0;
  let totalWidth = 0;
  const maxPerRow = Math.max(1, config.maxNodesPerRow);

  for (const layerNodes of byLayer) {
    if (layerNodes.length === 0) continue;
    for (let offset = 0; offset < layerNodes.length; offset += maxPerRow) {
      const chunk = layerNodes.slice(offset, offset + maxPerRow);
      const rowWidth =
        chunk.length * config.nodeWidth + Math.max(0, chunk.length - 1) * config.hGap;
      totalWidth = Math.max(totalWidth, rowWidth);

      let maxH = 0;
      for (let colIdx = 0; colIdx < chunk.length; colIdx++) {
        const nodeIdx = chunk[colIdx];
        const h = heights[nodeIdx];
        maxH = Math.max(maxH, h);
        const x = colIdx * (config.nodeWidth + config.hGap);
        nodes[schema.tables[nodeIdx].id] = {
          x,
          y: curY,
          width: config.nodeWidth,
          height: h,
        };
      }
      curY += maxH + config.vGap;
    }
  }

  const totalHeight = Math.max(0, curY - config.vGap);

  if (totalWidth > 0) {
    for (const layerNodes of byLayer) {
      for (let offset = 0; offset < layerNodes.length; offset += maxPerRow) {
        const chunk = layerNodes.slice(offset, offset + maxPerRow);
        const rowWidth =
          chunk.length * config.nodeWidth + Math.max(0, chunk.length - 1) * config.hGap;
        const shift = (totalWidth - rowWidth) * 0.5;
        if (shift > 0.5) {
          for (const nodeIdx of chunk) {
            const box = nodes[schema.tables[nodeIdx].id];
            if (box) box.x += shift;
          }
        }
      }
    }
  }

  return { nodes, totalWidth, totalHeight };
}

/**
 * Track D4: Domain-clustered layout that packs each business domain group into
 * its own non-overlapping spatial container while keeping intra-group Sugiyama ordering.
 */
export function groupedSugiyamaLayout(
  schema: Schema,
  groupsMap: Record<string, string>,
  config: LayoutConfig = DEFAULT_LAYOUT_CONFIG,
): LayoutResult {
  if (schema.tables.length === 0 || schema.tables.length > 150) {
    return sugiyamaLayout(schema, config);
  }

  const byGroup = new Map<string, Table[]>();
  for (const tbl of schema.tables) {
    const g = groupsMap[tbl.id] ?? 'core';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(tbl);
  }

  if (byGroup.size <= 1) {
    return sugiyamaLayout(schema, config);
  }

  const orderedGroups = Array.from(byGroup.entries()).sort((a, b) =>
    b[1].length !== a[1].length ? b[1].length - a[1].length : a[0].localeCompare(b[0]),
  );

  interface GroupBlock {
    name: string;
    layout: LayoutResult;
    width: number;
    height: number;
  }

  const blocks: GroupBlock[] = [];
  let totalArea = 0;

  for (const [name, tables] of orderedGroups) {
    const idSet = new Set(tables.map((t) => t.id));
    const subSchema: Schema = {
      dialect: schema.dialect,
      tables,
      relations: schema.relations.filter(
        (r) => r.status !== 'rejected' && idSet.has(r.from_table) && idSet.has(r.to_table),
      ),
      warnings: [],
    };
    const subMaxPerRow = tables.length <= 4 ? 2 : Math.min(3, config.maxNodesPerRow);
    const subLayout = sugiyamaLayout(subSchema, {
      ...config,
      maxNodesPerRow: subMaxPerRow,
    });
    const w = Math.max(config.nodeWidth, subLayout.totalWidth);
    const h = Math.max(config.headerHeight + 40, subLayout.totalHeight);
    blocks.push({ name, layout: subLayout, width: w, height: h });
    totalArea += (w + 110) * (h + 130);
  }

  // Shelf-pack group containers targeting ~1.55 widescreen aspect ratio
  const targetRowWidth = Math.max(
    blocks[0].width + 80,
    Math.sqrt(totalArea * 1.55),
  );
  const groupGapX = 104;
  const groupGapY = 108;
  const startX = 48;
  const startY = 64;

  const nodes: Record<string, NodeBox> = {};
  let curX = startX;
  let curY = startY;
  let rowMaxH = 0;
  let maxX = 0;
  let maxY = 0;

  for (const block of blocks) {
    if (curX > startX && curX + block.width > startX + targetRowWidth) {
      curX = startX;
      curY += rowMaxH + groupGapY;
      rowMaxH = 0;
    }

    for (const [tid, box] of Object.entries(block.layout.nodes)) {
      const shifted: NodeBox = {
        x: curX + box.x,
        y: curY + box.y,
        width: box.width,
        height: box.height,
      };
      nodes[tid] = shifted;
      maxX = Math.max(maxX, shifted.x + shifted.width);
      maxY = Math.max(maxY, shifted.y + shifted.height);
    }

    curX += block.width + groupGapX;
    rowMaxH = Math.max(rowMaxH, block.height);
  }

  return {
    nodes,
    totalWidth: maxX + 48,
    totalHeight: maxY + 48,
  };
}

/**
 * Return table IDs within `hops` undirected steps of `centerId` (excluding rejected relations).
 */
export function focusSubgraph(schema: Schema, centerId: string, hops: number): Set<string> {
  const visible = new Set<string>();
  if (!schema.tables.some((t) => t.id === centerId)) {
    return visible;
  }

  const adj = new Map<string, string[]>();
  for (const rel of schema.relations) {
    if (rel.status === 'rejected') continue;
    if (!adj.has(rel.from_table)) adj.set(rel.from_table, []);
    if (!adj.has(rel.to_table)) adj.set(rel.to_table, []);
    adj.get(rel.from_table)!.push(rel.to_table);
    adj.get(rel.to_table)!.push(rel.from_table);
  }

  const queue: Array<[string, number]> = [[centerId, 0]];
  visible.add(centerId);
  let head = 0;

  while (head < queue.length) {
    const [cur, depth] = queue[head++];
    if (depth >= hops) continue;
    const nbrs = adj.get(cur);
    if (!nbrs) continue;
    for (const nxt of nbrs) {
      if (!visible.has(nxt)) {
        visible.add(nxt);
        queue.push([nxt, depth + 1]);
      }
    }
  }

  return visible;
}
