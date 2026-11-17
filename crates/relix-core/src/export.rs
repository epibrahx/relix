use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;

use crate::model::{Relation, RelationKind, RelationStatus, Schema, Table, TableKind};

/// Exported node rectangle (in world coordinates), decoupled from `relix-layout`
/// so `relix-core` remains zero-internal-dependency and WASM-compatible.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExportNodeBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl ExportNodeBox {
    pub fn center(self) -> (f32, f32) {
        (self.x + self.width * 0.5, self.y + self.height * 0.5)
    }
}

/// Export `Schema` to Mermaid `erDiagram` syntax (`P6-T1`).
///
/// - Declared and confirmed relations use solid syntax (`||--o{`).
/// - Unconfirmed auto-inferred relations use dashed syntax (`||..o{`) and carry `[inferred]`.
/// - Rejected relations are omitted.
pub fn export_mermaid(schema: &Schema) -> String {
    let mut out = String::new();
    out.push_str("erDiagram\n");

    let ident_map = build_mermaid_ident_map(&schema.tables);

    for tbl in &schema.tables {
        let ident = &ident_map[&tbl.id];
        let pk_set: HashSet<&str> = tbl.primary_key.iter().map(String::as_str).collect();
        let uq_set: HashSet<&str> = tbl
            .unique_keys
            .iter()
            .filter(|k| k.len() == 1)
            .flat_map(|k| k.iter().map(String::as_str))
            .collect();
        let fk_set: HashSet<&str> = schema
            .relations
            .iter()
            .filter(|r| r.from_table == tbl.id && r.status != RelationStatus::Rejected)
            .flat_map(|r| r.from_columns.iter().map(String::as_str))
            .collect();

        if tbl.kind == TableKind::View {
            let _ = writeln!(out, "    %% View: {}", tbl.id);
        }
        let _ = writeln!(out, "    {ident} {{");
        for col in &tbl.columns {
            let ty = sanitize_mermaid_type(&col.data_type);
            let cname = sanitize_mermaid_ident(&col.name);
            let mut key_tags = Vec::new();
            if pk_set.contains(col.name.as_str()) {
                key_tags.push("PK");
            }
            if fk_set.contains(col.name.as_str()) {
                key_tags.push("FK");
            }
            if uq_set.contains(col.name.as_str()) && !pk_set.contains(col.name.as_str()) {
                key_tags.push("UK");
            }
            let key_str = if key_tags.is_empty() {
                String::new()
            } else {
                format!(" {}", key_tags.join(","))
            };
            let mut comment_parts = Vec::new();
            if !col.nullable {
                comment_parts.push("NOT NULL".to_string());
            }
            if let Some(cmt) = &col.comment
                && !cmt.trim().is_empty()
            {
                comment_parts.push(cmt.replace('"', "'"));
            }
            let cmt_str = if comment_parts.is_empty() {
                String::new()
            } else {
                format!(" \"{}\"", comment_parts.join("; "))
            };
            let _ = writeln!(out, "        {ty} {cname}{key_str}{cmt_str}");
        }
        out.push_str("    }\n");
    }

    for rel in active_relations(schema) {
        let Some(from_ident) = ident_map.get(&rel.from_table) else {
            continue;
        };
        let Some(to_ident) = ident_map.get(&rel.to_table) else {
            continue;
        };
        let dashed = rel.kind == RelationKind::Inferred && rel.status != RelationStatus::Confirmed;
        let connector = if dashed { "||..o{" } else { "||--o{" };
        let col_label = rel.from_columns.join(", ");
        let tag = match (rel.kind, rel.status) {
            (RelationKind::Declared, _) => String::new(),
            (RelationKind::Inferred, RelationStatus::Auto) => " [inferred]".to_string(),
            (RelationKind::Inferred, RelationStatus::Confirmed) => " [confirmed]".to_string(),
            (RelationKind::Inferred, RelationStatus::Rejected) => continue,
        };
        let safe_label = format!("{col_label}{tag}").replace('"', "'");
        let _ = writeln!(
            out,
            "    {to_ident} {connector} {from_ident} : \"{safe_label}\""
        );
    }

    out
}

