import { CardDensity, ProjectConfig } from './config';
import { ENABLE_INFERENCE } from './featureFlags';
import { Relation, Schema, Table, formatTypeFamilyLabel } from './model';
import {
  computeDensityTableHeight,
  getColumnAnchorY,
  routeOrthogonalEdge,
} from '../layout/routing';
import { DEFAULT_LAYOUT_CONFIG, NodeBox, sugiyamaLayout } from '../layout/sugiyama';

export type ExportFormat = 'mermaid' | 'markdown' | 'svg' | 'html' | 'json';
export type ExportTheme = 'light' | 'dark';

export interface ExportOptions {
  theme?: ExportTheme;
  enableInference?: boolean;
  density?: CardDensity;
}

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; extension: string }> = [
  { id: 'mermaid', label: 'Mermaid', extension: 'mmd' },
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'svg', label: 'SVG', extension: 'svg' },
  { id: 'html', label: 'HTML', extension: 'html' },
  { id: 'json', label: 'JSON', extension: 'json' },
];

function visibleRelations(schema: Schema, inferenceOn: boolean): Relation[] {
  return schema.relations.filter((r) => {
    if (r.status === 'rejected') return false;
    if (!inferenceOn && r.kind === 'inferred') return false;
    if (r.missing_target) return false;
    return true;
  });
}

function relationSourceTag(rel: Relation): string {
  if (rel.kind === 'declared') return 'declared';
  if (rel.kind === 'manual') return 'manual';
  if (rel.status === 'confirmed') return 'confirmed';
  if (rel.status === 'rejected') return 'rejected';
  return 'inferred';
}

function sanitizeMermaidIdent(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    out += /[a-zA-Z0-9_-]/.test(ch) ? ch : '_';
  }
  if (!out || /^[0-9]/.test(out)) return `t_${out}`;
  return out;
}

function sanitizeMermaidType(raw: string): string {
  const cleaned = raw.trim().replace(/,\s+/g, ',').replace(/\s+/g, '_');
  return cleaned || 'TEXT';
}

function buildMermaidIdentMap(tables: Table[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const t of tables) {
    counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  }
  const map = new Map<string, string>();
  for (const t of tables) {
    const raw = (counts.get(t.name) ?? 0) > 1 ? `${t.schema}_${t.name}` : t.name;
    map.set(t.id, sanitizeMermaidIdent(raw));
  }
  return map;
}

