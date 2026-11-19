# Known Issues, Limitations & Post-MVP Roadmap

## Current Limitations (MVP)

1. **Live PostgreSQL Integration Test Requires User Database** (`P7-T1`)
   - `relix-sources/tests/sqlfile_and_pg.rs::postgres_integration_when_env_set` connects to a real PostgreSQL instance only when `RELIX_TEST_PG_URL` is exported.
   - In offline / DB-less CI runs (`RELIX_TEST_PG_URL` unset), this test safely no-ops and skips while error handling, credential redaction, and `sqlparser`/SQLite suites run unconditionally.
   - To run against a local or staging PostgreSQL instance:
     ```bash
     RELIX_TEST_PG_URL="postgres://readonly@localhost:5432/mydb" cargo test -p relix-sources --test sqlfile_and_pg
     ```

2. **PNG Raster Export Deferred (`P6-T6`)**
   - `gpui-pre` desktop/web platform backends return `render_to_image not implemented for this platform`.
   - To avoid bloating `relix-core` and WASM bundles with a direct `resvg` dependency in MVP, PNG output is not built in yet. Users can export standalone **SVG** or **interactive HTML** directly and rasterize SVG externally if needed.

3. **WASM Toolchain & Browser Constraints**
   - `relix-core` and `relix-layout` compile on Rust `stable` for `wasm32-unknown-unknown`.
   - `relix-app` WASM builds require Rust `nightly` (`wasm_thread` uses `#![feature(stdarch_wasm_atomic_wait)]`) and must be served with Cross-Origin Isolation headers (`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`), preconfigured in `crates/relix-app/www/`.
   - Browser builds cannot open native TCP PostgreSQL sockets or local filesystem SQLite paths; use the **Open / Import** modal to paste SQL DDL / schema JSON or switch built-in fixtures.

4. **Desktop Release Build & Packaging**
   - Run `./scripts/build-release.sh` to build the optimized native binary (`target/release/relix`) and static WASM distribution (`crates/relix-app/www/dist/` via `bun run build`).
   - Windows and Linux targets share standard Cargo/GPUI Kit builds (`cargo build --release -p relix-app`) and have not yet been packaged into platform installers (`.dmg` / `.msi` / `.AppImage`).

5. **Composite Key Inference**
   - Per MVP Section 5 rules, deterministic relation inference targets single-column primary keys and single-column unique keys only; multi-column implicit foreign keys are intentionally not auto-inferred (declared composite FKs are still extracted and rendered).

---

## Post-MVP Roadmap (Data & Behavior Layers)

`relix-core::Schema` is intentionally decoupled from IO and UI so later layers can reuse the exact model:
- **Data Layer**: Opt-in read-only table preview/sampling (`LIMIT N`), cardinality inspection, and optional value-inclusion checks behind explicit user consent.
- **Behavior Layer**: View/trigger/stored-procedure lineage visualization and schema migration / diff inspection.
- **Native File Picker & Direct PNG Export**: Native OS file open/save dialogs and optional `resvg`-backed PNG rasterization behind a desktop-only feature flag.
