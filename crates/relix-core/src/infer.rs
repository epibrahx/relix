use std::collections::HashSet;

use crate::model::{
    Column, Relation, RelationKind, RelationStatus, Schema, Table, TableKind, TypeFamily,
};
use crate::morphology::{MorphologyConfig, extract_fk_stem, normalize_table_stem, stems_match};

/// Options controlling deterministic relation inference.
#[derive(Debug, Clone, Default)]
pub struct InferConfig {
    pub morphology: MorphologyConfig,
}

/// A candidate target discovered for an ambiguous column (multiple candidates matched).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationCandidate {
    pub to_table: String,
    pub to_column: String,
    pub evidence: Vec<String>,
    pub self_reference: bool,
}

/// A column that matched multiple key candidates and was therefore NOT auto-drawn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmbiguousColumn {
    pub from_table: String,
    pub from_column: String,
    pub candidates: Vec<RelationCandidate>,
}

/// Full output of deterministic relation inference.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InferOutput {
    pub inferred: Vec<Relation>,
    pub ambiguous: Vec<AmbiguousColumn>,
}

/// Infer implicit relations deterministically using rules C1–C4 (no scoring or weights).
///
/// Rules:
/// - Skip columns already covered by a declared foreign key.
/// - Skip views (`TableKind::View`).
/// - C1: Column matches `<x>_id` / `<x>Id` / `<x>_uuid` / `<x>Uuid`, and matches a table `<x>`
///   (singular/plural + configurable prefixes) or self-reference `parent_id`/`parentId`/`parent_uuid`.
/// - C2: `col.type_family == target_key.type_family` and `!= TypeFamily::Other`.
/// - C3: Target is a single-column primary key or single-column unique key.
/// - C4: A table's own single-column primary key is excluded from inferring outward relations;
///   self-references from non-PK columns are allowed and annotated with `self_reference`.
/// - Ambiguity: If multiple distinct targets match, emit none and record under `ambiguous`.
pub fn infer_relations(schema: &Schema, config: &InferConfig) -> InferOutput {
    let mut output = InferOutput::default();

    // Collect declared FK source columns per table so we skip already-declared columns.
    let mut declared_cols: HashSet<(&str, &str)> = HashSet::new();
    for rel in &schema.relations {
        if rel.kind == RelationKind::Declared {
            for col in &rel.from_columns {
                declared_cols.insert((rel.from_table.as_str(), col.as_str()));
            }
        }
    }

    // Precompute normalized table stems for base tables.
    let base_tables: Vec<(&Table, String)> = schema
        .tables
        .iter()
        .filter(|t| t.kind == TableKind::Table)
        .map(|t| {
            (
                t,
                normalize_table_stem(&t.name, &config.morphology.table_prefixes),
            )
        })
        .collect();

    for from_table in schema.tables.iter().filter(|t| t.kind == TableKind::Table) {
        for col in &from_table.columns {
            if col.type_family == TypeFamily::Other {
                continue;
            }
            if declared_cols.contains(&(from_table.id.as_str(), col.name.as_str())) {
                continue;
            }
            // C4: Exclude the table's own single-column primary key.
            if from_table.primary_key.len() == 1 && from_table.primary_key[0] == col.name {
                continue;
            }

            let Some(stem_info) = extract_fk_stem(&col.name) else {
                continue;
            };

            let mut candidates = find_candidates(from_table, col, &stem_info.stem, &base_tables);

            // Deduplicate identical (to_table, to_column) candidates if both PK and UNIQUE index cover the same column.
            candidates.sort_by(|a, b| {
                a.to_table
                    .cmp(&b.to_table)
                    .then_with(|| a.to_column.cmp(&b.to_column))
            });
            candidates.dedup_by(|a, b| a.to_table == b.to_table && a.to_column == b.to_column);

            match candidates.len() {
                0 => {}
                1 => {
                    let c = candidates.into_iter().next().unwrap();
                    let from_cols = vec![col.name.clone()];
                    let to_cols = vec![c.to_column];
                    let id =
                        Relation::compute_id(&from_table.id, &from_cols, &c.to_table, &to_cols);
                    output.inferred.push(Relation {
                        id,
                        from_table: from_table.id.clone(),
                        from_columns: from_cols,
                        to_table: c.to_table,
                        to_columns: to_cols,
                        kind: RelationKind::Inferred,
                        status: RelationStatus::Auto,
                        evidence: c.evidence,
                    });
                }
                _ => {
                    output.ambiguous.push(AmbiguousColumn {
                        from_table: from_table.id.clone(),
                        from_column: col.name.clone(),
                        candidates,
                    });
                }
            }
        }
    }

    output.inferred.sort_by(|a, b| a.id.cmp(&b.id));
    output
}

/// Run inference on `schema` (replacing any previous `Inferred` relations while keeping `Declared`),
/// returning any ambiguous columns for UI inspection.
pub fn populate_inferred_relations(
    schema: &mut Schema,
    config: &InferConfig,
) -> Vec<AmbiguousColumn> {
    schema
        .relations
        .retain(|r| r.kind == RelationKind::Declared || r.status == RelationStatus::Confirmed);
    let out = infer_relations(schema, config);

    let existing_ids: HashSet<String> = schema.relations.iter().map(|r| r.id.clone()).collect();
    for rel in out.inferred {
        if !existing_ids.contains(&rel.id) {
            schema.relations.push(rel);
        }
    }
    schema.relations.sort_by(|a, b| a.id.cmp(&b.id));
    out.ambiguous
}