/// Export `Schema` as a Markdown data dictionary (`P6-T2`).
pub fn export_markdown(schema: &Schema) -> String {
    let mut out = String::new();
    let active: Vec<&Relation> = active_relations(schema).collect();
    let declared_n = active
        .iter()
        .filter(|r| r.kind == RelationKind::Declared)
        .count();
    let inferred_auto_n = active
        .iter()
        .filter(|r| r.kind == RelationKind::Inferred && r.status == RelationStatus::Auto)
        .count();
    let confirmed_n = active
        .iter()
        .filter(|r| r.status == RelationStatus::Confirmed)
        .count();

    out.push_str("# RELIX Data Dictionary\n\n");
    let _ = writeln!(out, "- Dialect: `{}`", dialect_name(schema));
    let _ = writeln!(out, "- Tables / Views: `{}`", schema.tables.len());
    let _ = writeln!(
        out,
        "- Relations: `{}` active (`{declared_n}` declared, `{inferred_auto_n}` inferred-auto, `{confirmed_n}` confirmed)\n",
        active.len()
    );

    if !schema.warnings.is_empty() {
        out.push_str("## Warnings\n\n");
        for w in &schema.warnings {
            let _ = writeln!(out, "- {}", escape_md_cell(w));
        }
        out.push('\n');
    }

    out.push_str("## Table Overview\n\n");
    out.push_str("| Table | Schema | Kind | Columns | Primary Key | Comment |\n");
    out.push_str("| --- | --- | --- | ---: | --- | --- |\n");
    for tbl in &schema.tables {
        let kind = if tbl.kind == TableKind::View {
            "View"
        } else {
            "Table"
        };
        let pk = if tbl.primary_key.is_empty() {
            "-".to_string()
        } else {
            tbl.primary_key.join(", ")
        };
        let comment = tbl.comment.as_deref().unwrap_or("-");
        let _ = writeln!(
            out,
            "| `{}` | `{}` | {kind} | {} | `{}` | {} |",
            escape_md_cell(&tbl.name),
            escape_md_cell(&tbl.schema),
            tbl.columns.len(),
            escape_md_cell(&pk),
            escape_md_cell(comment),
        );
    }
    out.push('\n');

    for tbl in &schema.tables {
        let _ = writeln!(out, "## `{}`\n", tbl.id);
        if let Some(cmt) = &tbl.comment {
            let _ = writeln!(out, "> {}\n", escape_md_cell(cmt));
        }
        out.push_str("| Column | Type | Family | Nullable | Key | Default | Comment |\n");
        out.push_str("| --- | --- | --- | --- | --- | --- | --- |\n");
        let pk_set: HashSet<&str> = tbl.primary_key.iter().map(String::as_str).collect();
        let uq_set: HashSet<&str> = tbl
            .unique_keys
            .iter()
            .filter(|k| k.len() == 1)
            .flat_map(|k| k.iter().map(String::as_str))
            .collect();

        for col in &tbl.columns {
            let mut key_parts = Vec::new();
            if pk_set.contains(col.name.as_str()) {
                key_parts.push("PK");
            }
            if uq_set.contains(col.name.as_str()) {
                key_parts.push("UQ");
            }
            let key_label = if key_parts.is_empty() {
                "-".to_string()
            } else {
                key_parts.join(", ")
            };
            let _ = writeln!(
                out,
                "| `{}` | `{}` | `{:?}` | {} | {} | {} | {} |",
                escape_md_cell(&col.name),
                escape_md_cell(&col.data_type),
                col.type_family,
                if col.nullable { "NULL" } else { "NOT NULL" },
                key_label,
                col.default
                    .as_deref()
                    .map(|d| format!("`{}`", escape_md_cell(d)))
                    .unwrap_or_else(|| "-".to_string()),
                col.comment
                    .as_deref()
                    .map(escape_md_cell)
                    .unwrap_or_else(|| "-".to_string()),
            );
        }
        out.push('\n');

        if !tbl.indexes.is_empty() {
            out.push_str("### Indexes\n\n");
            for ix in &tbl.indexes {
                let kind = if ix.unique { "UNIQUE INDEX" } else { "INDEX" };
                let _ = writeln!(out, "- `{}` ({kind}): `{}`", ix.name, ix.columns.join(", "));
            }
            out.push('\n');
        }

        let outgoing: Vec<&Relation> = active
            .iter()
            .copied()
            .filter(|r| r.from_table == tbl.id)
            .collect();
        let incoming: Vec<&Relation> = active
            .iter()
            .copied()
            .filter(|r| r.to_table == tbl.id)
            .collect();

        if !outgoing.is_empty() || !incoming.is_empty() {
            out.push_str("### Relations\n\n");
            for rel in outgoing {
                let status_label = relation_badge(rel);
                let evidence = if rel.evidence.is_empty() {
                    String::new()
                } else {
                    format!(" — {}", rel.evidence.join("; "))
                };
                let _ = writeln!(
                    out,
                    "- References `{}` (`{}` → `{}`) [{status_label}]{evidence}",
                    rel.to_table,
                    rel.from_columns.join(", "),
                    rel.to_columns.join(", ")
                );
            }
            for rel in incoming {
                let status_label = relation_badge(rel);
                let _ = writeln!(
                    out,
                    "- Referenced by `{}` (`{}` → `{}`) [{status_label}]",
                    rel.from_table,
                    rel.from_columns.join(", "),
                    rel.to_columns.join(", ")
                );
            }
            out.push('\n');
        }
    }

    out
}

