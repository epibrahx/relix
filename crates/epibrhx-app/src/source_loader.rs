use std::path::PathBuf;

use anyhow::{Context as _, Result};
#[cfg(not(target_family = "wasm"))]
use epibrhx_core::redact_connection_url;
use epibrhx_core::{InferConfig, ProjectConfig, Schema, populate_inferred_relations};

pub const FIXTURE_ECOMMERCE_SQL: &str = include_str!("../../../fixtures/01_ecommerce.sql");
pub const FIXTURE_BLOG_SQL: &str = include_str!("../../../fixtures/02_blog_cms.sql");
pub const FIXTURE_LEGACY_SQL: &str = include_str!("../../../fixtures/03_wild_legacy.sql");

/// Named built-in example schemas bundled for both Desktop and WASM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltinFixture {
    Ecommerce,
    BlogCms,
    WildLegacy,
}

impl BuiltinFixture {
    pub const ALL: [Self; 3] = [Self::Ecommerce, Self::BlogCms, Self::WildLegacy];

    pub fn title(self) -> &'static str {
        match self {
            Self::Ecommerce => "01 Ecommerce",
            Self::BlogCms => "02 Blog/CMS",
            Self::WildLegacy => "03 Wild Legacy",
        }
    }

    pub fn sql(self) -> &'static str {
        match self {
            Self::Ecommerce => FIXTURE_ECOMMERCE_SQL,
            Self::BlogCms => FIXTURE_BLOG_SQL,
            Self::WildLegacy => FIXTURE_LEGACY_SQL,
        }
    }
}

/// Source description passed from CLI or UI actions.
#[derive(Debug, Clone)]
pub enum SourceSpec {
    Builtin(BuiltinFixture),
    Bench(usize),
    SqlText {
        label: String,
        sql: String,
    },
    SchemaJson {
        label: String,
        json: String,
    },
    #[cfg(not(target_family = "wasm"))]
    NativeInput(String),
}

impl Default for SourceSpec {
    fn default() -> Self {
        Self::Builtin(BuiltinFixture::BlogCms)
    }
}

/// Result of loading a schema plus associated metadata and optional local `epibrhx.toml`.
#[derive(Debug, Clone)]
pub struct LoadedSource {
    pub schema: Schema,
    pub raw_sql: Option<String>,
    pub source_label: String,
    pub config: ProjectConfig,
    pub config_path: Option<PathBuf>,
}

/// Load a [`SourceSpec`] into a normalized [`LoadedSource`] with inferred relations and config applied.
pub fn load_source(spec: &SourceSpec) -> Result<LoadedSource> {
    match spec {
        SourceSpec::Builtin(fixture) => {
            let mut schema = epibrhx_core::parse_sql_schema(fixture.sql(), "main")
                .map_err(|e| anyhow::anyhow!(e))?;
            populate_inferred_relations(&mut schema, &InferConfig::default());
            Ok(LoadedSource {
                schema,
                raw_sql: Some(fixture.sql().to_string()),
                source_label: format!("fixture: {}", fixture.title()),
                config: ProjectConfig::default(),
                config_path: None,
            })
        }
        SourceSpec::Bench(tables) => {
            let schema = schemagen::generate_synthetic_schema(*tables, 10, 1.4, 20261117);
            Ok(LoadedSource {
                schema,
                raw_sql: None,
                source_label: format!("synthetic bench ({tables} tables)"),
                config: ProjectConfig::default(),
                config_path: None,
            })
        }
        SourceSpec::SqlText { label, sql } => {
            let mut schema =
                epibrhx_core::parse_sql_schema(sql, "main").map_err(|e| anyhow::anyhow!(e))?;
            populate_inferred_relations(&mut schema, &InferConfig::default());
            Ok(LoadedSource {
                schema,
                raw_sql: Some(sql.clone()),
                source_label: label.clone(),
                config: ProjectConfig::default(),
                config_path: None,
            })
        }
        SourceSpec::SchemaJson { label, json } => {
            let mut schema: Schema =
                serde_json::from_str(json).context("invalid schema JSON document")?;
            populate_inferred_relations(&mut schema, &InferConfig::default());
            Ok(LoadedSource {
                schema,
                raw_sql: None,
                source_label: label.clone(),
                config: ProjectConfig::default(),
                config_path: None,
            })
        }
        #[cfg(not(target_family = "wasm"))]
        SourceSpec::NativeInput(target) => load_native_target(target),
    }
}

/// Persist `epibrhx.toml` on desktop when `config_path` is known.
pub fn persist_project_config(path: Option<&PathBuf>, config: &ProjectConfig) -> Result<()> {
    #[cfg(not(target_family = "wasm"))]
    if let Some(cfg_path) = path {
        epibrhx_sources::save_project_config(cfg_path, config)
            .with_context(|| format!("failed to write {}", cfg_path.display()))?;
    }
    #[cfg(target_family = "wasm")]
    let _ = (path, config);
    Ok(())
}

#[cfg(not(target_family = "wasm"))]
fn load_native_target(target: &str) -> Result<LoadedSource> {
    let trimmed = target.trim();
    if is_postgres_url(trimmed) {
        let redacted = redact_connection_url(trimmed);
        let mut schema = epibrhx_sources::load_postgres(trimmed)
            .with_context(|| format!("failed to load PostgreSQL source {redacted}"))?;
        populate_inferred_relations(&mut schema, &InferConfig::default());
        let cfg_path = epibrhx_sources::resolve_config_path(
            &epibrhx_sources::SchemaSourceKind::PostgresUrl(trimmed.to_string()),
        )?;
        let config = epibrhx_sources::load_project_config(&cfg_path)?;
        config.apply_to_schema(&mut schema);
        return Ok(LoadedSource {
            schema,
            raw_sql: None,
            source_label: redacted,
            config,
            config_path: Some(cfg_path),
        });
    }

    let path = PathBuf::from(trimmed);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    let (mut schema, raw_sql) = if ext == "sql" {
        let sql = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read SQL file {}", path.display()))?;
        let schema = epibrhx_sources::load_sql_file(&path)
            .with_context(|| format!("failed to parse SQL file {}", path.display()))?;
        (schema, Some(sql))
    } else if ext == "json" {
        let json = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read JSON file {}", path.display()))?;
        let schema: Schema = serde_json::from_str(&json)
            .with_context(|| format!("failed to parse schema JSON {}", path.display()))?;
        (schema, None)
    } else {
        let schema = epibrhx_sources::load_sqlite_file(&path)
            .with_context(|| format!("failed to load SQLite database {}", path.display()))?;
        (schema, None)
    };

    populate_inferred_relations(&mut schema, &InferConfig::default());
    let cfg_path = epibrhx_sources::resolve_config_path(&epibrhx_sources::SchemaSourceKind::File(
        path.clone(),
    ))?;
    let config = epibrhx_sources::load_project_config(&cfg_path)?;
    config.apply_to_schema(&mut schema);

    Ok(LoadedSource {
        schema,
        raw_sql,
        source_label: path.display().to_string(),
        config,
        config_path: Some(cfg_path),
    })
}

/// Detect whether a target string looks like a PostgreSQL connection string/URI.
pub fn is_postgres_url(input: &str) -> bool {
    let lower = input.trim().to_ascii_lowercase();
    lower.starts_with("postgres://")
        || lower.starts_with("postgresql://")
        || (lower.contains("host=") && lower.contains("dbname="))
}