fn find_candidates(
    from_table: &Table,
    col: &Column,
    stem: &str,
    base_tables: &[(&Table, String)],
) -> Vec<RelationCandidate> {
    let mut candidates = Vec::new();
    let is_parent_alias = stem == "parent";

    for (target_table, target_stem) in base_tables {
        let is_self = target_table.id == from_table.id;
        // C4: In a composite-PK table, a PK column may reference another table, not itself.
        if is_self && from_table.primary_key.contains(&col.name) {
            continue;
        }

        let name_matched = stems_match(stem, target_stem);
        let self_parent_matched = is_self && is_parent_alias;
        if !name_matched && !self_parent_matched {
            continue;
        }

        // Prefer matching other tables first? Note: if a `parents` table exists AND `is_self` via `parent_id`,
        // only add `self_parent_matched` if `name_matched` didn't match another table or treat `name_matched` normally.
        // We handle that right below after scanning all tables!
        let mut matched_keys = matching_single_keys(target_table, col);
        for (key_col_name, is_pk) in matched_keys.drain(..) {
            let key_label = if is_pk { "主键" } else { "唯一键" };
            let mut evidence = vec![format!(
                "列名 {} 匹配表 {}；类型均为 {:?}；目标列 {} 为{}",
                col.name, target_table.name, col.type_family, key_col_name, key_label
            )];
            if is_self {
                evidence.push("self_reference".to_string());
            }
            candidates.push(RelationCandidate {
                to_table: target_table.id.clone(),
                to_column: key_col_name,
                evidence,
                self_reference: is_self,
            });
        }
    }

    // If `parent_id` matched both an external `parents` table (by C1 name) and self-reference,
    // keep the explicit named table match over implicit `parent` self-ref; if no `parents` table
    // exists, `self_reference` stays as the unique match.
    if is_parent_alias && candidates.iter().any(|c| !c.self_reference) {
        candidates.retain(|c| !c.self_reference);
    }

    // If `from_table` is in a specific schema and candidates exist in BOTH same-schema and other schemas,
    // prefer same-schema targets so cross-schema name collisions don't create false ambiguity.
    if candidates.len() > 1
        && candidates
            .iter()
            .any(|c| same_schema(&from_table.id, &c.to_table))
    {
        let same_schema_only: Vec<RelationCandidate> = candidates
            .iter()
            .filter(|c| same_schema(&from_table.id, &c.to_table))
            .cloned()
            .collect();
        if !same_schema_only.is_empty() {
            candidates = same_schema_only;
        }
    }

    candidates
}

fn same_schema(a: &str, b: &str) -> bool {
    a.split('.').next() == b.split('.').next()
}