/// Export `Schema` and node boxes into a self-contained SVG ER diagram (`P6-T3`).
pub fn export_svg(schema: &Schema, boxes: &HashMap<String, ExportNodeBox>) -> String {
    let resolved = resolve_export_boxes(schema, boxes);
    let mut min_x = f32::MAX;
    let mut min_y = f32::MAX;
    let mut max_x = f32::MIN;
    let mut max_y = f32::MIN;

    for b in resolved.values() {
        min_x = min_x.min(b.x);
        min_y = min_y.min(b.y);
        max_x = max_x.max(b.x + b.width);
        max_y = max_y.max(b.y + b.height);
    }
    if resolved.is_empty() {
        min_x = 0.0;
        min_y = 0.0;
        max_x = 800.0;
        max_y = 500.0;
    }

    let pad = 40.0;
    let vx = min_x - pad;
    let vy = min_y - pad;
    let vw = (max_x - min_x + pad * 2.0).max(400.0);
    let vh = (max_y - min_y + pad * 2.0).max(300.0);

    let mut out = String::new();
    let _ = writeln!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{vx:.1} {vy:.1} {vw:.1} {vh:.1}\" width=\"{vw:.0}\" height=\"{vh:.0}\" font-family=\"-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif\">"
    );
    out.push_str(
        r##"  <defs>
    <marker id="arrow-declared" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#64748b"/>
    </marker>
    <marker id="arrow-inferred" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#d97706"/>
    </marker>
    <marker id="arrow-confirmed" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#16a34a"/>
    </marker>
  </defs>
  <style>
    .bg { fill: #f8fafc; }
    .card { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1.2; }
    .card-hdr { fill: #e2e8f0; }
    .card-hdr-view { fill: #dbeafe; }
    .title { font-size: 12.5px; font-weight: 600; fill: #0f172a; }
    .col-name { font-size: 11px; fill: #1e293b; }
    .col-pk { font-size: 11px; font-weight: 600; fill: #2563eb; }
    .col-type { font-size: 10.5px; fill: #64748b; }
    .edge-declared { fill: none; stroke: #64748b; stroke-width: 1.6; }
    .edge-inferred { fill: none; stroke: #d97706; stroke-width: 1.6; stroke-dasharray: 6 4; }
    .edge-confirmed { fill: none; stroke: #16a34a; stroke-width: 1.8; }
  </style>
"##,
    );
    let _ = writeln!(
        out,
        "  <rect class=\"bg\" x=\"{vx:.1}\" y=\"{vy:.1}\" width=\"{vw:.1}\" height=\"{vh:.1}\"/>"
    );

    // Edges layer
    out.push_str("  <g id=\"edges\">\n");
    for rel in active_relations(schema) {
        let (Some(fb), Some(tb)) = (resolved.get(&rel.from_table), resolved.get(&rel.to_table))
        else {
            continue;
        };
        let (class, marker) = match (rel.kind, rel.status) {
            (RelationKind::Declared, _) => ("edge-declared", "url(#arrow-declared)"),
            (RelationKind::Inferred, RelationStatus::Auto) => {
                ("edge-inferred", "url(#arrow-inferred)")
            }
            (RelationKind::Inferred, RelationStatus::Confirmed) => {
                ("edge-confirmed", "url(#arrow-confirmed)")
            }
            (RelationKind::Inferred, RelationStatus::Rejected) => continue,
        };
        let d = if rel.from_table == rel.to_table {
            let sx = fb.x + fb.width;
            let sy = fb.y + 18.0;
            format!(
                "M {sx:.1} {sy:.1} L {:.1} {sy:.1} L {:.1} {:.1} L {sx:.1} {:.1}",
                sx + 20.0,
                sx + 20.0,
                sy + 24.0,
                sy + 24.0
            )
        } else {
            let (fx, fy) = fb.center();
            let (tx, ty) = tb.center();
            let mid_y = (fy + ty) * 0.5;
            format!("M {fx:.1} {fy:.1} L {fx:.1} {mid_y:.1} L {tx:.1} {mid_y:.1} L {tx:.1} {ty:.1}")
        };
        let _ = writeln!(
            out,
            "    <path class=\"er-edge {class}\" data-from=\"{}\" data-to=\"{}\" data-kind=\"{}\" d=\"{d}\" marker-end=\"{marker}\"/>",
            escape_xml(&rel.from_table),
            escape_xml(&rel.to_table),
            relation_badge(rel),
        );
    }
    out.push_str("  </g>\n");

    // Table cards layer
    out.push_str("  <g id=\"tables\">\n");
    for tbl in &schema.tables {
        let Some(b) = resolved.get(&tbl.id) else {
            continue;
        };
        let pk_set: HashSet<&str> = tbl.primary_key.iter().map(String::as_str).collect();
        let hdr_class = if tbl.kind == TableKind::View {
            "card-hdr-view"
        } else {
            "card-hdr"
        };
        let _ = writeln!(
            out,
            "    <g class=\"er-table\" data-table-id=\"{}\" data-table-name=\"{}\">",
            escape_xml(&tbl.id),
            escape_xml(&tbl.name),
        );
        let _ = writeln!(
            out,
            "      <rect class=\"card\" x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" rx=\"6\"/>",
            b.x, b.y, b.width, b.height
        );
        let _ = writeln!(
            out,
            "      <rect class=\"{hdr_class}\" x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"30\" rx=\"6\"/>",
            b.x, b.y, b.width
        );
        let _ = writeln!(
            out,
            "      <text class=\"title\" x=\"{:.1}\" y=\"{:.1}\">{}</text>",
            b.x + 10.0,
            b.y + 19.5,
            escape_xml(&tbl.name)
        );

        let visible_cols = tbl.columns.iter().take(12);
        for (idx, col) in visible_cols.enumerate() {
            let cy = b.y + 48.0 + (idx as f32) * 19.0;
            if cy + 8.0 > b.y + b.height {
                break;
            }
            let is_pk = pk_set.contains(col.name.as_str());
            let name_text = if is_pk {
                format!("PK {}", col.name)
            } else {
                col.name.clone()
            };
            let _ = writeln!(
                out,
                "      <text class=\"{}\" x=\"{:.1}\" y=\"{cy:.1}\">{}</text>",
                if is_pk { "col-pk" } else { "col-name" },
                b.x + 10.0,
                escape_xml(&name_text),
            );
            let _ = writeln!(
                out,
                "      <text class=\"col-type\" x=\"{:.1}\" y=\"{cy:.1}\" text-anchor=\"end\">{}</text>",
                b.x + b.width - 10.0,
                escape_xml(&col.data_type),
            );
        }
        out.push_str("    </g>\n");
    }
    out.push_str("  </g>\n");
    out.push_str("</svg>\n");
    out
}

/// Export `Schema` + node boxes into a zero-dependency interactive single-file HTML viewer (`P6-T4`).
pub fn export_html(schema: &Schema, boxes: &HashMap<String, ExportNodeBox>) -> String {
    let svg = export_svg(schema, boxes);
    let schema_json = serde_json::to_string(schema).unwrap_or_else(|_| "{}".to_string());
    // Prevent accidental `</script>` breakout inside embedded JSON.
    let safe_json = schema_json.replace("</", "<\\/");

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RELIX Interactive Schema Export</title>
  <style>
    :root {{ color-scheme: light dark; }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
      background: #0f172a; color: #e2e8f0; display: flex; flex-direction: column; height: 100vh; overflow: hidden;
    }}
    header {{
      display: flex; align-items: center; gap: 10px; padding: 8px 14px;
      background: #1e293b; border-bottom: 1px solid #334155; font-size: 13px;
    }}
    header strong {{ font-size: 14px; letter-spacing: 0.4px; }}
    header input {{
      background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; width: 220px;
    }}
    header button {{
      background: #334155; color: #f8fafc; border: 1px solid #475569; border-radius: 6px;
      padding: 5px 10px; font-size: 12px; cursor: pointer;
    }}
    header button:hover {{ background: #475569; }}
    .legend {{ margin-left: auto; display: flex; gap: 12px; font-size: 12px; color: #cbd5e1; }}
    .workspace {{ flex: 1; display: flex; min-height: 0; position: relative; }}
    #viewport {{ flex: 1; overflow: hidden; cursor: grab; background: #f8fafc; }}
    #viewport:active {{ cursor: grabbing; }}
    #viewport svg {{ width: 100%; height: 100%; display: block; }}
    .er-table {{ cursor: pointer; transition: opacity 120ms ease; }}
    .er-edge {{ transition: opacity 120ms ease; }}
    .dimmed {{ opacity: 0.18; }}
    .selected .card {{ stroke: #2563eb; stroke-width: 2.5; }}
    aside {{
      width: 320px; background: #1e293b; border-left: 1px solid #334155; padding: 12px;
      overflow-y: auto; font-size: 12px; line-height: 1.45;
    }}
    aside h3 {{ margin: 0 0 6px; font-size: 14px; color: #f8fafc; }}
    .pill {{ display: inline-block; padding: 1px 6px; border-radius: 4px; background: #334155; font-size: 11px; }}
    .col-item {{ padding: 5px 7px; margin: 4px 0; border-radius: 5px; background: #0f172a; border: 1px solid #334155; }}
  </style>
</head>
<body>
  <header>
    <strong>RELIX</strong>
    <input id="search" type="search" placeholder="Search table or column..." />
    <button id="btn-reset" type="button">Reset View</button>
    <div class="legend">
      <span>─── Declared</span>
      <span style="color:#f59e0b">- - - Inferred (Auto)</span>
      <span style="color:#22c55e">─── Confirmed</span>
    </div>
  </header>
  <div class="workspace">
    <div id="viewport">{svg}</div>
    <aside id="inspector">
      <h3>Schema Overview</h3>
      <p>Click any table card to highlight direct 1-hop upstream/downstream relations and inspect columns.</p>
    </aside>
  </div>
  <script id="relix-schema" type="application/json">{safe_json}</script>
  <script>
    (() => {{
      const schema = JSON.parse(document.getElementById('relix-schema').textContent);
      const viewport = document.getElementById('viewport');
      const svg = viewport.querySelector('svg');
      const inspector = document.getElementById('inspector');
      const searchInput = document.getElementById('search');
      const vb = svg.viewBox.baseVal;
      const orig = {{ x: vb.x, y: vb.y, w: vb.width, h: vb.height }};
      let dragging = false, lastX = 0, lastY = 0;

      const tables = Array.from(svg.querySelectorAll('.er-table'));
      const edges = Array.from(svg.querySelectorAll('.er-edge'));

      function selectTable(tid) {{
        if (!tid) {{
          tables.forEach(t => t.classList.remove('dimmed', 'selected'));
          edges.forEach(e => e.classList.remove('dimmed'));
          inspector.innerHTML = '<h3>Schema Overview</h3><p>' + schema.tables.length + ' tables, ' + schema.relations.length + ' relations.</p>';
          return;
        }}
        const neighbors = new Set([tid]);
        edges.forEach(e => {{
          const f = e.dataset.from, t = e.dataset.to;
          if (f === tid || t === tid) {{ neighbors.add(f); neighbors.add(t); e.classList.remove('dimmed'); }}
          else {{ e.classList.add('dimmed'); }}
        }});
        tables.forEach(g => {{
          const id = g.dataset.tableId;
          g.classList.toggle('selected', id === tid);
          g.classList.toggle('dimmed', !neighbors.has(id));
        }});
        const tbl = schema.tables.find(t => t.id === tid);
        if (!tbl) return;
        const pks = new Set(tbl.primary_key || []);
        const colsHtml = tbl.columns.map(c =>
          '<div class="col-item"><strong>' + c.name + '</strong> ' + (pks.has(c.name) ? '<span class="pill">PK</span> ' : '') +
          '<span style="color:#94a3b8">' + c.data_type + (c.nullable ? ' NULL' : ' NOT NULL') + '</span></div>'
        ).join('');
        inspector.innerHTML = '<h3>' + tbl.name + '</h3><div style="color:#94a3b8;margin-bottom:8px">' + tbl.id + '</div>' + colsHtml;
      }}

      tables.forEach(g => g.addEventListener('click', ev => {{ ev.stopPropagation(); selectTable(g.dataset.tableId); }}));
      svg.addEventListener('click', () => selectTable(null));

      viewport.addEventListener('wheel', ev => {{
        ev.preventDefault();
        const scale = ev.deltaY > 0 ? 1.12 : 0.89;
        const rect = svg.getBoundingClientRect();
        const rx = (ev.clientX - rect.left) / rect.width;
        const ry = (ev.clientY - rect.top) / rect.height;
        const nw = vb.width * scale, nh = vb.height * scale;
        vb.x += (vb.width - nw) * rx;
        vb.y += (vb.height - nh) * ry;
        vb.width = nw; vb.height = nh;
      }}, {{ passive: false }});

      viewport.addEventListener('mousedown', ev => {{ dragging = true; lastX = ev.clientX; lastY = ev.clientY; }});
      window.addEventListener('mouseup', () => {{ dragging = false; }});
      window.addEventListener('mousemove', ev => {{
        if (!dragging) return;
        const rect = svg.getBoundingClientRect();
        vb.x -= (ev.clientX - lastX) * (vb.width / rect.width);
        vb.y -= (ev.clientY - lastY) * (vb.height / rect.height);
        lastX = ev.clientX; lastY = ev.clientY;
      }});

      document.getElementById('btn-reset').addEventListener('click', () => {{
        vb.x = orig.x; vb.y = orig.y; vb.width = orig.w; vb.height = orig.h; selectTable(null);
      }});

      searchInput.addEventListener('input', () => {{
        const q = searchInput.value.trim().toLowerCase();
        if (!q) {{ selectTable(null); return; }}
        const matched = schema.tables.filter(t =>
          t.name.toLowerCase().includes(q) || t.columns.some(c => c.name.toLowerCase().includes(q))
        );
        if (matched.length === 1) selectTable(matched[0].id);
        else {{
          const ids = new Set(matched.map(t => t.id));
          tables.forEach(g => g.classList.toggle('dimmed', !ids.has(g.dataset.tableId)));
        }}
      }});
    }})();
  </script>
</body>
</html>
"#
    )
}

fn active_relations(schema: &Schema) -> impl Iterator<Item = &Relation> {
    schema
        .relations
        .iter()
        .filter(|r| r.status != RelationStatus::Rejected)
}

fn dialect_name(schema: &Schema) -> &'static str {
    match schema.dialect {
        crate::model::Dialect::Postgres => "postgres",
        crate::model::Dialect::Sqlite => "sqlite",
        crate::model::Dialect::Sqlfile => "sqlfile",
    }
}

fn relation_badge(rel: &Relation) -> &'static str {
    match (rel.kind, rel.status) {
        (RelationKind::Declared, _) => "declared",
        (RelationKind::Inferred, RelationStatus::Auto) => "inferred",
        (RelationKind::Inferred, RelationStatus::Confirmed) => "confirmed",
        (RelationKind::Inferred, RelationStatus::Rejected) => "rejected",
    }
}

fn build_mermaid_ident_map(tables: &[Table]) -> BTreeMap<String, String> {
    let mut name_counts: HashMap<&str, usize> = HashMap::new();
    for t in tables {
        *name_counts.entry(t.name.as_str()).or_insert(0) += 1;
    }
    let mut map = BTreeMap::new();
    for t in tables {
        let raw = if name_counts.get(t.name.as_str()).copied().unwrap_or(0) > 1 {
            format!("{}_{}", t.schema, t.name)
        } else {
            t.name.clone()
        };
        map.insert(t.id.clone(), sanitize_mermaid_ident(&raw));
    }
    map
}

fn sanitize_mermaid_ident(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() || out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        format!("t_{out}")
    } else {
        out
    }
}

fn sanitize_mermaid_type(raw: &str) -> String {
    let cleaned = raw.trim().replace(", ", ",").replace(' ', "_");
    if cleaned.is_empty() {
        "TEXT".to_string()
    } else {
        cleaned
    }
}

fn escape_md_cell(raw: &str) -> String {
    raw.replace('|', "\\|").replace('\n', " ")
}

fn escape_xml(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn resolve_export_boxes(
    schema: &Schema,
    boxes: &HashMap<String, ExportNodeBox>,
) -> HashMap<String, ExportNodeBox> {
    let mut out = HashMap::with_capacity(schema.tables.len());
    for (idx, tbl) in schema.tables.iter().enumerate() {
        if let Some(&b) = boxes.get(&tbl.id) {
            out.insert(tbl.id.clone(), b);
        } else {
            let col = (idx % 4) as f32;
            let row = (idx / 4) as f32;
            let height = 42.0 + (tbl.columns.len().min(12) as f32) * 19.0;
            out.insert(
                tbl.id.clone(),
                ExportNodeBox {
                    x: 40.0 + col * 290.0,
                    y: 40.0 + row * 240.0,
                    width: 240.0,
                    height,
                },
            );
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{InferConfig, populate_inferred_relations};

    const SAMPLE_SQL: &str = r#"
        CREATE TABLE authors (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            author_id INTEGER NOT NULL,
            title VARCHAR(200) NOT NULL
        );
        CREATE TABLE comments (
            id INTEGER PRIMARY KEY,
            post_id INTEGER NOT NULL REFERENCES posts(id),
            body TEXT NOT NULL
        );
    "#;

    #[test]
    fn mermaid_distinguishes_declared_inferred_confirmed_and_skips_rejected() {
        let mut schema = crate::parse_sql_schema(SAMPLE_SQL, "main").unwrap();
        populate_inferred_relations(&mut schema, &InferConfig::default());

        let mmd_auto = export_mermaid(&schema);
        assert!(mmd_auto.starts_with("erDiagram\n"));
        assert!(mmd_auto.contains("posts ||--o{ comments : \"post_id\""));
        assert!(mmd_auto.contains("authors ||..o{ posts : \"author_id [inferred]\""));
        assert!(mmd_auto.contains("VARCHAR(200) title"));

        // Confirm inferred relation -> solid `--` and [confirmed] tag.
        let inf_idx = schema
            .relations
            .iter()
            .position(|r| r.kind == RelationKind::Inferred)
            .unwrap();
        schema.relations[inf_idx].status = RelationStatus::Confirmed;
        let mmd_conf = export_mermaid(&schema);
        assert!(mmd_conf.contains("authors ||--o{ posts : \"author_id [confirmed]\""));

        // Reject inferred relation -> omitted completely.
        schema.relations[inf_idx].status = RelationStatus::Rejected;
        let mmd_rej = export_mermaid(&schema);
        assert!(!mmd_rej.contains("author_id ["));
    }

    #[test]
    fn markdown_svg_and_html_exports_are_complete_and_self_contained() {
        let mut schema = crate::parse_sql_schema(SAMPLE_SQL, "main").unwrap();
        populate_inferred_relations(&mut schema, &InferConfig::default());
        schema
            .warnings
            .push("Sample ignored statement <script>alert(1)</script>".to_string());

        let md = export_markdown(&schema);
        assert!(md.contains("# RELIX Data Dictionary"));
        assert!(md.contains("## `main.posts`"));
        assert!(md.contains("[inferred]"));
        assert!(md.contains("## Warnings"));

        let boxes = HashMap::new();
        let svg = export_svg(&schema, &boxes);
        assert!(svg.starts_with("<svg "));
        assert!(svg.contains("class=\"er-edge edge-declared\""));
        assert!(svg.contains("class=\"er-edge edge-inferred\""));
        assert!(svg.contains("data-table-id=\"main.posts\""));

        let html = export_html(&schema, &boxes);
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("<svg "));
        assert!(!html.contains("https://"));
        assert!(!html.contains("<script src"));
        assert!(!html.contains("<link "));
        // Verify injected </script> inside JSON is escaped cleanly.
        assert!(!html.contains("</script>alert(1)"));
    }
}
