//! Core unified schema model, deterministic relation inference, SQL DDL parsing, config, and exporters.
//! Pure computation crate with no UI or OS I/O dependencies; compiles to `wasm32-unknown-unknown`.

pub mod config;
pub mod infer;
pub mod model;
pub mod morphology;
pub mod redact;
pub mod sqlfile;

pub use config::{ManualRelation, NodePosition, ProjectConfig, ViewportState};
pub use infer::{
    AmbiguousColumn, InferConfig, InferOutput, RelationCandidate, infer_relations,
    populate_inferred_relations,
};
pub use model::{
    Column, Dialect, Index, Relation, RelationKind, RelationStatus, Schema, Table, TableKind,
    TypeFamily, normalize_type_family,
};
pub use morphology::{
    ColumnStem, MorphologyConfig, extract_fk_stem, normalize_table_stem, singularize, stems_match,
    to_snake_case,
};
pub use redact::{postgres_config_key, redact_connection_url};
pub use sqlfile::parse_sql_schema;

pub fn core_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_non_empty() {
        assert!(!core_version().is_empty());
    }
}