export function exportMermaid(schema: Schema, options?: ExportOptions): string {
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;
  const active = visibleRelations(schema, inferenceOn);
  const lines: string[] = ['erDiagram'];
  const identMap = buildMermaidIdentMap(schema.tables);

  for (const tbl of schema.tables) {
    const ident = identMap.get(tbl.id)!;
    const pkSet = new Set(tbl.primary_key);
    const uqSet = new Set(tbl.unique_keys.filter((k) => k.length === 1).map((k) => k[0]));
    const fkSet = new Set(
      active.filter((r) => r.from_table === tbl.id).flatMap((r) => r.from_columns),
    );

    if (tbl.kind === 'view') {
      lines.push(`    %% View: ${tbl.id}`);
    } else if (tbl.kind === 'materialized_view') {
      lines.push(`    %% Materialized View: ${tbl.id}`);
    }
    if (tbl.comment && tbl.comment.trim()) {
      lines.push(`    %% ${tbl.comment.replace(/\n+/g, ' ')}`);
    }
    lines.push(`    ${ident} {`);
    for (const col of tbl.columns) {
      const ty = sanitizeMermaidType(col.data_type);
      const cname = sanitizeMermaidIdent(col.name);
      const keyTags: string[] = [];
      if (pkSet.has(col.name)) keyTags.push('PK');
      if (fkSet.has(col.name)) keyTags.push('FK');
      if (uqSet.has(col.name) && !pkSet.has(col.name)) keyTags.push('UK');
      const keyStr = keyTags.length > 0 ? ` ${keyTags.join(',')}` : '';

      const commentParts: string[] = [];
      if (!col.nullable) commentParts.push('NOT NULL');
      if (col.comment && col.comment.trim()) {
        commentParts.push(col.comment.replace(/"/g, "'").replace(/\n+/g, ' '));
      }
      const cmtStr = commentParts.length > 0 ? ` "${commentParts.join('; ')}"` : '';
      lines.push(`        ${ty} ${cname}${keyStr}${cmtStr}`);
    }
    lines.push('    }');
  }

  for (const rel of active) {
    const fromIdent = identMap.get(rel.from_table);
    const toIdent = identMap.get(rel.to_table);
    if (!fromIdent || !toIdent) continue;
    const dashed = rel.kind === 'manual' || (rel.kind === 'inferred' && rel.status !== 'confirmed');
    const connector = dashed ? '||..o{' : '||--o{';
    const colLabel = rel.from_columns.join(', ');
    let tag = ' [declared]';
    if (rel.kind === 'manual') {
      tag = rel.note ? ` [manual: ${rel.note}]` : ' [manual]';
    } else if (rel.kind === 'inferred' && rel.status === 'auto') {
      tag = ' [inferred]';
    } else if (rel.kind === 'inferred' && rel.status === 'confirmed') {
      tag = ' [confirmed]';
    }
    const safeLabel = `${colLabel}${tag}`.replace(/"/g, "'");
    lines.push(`    ${toIdent} ${connector} ${fromIdent} : "${safeLabel}"`);
  }

  return `${lines.join('\n')}\n`;
}

function escapeMdCell(raw: string): string {
  return raw.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function exportMarkdown(schema: Schema, options?: ExportOptions): string {
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;
  const active = visibleRelations(schema, inferenceOn);
  const declaredN = active.filter((r) => r.kind === 'declared').length;
  const manualN = active.filter((r) => r.kind === 'manual').length;

  const summaryRelLine = inferenceOn
    ? `- Relations: \`${active.length}\` active (\`${declaredN}\` declared, \`${manualN}\` manual, \`${active.filter((r) => r.kind === 'inferred').length}\` inferred)`
    : `- Relations: \`${active.length}\` (\`${declaredN}\` declared foreign keys, \`${manualN}\` manual relations)`;

  const lines: string[] = [
    '# RELIX Data Dictionary',
    '',
    `- Dialect: \`${schema.dialect}\``,
    ...(schema.source_meta?.version
      ? [`- Snapshot: \`${schema.source_meta.version}\` (${schema.source_meta.fetched_at ?? ''})`]
      : []),
    `- Tables / Views: \`${schema.tables.length}\``,
    summaryRelLine,
    '',
  ];

  if (schema.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const w of schema.warnings) {
      lines.push(`- ${escapeMdCell(w)}`);
    }
    lines.push('');
  }

  lines.push(
    '## Table Overview',
    '',
    '| Table | Schema | Kind | Columns | Primary Key | Comment |',
    '| --- | --- | --- | ---: | --- | --- |',
  );
  for (const tbl of schema.tables) {
    const kind =
      tbl.kind === 'materialized_view'
        ? 'Materialized View'
        : tbl.kind === 'view'
          ? 'View'
          : tbl.is_partition
            ? 'Partitioned Table'
            : 'Table';
    const pk = tbl.primary_key.length > 0 ? tbl.primary_key.join(', ') : '-';
    const cmt = tbl.comment ?? '-';
    lines.push(
      `| \`${escapeMdCell(tbl.name)}\` | \`${escapeMdCell(tbl.schema)}\` | ${kind} | ${tbl.columns.length} | \`${escapeMdCell(pk)}\` | ${escapeMdCell(cmt)} |`,
    );
  }
  lines.push('');

  for (const tbl of schema.tables) {
    lines.push(`## \`${tbl.id}\``, '');
    if (tbl.comment) {
      lines.push(`> ${escapeMdCell(tbl.comment)}`, '');
    }
    lines.push(
      '| Column | Type | Family | Nullable | Key | Default | Comment |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    const pkSet = new Set(tbl.primary_key);
    const uqSet = new Set(tbl.unique_keys.filter((k) => k.length === 1).map((k) => k[0]));
    const fkSet = new Set(
      active.filter((r) => r.from_table === tbl.id).flatMap((r) => r.from_columns),
    );

    for (const col of tbl.columns) {
      const keys: string[] = [];
      if (pkSet.has(col.name)) keys.push('PK');
      if (fkSet.has(col.name)) keys.push('FK');
      if (uqSet.has(col.name)) keys.push('UQ');
      const keyLabel = keys.length > 0 ? keys.join(', ') : '-';
      const defCell = col.default ? `\`${escapeMdCell(col.default)}\`` : '-';
      const cmtCell = col.comment ? escapeMdCell(col.comment) : '-';
      lines.push(
        `| \`${escapeMdCell(col.name)}\` | \`${escapeMdCell(col.data_type)}\` | \`${formatTypeFamilyLabel(col.type_family)}\` | ${col.nullable ? 'NULL' : 'NOT NULL'} | ${keyLabel} | ${defCell} | ${cmtCell} |`,
      );
    }
    lines.push('');

    if (tbl.indexes.length > 0) {
      lines.push('### Indexes', '');
      for (const ix of tbl.indexes) {
        const kind = ix.unique ? 'UNIQUE INDEX' : 'INDEX';
        lines.push(`- \`${ix.name}\` (${kind}): \`${ix.columns.join(', ')}\``);
      }
      lines.push('');
    }

    const outgoing = active.filter((r) => r.from_table === tbl.id);
    const incoming = active.filter((r) => r.to_table === tbl.id);
    if (outgoing.length > 0 || incoming.length > 0) {
      lines.push('### Relations', '');
      for (const rel of outgoing) {
        const sourceTag = relationSourceTag(rel);
        const noteText = rel.note ? ` — 备注: ${escapeMdCell(rel.note)}` : '';
        lines.push(
          `- References \`${rel.to_table}\` (\`${rel.from_columns.join(', ')}\` → \`${rel.to_columns.join(', ')}\`) [source: ${sourceTag}]${noteText}`,
        );
      }
      for (const rel of incoming) {
        const sourceTag = relationSourceTag(rel);
        lines.push(
          `- Referenced by \`${rel.from_table}\` (\`${rel.from_columns.join(', ')}\` → \`${rel.to_columns.join(', ')}\`) [source: ${sourceTag}]`,
        );
      }
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function layoutBoxesForExport(
  schema: Schema,
  config: ProjectConfig,
  density: CardDensity = 'detailed',
): Record<string, NodeBox> {
  const layout = sugiyamaLayout(schema, DEFAULT_LAYOUT_CONFIG);
  const boxes: Record<string, NodeBox> = {};
  schema.tables.forEach((tbl, idx) => {
    const base = layout.nodes[tbl.id];
    const saved = config.node_positions[tbl.id];
    const x = saved ? saved.x : base ? base.x : 40 + (idx % 4) * 280;
    const y = saved ? saved.y : base ? base.y : 40 + Math.floor(idx / 4) * 240;
    const width = base ? base.width : DEFAULT_LAYOUT_CONFIG.nodeWidth;
    const height = computeDensityTableHeight(tbl, density, density === 'detailed', DEFAULT_LAYOUT_CONFIG);
    boxes[tbl.id] = { x, y, width, height };
  });
  return boxes;
}

export function exportSvg(
  schema: Schema,
  boxes: Record<string, NodeBox>,
  options?: ExportOptions,
): string {
  const theme: ExportTheme = options?.theme ?? 'light';
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;
  const density: CardDensity = options?.density ?? 'detailed';
  const active = visibleRelations(schema, inferenceOn);
  const tableMap = new Map(schema.tables.map((t) => [t.id, t]));

  const pal =
    theme === 'dark'
      ? {
          bg: '#0b1120',
          card: '#1e293b',
          cardStroke: '#334155',
          hdr: '#273449',
          hdrView: '#1e3a5f',
          title: '#f1f5f9',
          colName: '#e2e8f0',
          colPk: '#60a5fa',
          colType: '#94a3b8',
          declared: '#94a3b8',
          manual: '#a78bfa',
          legendBg: '#111827',
          legendStroke: '#334155',
          legendFg: '#cbd5e1',
        }
      : {
          bg: '#f8fafc',
          card: '#ffffff',
          cardStroke: '#cbd5e1',
          hdr: '#e2e8f0',
          hdrView: '#dbeafe',
          title: '#0f172a',
          colName: '#1e293b',
          colPk: '#2563eb',
          colType: '#64748b',
          declared: '#64748b',
          manual: '#7c3aed',
          legendBg: '#ffffff',
          legendStroke: '#cbd5e1',
          legendFg: '#475569',
        };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const boxValues = Object.values(boxes);
  for (const b of boxValues) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (boxValues.length === 0) {
    minX = 0;
    minY = 0;
    maxX = 800;
    maxY = 500;
  }

  const pad = 52;
  const vx = minX - pad;
  const vy = minY - pad - 28;
  const vw = Math.max(460, maxX - minX + pad * 2);
  const vh = Math.max(320, maxY - minY + pad * 2 + 28);

  const allBoxEntries = Object.entries(boxes);

  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${vw.toFixed(1)} ${vh.toFixed(1)}" width="${vw.toFixed(0)}" height="${vh.toFixed(0)}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif">`,
    `  <defs>`,
    `    <marker id="arrow-declared" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="${pal.declared}"/></marker>`,
    `    <marker id="arrow-manual" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,4 L4,0 L8,4 L4,8 Z" fill="${pal.manual}"/></marker>`,
    `    <marker id="dot-manual" markerWidth="6" markerHeight="6" refX="3" refY="3"><circle cx="3" cy="3" r="2.2" fill="${pal.card}" stroke="${pal.manual}" stroke-width="1.4"/></marker>`,
    `  </defs>`,
    `  <style>`,
    `    .bg { fill: ${pal.bg}; }`,
    `    .card { fill: ${pal.card}; stroke: ${pal.cardStroke}; stroke-width: 1.2; }`,
    `    .card-hdr { fill: ${pal.hdr}; }`,
    `    .card-hdr-view { fill: ${pal.hdrView}; }`,
    `    .title { font-size: 12.5px; font-weight: 600; fill: ${pal.title}; }`,
    `    .col-name { font-size: 11px; fill: ${pal.colName}; }`,
    `    .col-pk { font-size: 11px; font-weight: 600; fill: ${pal.colPk}; }`,
    `    .col-type { font-size: 10.5px; fill: ${pal.colType}; }`,
    `    .edge-declared { fill: none; stroke: ${pal.declared}; stroke-width: 1.5; }`,
    `    .edge-manual { fill: none; stroke: ${pal.manual}; stroke-width: 1.7; stroke-dasharray: 5 3; }`,
    `    .legend-box { fill: ${pal.legendBg}; stroke: ${pal.legendStroke}; stroke-width: 1; }`,
    `    .legend-text { font-size: 11px; fill: ${pal.legendFg}; }`,
    `  </style>`,
    `  <rect class="bg" x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}"/>`,
    `  <g id="edges">`,
  ];

  active.forEach((rel, idx) => {
    const fb = boxes[rel.from_table];
    const tb = boxes[rel.to_table];
    if (!fb || !tb) return;

    const fromTbl = tableMap.get(rel.from_table);
    const toTbl = tableMap.get(rel.to_table);
    const fy = getColumnAnchorY(fromTbl, fb, rel.from_columns[0], density, density === 'detailed');
    const ty = getColumnAnchorY(toTbl, tb, rel.to_columns[0], density, density === 'detailed');
    const obstacles = allBoxEntries
      .filter(([id]) => id !== rel.from_table && id !== rel.to_table)
      .map(([, b]) => b);

    const routed = routeOrthogonalEdge(fb, tb, fy, ty, obstacles, idx);
    const d = routed.points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');

    const isManual = rel.kind === 'manual';
    const cls = isManual ? 'edge-manual' : 'edge-declared';
    const markerStart = isManual ? ' marker-start="url(#dot-manual)"' : '';
    const markerEnd = isManual ? 'url(#arrow-manual)' : 'url(#arrow-declared)';
    const sourceAttr = relationSourceTag(rel);

    lines.push(
      `    <path class="er-edge ${cls}" data-from="${escapeXml(rel.from_table)}" data-to="${escapeXml(rel.to_table)}" data-source="${sourceAttr}" d="${d}"${markerStart} marker-end="${markerEnd}"/>`,
    );
  });

  lines.push('  </g>', '  <g id="tables">');

  for (const tbl of schema.tables) {
    const b = boxes[tbl.id];
    if (!b) continue;
    const pkSet = new Set(tbl.primary_key);
    const isView = tbl.kind === 'view' || tbl.kind === 'materialized_view';
    const hdrClass = isView ? 'card-hdr-view' : 'card-hdr';
    const titleLabel =
      tbl.kind === 'materialized_view'
        ? `[MVIEW] ${tbl.name}`
        : tbl.kind === 'view'
          ? `[VIEW] ${tbl.name}`
          : tbl.name;

    lines.push(
      `    <g class="er-table" data-table-id="${escapeXml(tbl.id)}" data-table-name="${escapeXml(tbl.name)}">`,
      `      <rect class="card" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.width.toFixed(1)}" height="${b.height.toFixed(1)}" rx="6"/>`,
      `      <rect class="${hdrClass}" x="${b.x.toFixed(1)}" y="${b.y.toFixed(1)}" width="${b.width.toFixed(1)}" height="32" rx="6"/>`,
      `      <text class="title" x="${(b.x + 10).toFixed(1)}" y="${(b.y + 20.5).toFixed(1)}">${escapeXml(titleLabel)}</text>`,
    );

    if (density !== 'compact') {
      const limit = density === 'detailed' ? tbl.columns.length : 4;
      tbl.columns.slice(0, limit).forEach((col, idx) => {
        const cy = b.y + 49 + idx * 20;
        if (cy + 4 > b.y + b.height) return;
        const isPk = pkSet.has(col.name);
        const nameText = isPk ? `PK ${col.name}` : col.name;
        lines.push(
          `      <text class="${isPk ? 'col-pk' : 'col-name'}" x="${(b.x + 10).toFixed(1)}" y="${cy.toFixed(1)}">${escapeXml(nameText)}</text>`,
          `      <text class="col-type" x="${(b.x + b.width - 10).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="end">${escapeXml(col.data_type)}</text>`,
        );
      });
    }
    lines.push('    </g>');
  }

  // Track E2: Built-in crisp legend at top-right of SVG
  const legW = 248;
  const legH = 26;
  const legX = vx + vw - legW - 14;
  const legY = vy + 10;
  lines.push(
    `  </g>`,
    `  <g id="legend">`,
    `    <rect class="legend-box" x="${legX.toFixed(1)}" y="${legY.toFixed(1)}" width="${legW}" height="${legH}" rx="5"/>`,
    `    <line x1="${(legX + 12).toFixed(1)}" y1="${(legY + 13).toFixed(1)}" x2="${(legX + 34).toFixed(1)}" y2="${(legY + 13).toFixed(1)}" class="edge-declared"/>`,
    `    <text class="legend-text" x="${(legX + 40).toFixed(1)}" y="${(legY + 17).toFixed(1)}">声明外键 (FK)</text>`,
    `    <line x1="${(legX + 126).toFixed(1)}" y1="${(legY + 13).toFixed(1)}" x2="${(legX + 148).toFixed(1)}" y2="${(legY + 13).toFixed(1)}" class="edge-manual"/>`,
    `    <text class="legend-text" x="${(legX + 154).toFixed(1)}" y="${(legY + 17).toFixed(1)}">手动关系 (Manual)</text>`,
    `  </g>`,
    `</svg>`,
  );
  return `${lines.join('\n')}\n`;
}

export function exportHtml(
  schema: Schema,
  boxes: Record<string, NodeBox>,
  options?: ExportOptions,
): string {
  const theme: ExportTheme = options?.theme ?? 'light';
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;
  const cleanSchema = exportJsonObject(schema, inferenceOn);
  const svg = exportSvg(cleanSchema, boxes, options);
  const safeJson = JSON.stringify(cleanSchema).replace(/<\//g, '<\\/');

  const isDark = theme === 'dark';
  const bodyBg = isDark ? '#0b1120' : '#f8fafc';
  const bodyFg = isDark ? '#e2e8f0' : '#0f172a';
  const barBg = isDark ? '#111827' : '#ffffff';
  const barBorder = isDark ? '#334155' : '#cbd5e1';
  const inputBg = isDark ? '#0f172a' : '#f8fafc';
  const mutedFg = isDark ? '#94a3b8' : '#64748b';
  const cardBg = isDark ? '#1e293b' : '#ffffff';
  const manualColor = isDark ? '#a78bfa' : '#7c3aed';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RELIX 交互式 ER 图导出</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: ${bodyBg}; color: ${bodyFg}; display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }
    header {
      display: flex; align-items: center; gap: 10px; padding: 8px 14px;
      background: ${barBg}; border-bottom: 1px solid ${barBorder}; font-size: 13px;
    }
    header strong { font-size: 14px; letter-spacing: 0.4px; }
    header input {
      background: ${inputBg}; color: ${bodyFg}; border: 1px solid ${barBorder}; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; width: 220px;
    }
    header button {
      background: ${cardBg}; color: ${bodyFg}; border: 1px solid ${barBorder}; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; cursor: pointer;
    }
    .legend { margin-left: auto; display: flex; gap: 14px; font-size: 12px; color: ${mutedFg}; }
    .workspace { flex: 1; display: flex; min-height: 0; position: relative; }
    #viewport { flex: 1; overflow: hidden; cursor: grab; background: ${bodyBg}; }
    #viewport:active { cursor: grabbing; }
    #viewport svg { width: 100%; height: 100%; display: block; }
    .er-table { cursor: pointer; transition: opacity 120ms ease; }
    .er-edge { transition: opacity 120ms ease; }
    .dimmed { opacity: 0.18; }
    .selected .card { stroke: #2563eb; stroke-width: 2.5; }
    aside {
      width: 320px; background: ${barBg}; border-left: 1px solid ${barBorder}; padding: 12px;
      overflow-y: auto; font-size: 12px; line-height: 1.5;
    }
    aside h3 { margin: 0 0 6px; font-size: 14px; color: ${bodyFg}; }
    .pill { display: inline-block; padding: 1px 6px; border-radius: 4px; background: ${barBorder}; font-size: 11px; }
    .col-item { padding: 6px 8px; margin: 5px 0; border-radius: 6px; background: ${cardBg}; border: 1px solid ${barBorder}; }
    .cmt { color: ${mutedFg}; margin-top: 3px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <header>
    <strong>RELIX</strong>
    <input id="search" type="search" placeholder="搜索表名或字段名..." />
    <button id="btn-reset" type="button">重置视图</button>
    <div class="legend">
      <span>─── 声明外键 (Declared)</span>
      <span style="color:${manualColor}">◇ - - 手动关系 (Manual)</span>
    </div>
  </header>
  <div class="workspace">
    <div id="viewport">${svg}</div>
    <aside id="inspector">
      <h3>Schema 概览</h3>
      <p>点击任意表卡片可高亮 1 跳上下游关联并查看字段与注释详情。</p>
    </aside>
  </div>
  <script id="relix-schema" type="application/json">${safeJson}</script>
  <script>
    (() => {
      const schema = JSON.parse(document.getElementById('relix-schema').textContent);
      const viewport = document.getElementById('viewport');
      const svg = viewport.querySelector('svg');
      const inspector = document.getElementById('inspector');
      const searchInput = document.getElementById('search');
      const vb = svg.viewBox.baseVal;
      const orig = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      let dragging = false, lastX = 0, lastY = 0;

      const tables = Array.from(svg.querySelectorAll('.er-table'));
      const edges = Array.from(svg.querySelectorAll('.er-edge'));
      const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      function selectTable(tid) {
        if (!tid) {
          tables.forEach(t => t.classList.remove('dimmed', 'selected'));
          edges.forEach(e => e.classList.remove('dimmed'));
          inspector.innerHTML = '<h3>Schema 概览</h3><p>' + schema.tables.length + ' 张表 / 视图，' + schema.relations.length + ' 条关系。</p>';
          return;
        }
        const neighbors = new Set([tid]);
        edges.forEach(e => {
          const f = e.dataset.from, t = e.dataset.to;
          if (f === tid || t === tid) { neighbors.add(f); neighbors.add(t); e.classList.remove('dimmed'); }
          else { e.classList.add('dimmed'); }
        });
        tables.forEach(g => {
          const id = g.dataset.tableId;
          g.classList.toggle('selected', id === tid);
          g.classList.toggle('dimmed', !neighbors.has(id));
        });
        const tbl = schema.tables.find(t => t.id === tid);
        if (!tbl) return;
        const pks = new Set(tbl.primary_key || []);
        const colsHtml = tbl.columns.map(c =>
          '<div class="col-item"><strong>' + esc(c.name) + '</strong> ' + (pks.has(c.name) ? '<span class="pill">PK</span> ' : '') +
          '<span style="color:${mutedFg}">' + esc(c.data_type) + (c.nullable ? ' NULL' : ' NOT NULL') + '</span>' +
          (c.comment ? '<div class="cmt">' + esc(c.comment) + '</div>' : '') + '</div>'
        ).join('');
        inspector.innerHTML = '<h3>' + esc(tbl.name) + '</h3><div style="color:${mutedFg};margin-bottom:6px">' + esc(tbl.id) + '</div>' +
          (tbl.comment ? '<div class="cmt" style="margin-bottom:8px">' + esc(tbl.comment) + '</div>' : '') + colsHtml;
      }

      tables.forEach(g => g.addEventListener('click', ev => { ev.stopPropagation(); selectTable(g.dataset.tableId); }));
      svg.addEventListener('click', () => selectTable(null));

      viewport.addEventListener('wheel', ev => {
        ev.preventDefault();
        const scale = ev.deltaY > 0 ? 1.12 : 0.89;
        const rect = svg.getBoundingClientRect();
        const rx = (ev.clientX - rect.left) / rect.width;
        const ry = (ev.clientY - rect.top) / rect.height;
        const nw = vb.width * scale, nh = vb.height * scale;
        vb.x += (vb.width - nw) * rx;
        vb.y += (vb.height - nh) * ry;
        vb.width = nw; vb.height = nh;
      }, { passive: false });

      viewport.addEventListener('mousedown', ev => { dragging = true; lastX = ev.clientX; lastY = ev.clientY; });
      window.addEventListener('mouseup', () => { dragging = false; });
      window.addEventListener('mousemove', ev => {
        if (!dragging) return;
        const rect = svg.getBoundingClientRect();
        vb.x -= (ev.clientX - lastX) * (vb.width / rect.width);
        vb.y -= (ev.clientY - lastY) * (vb.height / rect.height);
        lastX = ev.clientX; lastY = ev.clientY;
      });

      document.getElementById('btn-reset').addEventListener('click', () => {
        vb.x = orig.x; vb.y = orig.y; vb.width = orig.w; vb.height = orig.h; selectTable(null);
      });

      searchInput.addEventListener('input', () => {
        const q = searchInput.value.trim().toLowerCase();
        if (!q) { selectTable(null); return; }
        const matched = schema.tables.filter(t =>
          t.name.toLowerCase().includes(q) || t.columns.some(c => c.name.toLowerCase().includes(q))
        );
        if (matched.length === 1) selectTable(matched[0].id);
        else {
          const ids = new Set(matched.map(t => t.id));
          tables.forEach(g => g.classList.toggle('dimmed', !ids.has(g.dataset.tableId)));
        }
      });
    })();
  </script>
</body>
</html>
`;
}

export function exportJsonObject(schema: Schema, inferenceOn = ENABLE_INFERENCE): Schema {
  const relations = visibleRelations(schema, inferenceOn).map((r) => {
    if (!inferenceOn) {
      // Track F2: Strip internal inference-only fields when inference is disabled
      return {
        id: r.id,
        from_table: r.from_table,
        from_columns: [...r.from_columns],
        to_table: r.to_table,
        to_columns: [...r.to_columns],
        kind: r.kind,
        status: r.kind === 'manual' ? ('confirmed' as const) : ('auto' as const),
        evidence: r.kind === 'manual' ? [...r.evidence] : [],
        ...(r.note ? { note: r.note } : {}),
      };
    }
    return { ...r };
  });

  return {
    dialect: schema.dialect,
    tables: schema.tables,
    relations,
    warnings: schema.warnings,
    ...(schema.source_meta ? { source_meta: schema.source_meta } : {}),
  };
}

export function renderExport(
  schema: Schema,
  config: ProjectConfig,
  format: ExportFormat,
  options?: ExportOptions,
): string {
  const inferenceOn = options?.enableInference ?? ENABLE_INFERENCE;
  switch (format) {
    case 'mermaid':
      return exportMermaid(schema, options);
    case 'markdown':
      return exportMarkdown(schema, options);
    case 'svg':
      return exportSvg(schema, layoutBoxesForExport(schema, config, options?.density ?? 'detailed'), options);
    case 'html':
      return exportHtml(schema, layoutBoxesForExport(schema, config, options?.density ?? 'detailed'), options);
    case 'json':
      return JSON.stringify(exportJsonObject(schema, inferenceOn), null, 2);
  }
}
