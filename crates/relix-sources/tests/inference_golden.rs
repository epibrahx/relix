use std::collections::BTreeSet;
use std::path::PathBuf;

use relix_core::{
    InferConfig, ProjectConfig, RelationKind, RelationStatus, infer_relations,
    populate_inferred_relations,
};
use relix_sources::{
    SchemaSourceKind, load_project_config, load_sqlite_file, resolve_config_path,
    save_project_config,
};
use serde::Deserialize;

#[derive(Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
struct ExpectedEdge {
    from_table: String,
    from_columns: Vec<String>,
    to_table: String,
    to_columns: Vec<String>,
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

#[test]
fn inference_meets_precision_and_recall_targets_on_all_fixtures() {
    let cases = [
        ("01_ecommerce.db", "01_ecommerce.expected_relations.json"),
        ("02_blog_cms.db", "02_blog_cms.expected_relations.json"),
        (
            "03_wild_legacy.db",
            "03_wild_legacy.expected_relations.json",
        ),
    ];

    for (db_name, golden_name) in cases {
        let schema = load_sqlite_file(fixture_path(db_name)).expect("load sqlite fixture");
        let golden_raw =
            std::fs::read_to_string(fixture_path(golden_name)).expect("read golden file");
        let expected: Vec<ExpectedEdge> =
            serde_json::from_str(&golden_raw).expect("parse golden json");

        let out = infer_relations(&schema, &InferConfig::default());

        for rel in &out.inferred {
            assert_eq!(rel.kind, RelationKind::Inferred);
            assert_eq!(rel.status, RelationStatus::Auto);
            assert!(
                !rel.evidence.is_empty(),
                "every inferred relation must include human-readable evidence"
            );
        }

        let actual_set: BTreeSet<ExpectedEdge> = out
            .inferred
            .iter()
            .map(|r| ExpectedEdge {
                from_table: r.from_table.clone(),
                from_columns: r.from_columns.clone(),
                to_table: r.to_table.clone(),
                to_columns: r.to_columns.clone(),
            })
            .collect();
        let expected_set: BTreeSet<ExpectedEdge> = expected.into_iter().collect();

        if expected_set.is_empty() {
            assert!(
                actual_set.is_empty(),
                "fixture {db_name} expected 0 inferred relations, got {actual_set:?}"
            );
            continue;
        }

        let true_positives = actual_set.intersection(&expected_set).count();
        let precision = true_positives as f64 / actual_set.len() as f64;
        let recall = true_positives as f64 / expected_set.len() as f64;

        eprintln!(
            "[{db_name}] TP={true_positives} actual={} expected={} precision={precision:.3} recall={recall:.3}",
            actual_set.len(),
            expected_set.len()
        );

        assert!(
            precision >= 0.80,
            "fixture {db_name} precision {precision:.3} < 0.80"
        );
        assert!(
            recall >= 0.80,
            "fixture {db_name} recall {recall:.3} < 0.80"
        );
    }
}

#[test]
fn config_persists_confirmed_and_rejected_decisions_without_credentials() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let fake_db = tmp.path().join("demo.db");
    let cfg_path = resolve_config_path(&SchemaSourceKind::File(fake_db)).expect("config path");
    assert_eq!(cfg_path, tmp.path().join("relix.toml"));

    let mut schema = load_sqlite_file(fixture_path("02_blog_cms.db")).expect("load blog");
    let _ambiguous = populate_inferred_relations(&mut schema, &InferConfig::default());

    let inferred_ids: Vec<String> = schema
        .relations
        .iter()
        .filter(|r| r.kind == RelationKind::Inferred)
        .map(|r| r.id.clone())
        .collect();
    assert!(inferred_ids.len() >= 2);

    let mut cfg = ProjectConfig::default();
    cfg.confirm_relation(&inferred_ids[0]);
    cfg.reject_relation(&inferred_ids[1]);
    save_project_config(&cfg_path, &cfg).expect("save config");

    // Reload fresh schema, re-run inference, and restore saved decisions.
    let mut reloaded = load_sqlite_file(fixture_path("02_blog_cms.db")).expect("reload blog");
    populate_inferred_relations(&mut reloaded, &InferConfig::default());
    let loaded_cfg = load_project_config(&cfg_path).expect("load config");
    loaded_cfg.apply_to_schema(&mut reloaded);

    let rel0 = reloaded
        .relations
        .iter()
        .find(|r| r.id == inferred_ids[0])
        .unwrap();
    let rel1 = reloaded
        .relations
        .iter()
        .find(|r| r.id == inferred_ids[1])
        .unwrap();
    assert_eq!(rel0.status, RelationStatus::Confirmed);
    assert_eq!(rel1.status, RelationStatus::Rejected);

    // Postgres config path uses host+db hash, never connection string or password.
    let pg_cfg_path = resolve_config_path(&SchemaSourceKind::PostgresUrl(
        "postgres://admin:TopSecret999@db.internal:5432/analytics".to_string(),
    ))
    .expect("pg config path");
    let pg_path_str = pg_cfg_path.to_string_lossy();
    assert!(!pg_path_str.contains("TopSecret999"));
    assert!(!pg_path_str.contains("admin"));
    assert!(pg_path_str.ends_with(".toml"));
}
