use std::collections::HashMap;
#[cfg(not(target_family = "wasm"))]
use std::path::Path;

use anyhow::{Result, bail};
use relix_core::{
    ExportNodeBox, ProjectConfig, Schema, export_html, export_markdown, export_mermaid, export_svg,
};
use relix_layout::{LayoutConfig, LayoutEngine, SugiyamaLayout, compute_table_height};

#[cfg(not(target_family = "wasm"))]
use crate::source_loader::{SourceSpec, load_source};

/// Supported MVP export formats (`P6-T1` ~ `P6-T5`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Mermaid,
    Markdown,
    Svg,
    Html,
    Json,
}

impl ExportFormat {
    pub const ALL: [Self; 5] = [
        Self::Mermaid,
        Self::Markdown,
        Self::Svg,
        Self::Html,
        Self::Json,
    ];

    pub fn parse(raw: &str) -> Result<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "mermaid" | "mmd" => Ok(Self::Mermaid),
            "markdown" | "md" => Ok(Self::Markdown),
            "svg" => Ok(Self::Svg),
            "html" => Ok(Self::Html),
            "json" => Ok(Self::Json),
            other => {
                bail!("unsupported export format `{other}` (expected mermaid|md|svg|html|json)")
            }
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Mermaid => "mmd",
            Self::Markdown => "md",
            Self::Svg => "svg",
            Self::Html => "html",
            Self::Json => "json",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Mermaid => "Mermaid",
            Self::Markdown => "Markdown",
            Self::Svg => "SVG",
            Self::Html => "HTML",
            Self::Json => "JSON",
        }
    }
}

/// Compute layout bounding boxes for SVG/HTML export using `SugiyamaLayout` plus saved manual positions.
pub fn layout_boxes_for_export(
    schema: &Schema,
    config: &ProjectConfig,
) -> HashMap<String, ExportNodeBox> {
    let cfg = LayoutConfig::default();
    let layout = SugiyamaLayout.layout(schema, &cfg);
    let mut boxes = HashMap::with_capacity(schema.tables.len());
    for (idx, tbl) in schema.tables.iter().enumerate() {
        let base = layout.nodes.get(&tbl.id).copied();
        let (x, y) = config
            .node_positions
            .get(&tbl.id)
            .map(|p| (p.x, p.y))
            .or_else(|| base.map(|b| (b.x, b.y)))
            .unwrap_or((
                40.0 + (idx % 4) as f32 * 280.0,
                40.0 + (idx / 4) as f32 * 240.0,
            ));
        let width = base.map_or(cfg.node_width, |b| b.width);
        let height = compute_table_height(tbl, &cfg);
        boxes.insert(
            tbl.id.clone(),
            ExportNodeBox {
                x,
                y,
                width,
                height,
            },
        );
    }
    boxes
}

/// Render `schema` in the requested [`ExportFormat`].
pub fn render_export(
    schema: &Schema,
    config: &ProjectConfig,
    format: ExportFormat,
) -> Result<String> {
    match format {
        ExportFormat::Mermaid => Ok(export_mermaid(schema)),
        ExportFormat::Markdown => Ok(export_markdown(schema)),
        ExportFormat::Svg => {
            let boxes = layout_boxes_for_export(schema, config);
            Ok(export_svg(schema, &boxes))
        }
        ExportFormat::Html => {
            let boxes = layout_boxes_for_export(schema, config);
            Ok(export_html(schema, &boxes))
        }
        ExportFormat::Json => Ok(serde_json::to_string_pretty(schema)?),
    }
}

/// CLI helper: load a native source, apply its local `relix.toml`, render export, and write if `-o` is set.
#[cfg(not(target_family = "wasm"))]
pub fn run_cli_export(
    source: &str,
    format: ExportFormat,
    out_path: Option<&Path>,
) -> Result<String> {
    let loaded = load_source(&SourceSpec::NativeInput(source.to_string()))?;
    let rendered = render_export(&loaded.schema, &loaded.config, format)?;
    if let Some(path) = out_path {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &rendered)?;
    }
    Ok(rendered)
}