/// C2 + C3: Find matching single-column PK or single-column UNIQUE key columns in `target_table`.
/// If the target table's single-column PK matches `col.type_family`, prefer it over extra unique keys on the same table.
fn matching_single_keys(target_table: &Table, col: &Column) -> Vec<(String, bool)> {
    if target_table.primary_key.len() == 1 {
        let pk_name = &target_table.primary_key[0];
        if let Some(pk_col) = target_table.columns.iter().find(|c| &c.name == pk_name)
            && pk_col.type_family == col.type_family
        {
            return vec![(pk_name.clone(), true)];
        }
    }

    let mut unique_matches = Vec::new();
    for uk in &target_table.unique_keys {
        if uk.len() == 1 {
            let uk_name = &uk[0];
            if let Some(uk_col) = target_table.columns.iter().find(|c| &c.name == uk_name)
                && uk_col.type_family == col.type_family
            {
                unique_matches.push((uk_name.clone(), false));
            }
        }
    }
    unique_matches
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Column, Dialect, Index, Table};

    fn make_col(name: &str, tf: TypeFamily) -> Column {
        Column {
            name: name.to_string(),
            data_type: format!("{tf:?}"),
            type_family: tf,
            nullable: false,
            default: None,
            comment: None,
        }
    }

    fn make_table(name: &str, cols: Vec<Column>, pk: Vec<&str>, uks: Vec<Vec<&str>>) -> Table {
        Table {
            id: format!("main.{name}"),
            schema: "main".to_string(),
            name: name.to_string(),
            kind: TableKind::Table,
            comment: None,
            columns: cols,
            primary_key: pk.into_iter().map(str::to_string).collect(),
            unique_keys: uks
                .into_iter()
                .map(|u| u.into_iter().map(str::to_string).collect())
                .collect(),
            indexes: Vec::<Index>::new(),
        }
    }

    #[test]
    fn rule_c1_naming_positive_and_negative() {
        let mut schema = Schema::new(Dialect::Sqlite);
        schema.tables.push(make_table(
            "users",
            vec![make_col("id", TypeFamily::Integer)],
            vec!["id"],
            vec![],
        ));
        schema.tables.push(make_table(
            "orders",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("user_id", TypeFamily::Integer),
                make_col("ghost_id", TypeFamily::Integer), // negative: no `ghosts` table
            ],
            vec!["id"],
            vec![],
        ));

        let out = infer_relations(&schema, &InferConfig::default());
        assert_eq!(out.inferred.len(), 1);
        assert_eq!(out.inferred[0].from_columns, vec!["user_id"]);
        assert_eq!(out.inferred[0].to_table, "main.users");
    }

    #[test]
    fn rule_c2_type_match_positive_and_negative() {
        let mut schema = Schema::new(Dialect::Sqlite);
        schema.tables.push(make_table(
            "users",
            vec![make_col("id", TypeFamily::Uuid)],
            vec!["id"],
            vec![],
        ));
        schema.tables.push(make_table(
            "orders",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("user_id", TypeFamily::Integer), // type mismatch: Integer vs Uuid
            ],
            vec!["id"],
            vec![],
        ));
        schema.tables.push(make_table(
            "invoices",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("user_uuid", TypeFamily::Uuid), // type match
            ],
            vec!["id"],
            vec![],
        ));

        let out = infer_relations(&schema, &InferConfig::default());
        assert_eq!(out.inferred.len(), 1);
        assert_eq!(out.inferred[0].from_table, "main.invoices");
        assert_eq!(out.inferred[0].from_columns, vec!["user_uuid"]);
    }

    #[test]
    fn rule_c3_target_must_be_single_pk_or_unique_key() {
        let mut schema = Schema::new(Dialect::Sqlite);
        // Composite PK only -> NOT a single-column key target
        schema.tables.push(make_table(
            "tenants",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("region", TypeFamily::Text),
                make_col("code", TypeFamily::Text),
            ],
            vec!["id", "region"],
            vec![],
        ));
        schema.tables.push(make_table(
            "accounts",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("tenant_id", TypeFamily::Integer),
            ],
            vec!["id"],
            vec![],
        ));

        let out = infer_relations(&schema, &InferConfig::default());
        assert!(out.inferred.is_empty());

        // Add single-column unique key on `accounts(id)`? No, test unique key target on `people(external_uuid)`:
        schema.tables.push(make_table(
            "people",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("external_uuid", TypeFamily::Uuid),
            ],
            vec!["id"],
            vec![vec!["external_uuid"]],
        ));
        schema.tables.push(make_table(
            "profiles",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("person_uuid", TypeFamily::Uuid),
            ],
            vec!["id"],
            vec![],
        ));

        let out2 = infer_relations(&schema, &InferConfig::default());
        assert_eq!(out2.inferred.len(), 1);
        assert_eq!(out2.inferred[0].to_table, "main.people");
        assert_eq!(out2.inferred[0].to_columns, vec!["external_uuid"]);
    }

    #[test]
    fn rule_c4_excludes_own_pk_and_allows_self_reference() {
        let mut schema = Schema::new(Dialect::Sqlite);
        // Table named `item` whose own PK is `item_id` (not `id`) -> C4 must exclude it!
        schema.tables.push(make_table(
            "item",
            vec![
                make_col("item_id", TypeFamily::Integer),
                make_col("parent_id", TypeFamily::Integer),
            ],
            vec!["item_id"],
            vec![],
        ));

        let out = infer_relations(&schema, &InferConfig::default());
        assert_eq!(out.inferred.len(), 1);
        assert_eq!(out.inferred[0].from_columns, vec!["parent_id"]);
        assert_eq!(out.inferred[0].to_table, "main.item");
        assert_eq!(out.inferred[0].to_columns, vec!["item_id"]);
        assert!(
            out.inferred[0]
                .evidence
                .iter()
                .any(|e| e == "self_reference")
        );
    }

    #[test]
    fn skips_already_declared_fk_columns_and_records_ambiguity_without_drawing() {
        let mut schema = Schema::new(Dialect::Sqlite);
        schema.tables.push(make_table(
            "users",
            vec![make_col("id", TypeFamily::Integer)],
            vec!["id"],
            vec![],
        ));
        schema.tables.push(make_table(
            "tbl_users",
            vec![make_col("id", TypeFamily::Integer)],
            vec!["id"],
            vec![],
        ));
        schema.tables.push(make_table(
            "orders",
            vec![
                make_col("id", TypeFamily::Integer),
                make_col("user_id", TypeFamily::Integer),
                make_col("declared_user_id", TypeFamily::Integer),
            ],
            vec!["id"],
            vec![],
        ));
        schema.relations.push(Relation::declared(
            "main.orders",
            vec!["declared_user_id".to_string()],
            "main.users",
            vec!["id".to_string()],
        ));

        let out = infer_relations(&schema, &InferConfig::default());
        assert!(
            out.inferred.is_empty(),
            "ambiguous user_id should not auto-draw"
        );
        assert_eq!(out.ambiguous.len(), 1);
        assert_eq!(out.ambiguous[0].from_column, "user_id");
        assert_eq!(out.ambiguous[0].candidates.len(), 2);
    }
}
