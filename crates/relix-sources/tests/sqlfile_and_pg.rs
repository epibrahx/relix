use std::path::PathBuf;

use relix_core::{Dialect, Schema, TableKind, redact_connection_url};
use relix_sources::{SourceError, load_postgres, load_sql_file, load_sql_str, load_sqlite_file};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

/// Normalize dialect/schema prefix differences so SQLite (`main.*`), sqlfile (`public.*`),
/// and Postgres (`public.*`) schemas can be compared for structural equivalence.
fn normalize_for_equivalence(mut schema: Schema) -> Schema {
    schema.dialect = Dialect::Sqlfile;
    schema.warnings.clear();

    for table in &mut schema.tables {
        table.schema = "norm".to_string();
        table.id = format!("norm.{}", table.name);
        // Normalize raw data_type strings where SQLite/Postgres display aliases differ (e.g. VARCHAR vs character varying),
        // keeping `type_family`, `nullable`, `name`, `primary_key`, `unique_keys`, and `indexes` strictly checked.
        for col in &mut table.columns {
            col.data_type.clear();
            col.default = col
                .default
                .as_deref()
                .map(|d| d.trim().to_ascii_lowercase());
        }
        if table.kind == TableKind::View {
            // Views can have minor type inference differences across engines; check column names.
            for col in &mut table.columns {
                col.nullable = true;
            }
        }
    }

    for rel in &mut schema.relations {
        let from_name = rel
            .from_table
            .split('.')
            .next_back()
            .unwrap_or(&rel.from_table);
        let to_name = rel.to_table.split('.').next_back().unwrap_or(&rel.to_table);
        rel.from_table = format!("norm.{from_name}");
        rel.to_table = format!("norm.{to_name}");
        rel.id = relix_core::Relation::compute_id(
            &rel.from_table,
            &rel.from_columns,
            &rel.to_table,
            &rel.to_columns,
        );
    }

    schema.tables.sort_by(|a, b| a.id.cmp(&b.id));
    schema.relations.sort_by(|a, b| a.id.cmp(&b.id));
    schema
}

#[test]
fn ecommerce_sqlite_and_sqlfile_are_equivalent() {
    let sqlite_schema = load_sqlite_file(fixture_path("01_ecommerce.db")).expect("load sqlite");
    let sqlfile_schema = load_sql_file(fixture_path("01_ecommerce.sql")).expect("load sqlfile");

    assert_eq!(sqlfile_schema.dialect, Dialect::Sqlfile);
    assert!(
        sqlfile_schema.warnings.is_empty(),
        "{:?}",
        sqlfile_schema.warnings
    );

    assert_eq!(
        normalize_for_equivalence(sqlite_schema),
        normalize_for_equivalence(sqlfile_schema)
    );
}

#[test]
fn blog_and_wild_legacy_sqlite_and_sqlfile_are_equivalent() {
    for (db, sql) in [
        ("02_blog_cms.db", "02_blog_cms.sql"),
        ("03_wild_legacy.db", "03_wild_legacy.sql"),
    ] {
        let a = load_sqlite_file(fixture_path(db)).expect("load sqlite");
        let b = load_sql_file(fixture_path(sql)).expect("load sqlfile");
        assert_eq!(
            normalize_for_equivalence(a),
            normalize_for_equivalence(b),
            "fixture {db}"
        );
    }
}

#[test]
fn friendly_errors_for_sqlfile_and_postgres_redaction() {
    let missing = load_sql_file("/nonexistent/relix_schema.sql");
    assert!(matches!(missing, Err(SourceError::FileNotFound(_))));

    let empty = load_sql_str("   \n-- just a comment\n", "public");
    assert!(matches!(empty, Err(SourceError::EmptySchema(_))));

    let bad_pg = load_postgres("postgres://alice:TopSecret123@127.0.0.1:1/nonexistent_db");
    let err_msg = bad_pg
        .expect_err("connection to port 1 must fail")
        .to_string();
    assert!(
        !err_msg.contains("TopSecret123"),
        "error leaked password: {err_msg}"
    );
    assert!(
        err_msg.contains("alice:***@127.0.0.1:1"),
        "expected redacted url in error: {err_msg}"
    );
    assert_eq!(
        redact_connection_url("postgres://u:pw@host/db"),
        "postgres://u:***@host/db"
    );
}

#[test]
fn postgres_integration_when_env_set() {
    let Ok(pg_url) = std::env::var("RELIX_TEST_PG_URL") else {
        // Skipped cleanly when RELIX_TEST_PG_URL is not configured (P2-T4).
        return;
    };

    let schema = load_postgres(&pg_url).expect("load postgres schema from RELIX_TEST_PG_URL");
    assert_eq!(schema.dialect, Dialect::Postgres);
    assert!(!schema.tables.is_empty());
    assert!(
        schema
            .tables
            .iter()
            .all(|t| t.schema != "pg_catalog" && t.schema != "information_schema")
    );
}
