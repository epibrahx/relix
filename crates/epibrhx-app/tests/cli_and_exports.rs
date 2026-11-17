use std::path::PathBuf;
use std::process::Command;

use epibrhx_app::exporter::{ExportFormat, render_export, run_cli_export};
use epibrhx_app::source_loader::{SourceSpec, load_source};

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
}

#[test]
fn all_fixtures_export_cleanly_in_every_format() {
    for fixture in [
        "01_ecommerce.db",
        "02_blog_cms.db",
        "03_wild_legacy.db",
        "01_ecommerce.sql",
        "02_blog_cms.sql",
        "03_wild_legacy.sql",
    ] {
        let path = fixture_path(fixture);
        let loaded = load_source(&SourceSpec::NativeInput(path.display().to_string()))
            .unwrap_or_else(|e| panic!("failed to load {fixture}: {e}"));

        let mmd = render_export(&loaded.schema, &loaded.config, ExportFormat::Mermaid).unwrap();
        assert!(mmd.starts_with("erDiagram\n"), "{fixture} mermaid header");
        for tbl in &loaded.schema.tables {
            assert!(
                mmd.contains(&tbl.name),
                "{fixture} missing table {}",
                tbl.name
            );
        }

        let md = render_export(&loaded.schema, &loaded.config, ExportFormat::Markdown).unwrap();
        assert!(md.contains("# EPIBRHX Data Dictionary"));
        assert!(md.contains("## Table Overview"));

        let svg = render_export(&loaded.schema, &loaded.config, ExportFormat::Svg).unwrap();
        assert!(svg.starts_with("<svg ") && svg.contains("</svg>"));

        let html = render_export(&loaded.schema, &loaded.config, ExportFormat::Html).unwrap();
        assert!(html.contains("<!DOCTYPE html>") && html.contains("<svg "));
    }
}

#[test]
fn cli_export_writes_files_and_redacts_postgres_errors() {
    let tmp_dir = std::env::temp_dir().join(format!("epibrhx_cli_export_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_dir);
    std::fs::create_dir_all(&tmp_dir).unwrap();

    let db_path = fixture_path("02_blog_cms.db");
    let out_mmd = tmp_dir.join("blog.mmd");
    let out_html = tmp_dir.join("blog.html");

    let rendered = run_cli_export(
        db_path.to_str().unwrap(),
        ExportFormat::Mermaid,
        Some(&out_mmd),
    )
    .unwrap();
    assert!(out_mmd.exists());
    assert!(rendered.contains("authors ||..o{ posts"));

    let bin = env!("CARGO_BIN_EXE_epibrhx-app");
    let ok_out = Command::new(bin)
        .args([
            "export",
            db_path.to_str().unwrap(),
            "--format",
            "html",
            "-o",
            out_html.to_str().unwrap(),
        ])
        .output()
        .expect("run epibrhx-app export");
    assert!(
        ok_out.status.success(),
        "cli export failed: {}",
        String::from_utf8_lossy(&ok_out.stderr)
    );
    let html_content = std::fs::read_to_string(&out_html).unwrap();
    assert!(html_content.contains("EPIBRHX Interactive Schema Export"));

    // Security check: unreachable Postgres URL error must NEVER leak password.
    let err_out = Command::new(bin)
        .args([
            "export",
            "postgres://alice:s3cr3tPass!@127.0.0.1:1/mydb",
            "--format",
            "mermaid",
        ])
        .output()
        .expect("run epibrhx-app with bad pg url");
    assert!(!err_out.status.success());
    let stderr = String::from_utf8_lossy(&err_out.stderr);
    assert!(!stderr.contains("s3cr3tPass!"), "password leaked: {stderr}");

    let _ = std::fs::remove_dir_all(&tmp_dir);
}
