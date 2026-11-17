use std::path::PathBuf;

use epibrhx_core::{Dialect, TableKind};
use epibrhx_sources::{SourceError, load_sqlite_connection, load_sqlite_file};
use rusqlite::Connection;

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

#[test]
fn snapshot_ecommerce_sqlite() {
    let schema = load_sqlite_file(fixture_path("01_ecommerce.db")).expect("load 01_ecommerce.db");
    insta::assert_json_snapshot!("01_ecommerce_sqlite", schema);
}

#[test]
fn snapshot_blog_cms_sqlite() {
    let schema = load_sqlite_file(fixture_path("02_blog_cms.db")).expect("load 02_blog_cms.db");
    insta::assert_json_snapshot!("02_blog_cms_sqlite", schema);
}

#[test]
fn snapshot_wild_legacy_sqlite() {
    let schema =
        load_sqlite_file(fixture_path("03_wild_legacy.db")).expect("load 03_wild_legacy.db");
    insta::assert_json_snapshot!("03_wild_legacy_sqlite", schema);
}

#[test]
fn handles_composite_pk_fk_self_ref_no_pk_and_views() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    conn.execute_batch(
        r#"
        CREATE TABLE parent (
            a INTEGER NOT NULL,
            b TEXT NOT NULL,
            PRIMARY KEY (b, a)
        );
        CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            ref_b TEXT NOT NULL,
            ref_a INTEGER NOT NULL,
            self_id INTEGER REFERENCES child,
            FOREIGN KEY (ref_b, ref_a) REFERENCES parent(b, a)
        );
        CREATE TABLE no_pk_log (
            msg TEXT NOT NULL
        );
        CREATE VIEW v_child AS SELECT id, self_id FROM child;
        "#,
    )
    .expect("seed schema");

    let schema = load_sqlite_connection(&conn, "memory").expect("load sqlite schema");
    assert_eq!(schema.dialect, Dialect::Sqlite);

    let parent = schema.table_by_id("main.parent").expect("parent table");
    assert_eq!(parent.primary_key, vec!["b", "a"]);
    assert_eq!(parent.kind, TableKind::Table);

    let no_pk = schema.table_by_id("main.no_pk_log").expect("no_pk_log");
    assert!(no_pk.primary_key.is_empty());

    let view = schema.table_by_id("main.v_child").expect("v_child view");
    assert_eq!(view.kind, TableKind::View);
    assert_eq!(view.columns.len(), 2);

    // Composite FK preserves (ref_b, ref_a) -> (b, a) order.
    let comp_fk = schema
        .relations
        .iter()
        .find(|r| r.from_table == "main.child" && r.to_table == "main.parent")
        .expect("composite FK");
    assert_eq!(comp_fk.from_columns, vec!["ref_b", "ref_a"]);
    assert_eq!(comp_fk.to_columns, vec!["b", "a"]);

    // Implicit FK target (`REFERENCES child` without column list) resolves to child's PK (`id`).
    let self_fk = schema
        .relations
        .iter()
        .find(|r| r.from_table == "main.child" && r.to_table == "main.child")
        .expect("self FK");
    assert_eq!(self_fk.from_columns, vec!["self_id"]);
    assert_eq!(self_fk.to_columns, vec!["id"]);

    // Query-only mode must reject writes after loading.
    assert!(
        conn.execute("CREATE TABLE should_fail (x INT)", [])
            .is_err()
    );
}

#[test]
fn friendly_errors_for_missing_and_empty_sqlite() {
    let missing = load_sqlite_file("/nonexistent/epibrhx_does_not_exist.db");
    assert!(matches!(missing, Err(SourceError::FileNotFound(_))));

    let empty = Connection::open_in_memory().expect("open empty db");
    let empty_res = load_sqlite_connection(&empty, "empty.db");
    assert!(matches!(empty_res, Err(SourceError::EmptySchema(_))));
}
