# EPIBRHX

> **Read-only Database Schema Visualizer (Structural Layer MVP)** — Built with Rust + [GPUI Kit](https://gpui-kit.com) for Native Desktop and WebAssembly.

Input a SQLite database, PostgreSQL connection string, or `schema.sql` DDL file and immediately explore an interactive Entity-Relationship diagram with deterministic implicit foreign-key inference, domain grouping, N-hop focus mode, and offline documentation exports.

---

## Key Capabilities

- **Strictly Read-Only Schema Inspection**:
  - **SQLite**: Opens databases with `SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON`, inspecting only `PRAGMA` / `sqlite_master`.
  - **PostgreSQL**: Executes `SET default_transaction_read_only = on` + `BEGIN READ ONLY` and queries only `information_schema` / `pg_catalog`.
  - **SQL DDL / Schema JSON**: Parses `.sql` files (tolerating non-DDL statements as warnings) and loads pre-exported `Schema` JSON anywhere, including in WASM.
  - **Never queries business rows** and **never stores or prints connection credentials**.
- **Deterministic Implicit Relation Inference** (no opaque scoring or thresholds):
  - Matches `<x>_id` / `<x>Id` / `<x>_uuid` columns to single-column PK/UQ keys of `<x>` (singular/plural + `tbl_` / `t_` prefixes + `parent_id` self-references) with normalized `TypeFamily` equality.
  - Renders unconfirmed inferred edges as dashed lines with full rule `evidence` on hover/selection.
  - Ambiguous multi-candidate columns are never auto-drawn; resolve them manually in the Inspector.
- **Interactive GPU Workbench (Desktop & WASM)**:
  - Pan, cursor-centered scroll zoom, node dragging with `epibrhx.toml` persistence, viewport culling, and 3-tier LOD (~115 FPS on 500 tables on Desktop; verified in `docs/SPIKE-REPORT.md`).
  - Table & column search with smooth camera centering + flash highlight.
  - Direct 1-hop upstream/downstream highlighting, adjustable N-hop Focus mode, automatic/manual domain groups (with collapse to group nodes), `syntect` read-only SQL DDL inspector, and system dark/light appearance sync.
- **Exporters (CLI & UI)**:
  - Mermaid `erDiagram` (`--format mermaid`, solid vs dashed inferred edges)
  - Markdown Data Dictionary (`--format md`)
  - Standalone SVG (`--format svg`)
  - Single-File Offline Interactive HTML (`--format html`, pan/zoom/search/1-hop highlight)
  - Normalized Schema JSON (`--format json`)

---

## 1-Minute Quickstart

### Prerequisites
Managed via [`mise`](https://mise.jdx.dev/) (see `mise.toml` and `rust-toolchain.toml`):
- Rust `stable` (workspace default)
- For WASM: Rust `nightly` (`rustup toolchain install nightly --target wasm32-unknown-unknown --profile minimal`), `wasm-bindgen-cli@0.2.130`, and `bun`

### Launch Desktop Workbench

```bash
# Open built-in Blog/CMS fixture
cargo run -p epibrhx-app

# Open a SQLite file, SQL DDL file, schema JSON, or read-only Postgres URI
cargo run -p epibrhx-app -- fixtures/01_ecommerce.db
cargo run -p epibrhx-app -- fixtures/03_wild_legacy.sql
cargo run -p epibrhx-app -- "postgres://readonly_user@localhost:5432/mydb"
```

### CLI Exports (Headless)

```bash
cargo run -p epibrhx-app -- export fixtures/02_blog_cms.db --format mermaid -o schema.mmd
cargo run -p epibrhx-app -- export fixtures/02_blog_cms.db --format md -o DICTIONARY.md
cargo run -p epibrhx-app -- export fixtures/02_blog_cms.db --format svg -o diagram.svg
cargo run -p epibrhx-app -- export fixtures/02_blog_cms.db --format html -o diagram.html
```

### Run WASM Web Build

```bash
./crates/epibrhx-app/scripts/build-wasm.sh --release
cd crates/epibrhx-app/www && bun install && bun run dev
```

Open `http://localhost:4173` (served with required `COOP`/`COEP` headers for `wasm_thread`).

---

## Workspace Architecture

| Crate | Purpose | WASM Compatible |
| --- | --- | --- |
| [`crates/epibrhx-core`](crates/epibrhx-core) | Unified `Schema` model, type normalization, deterministic inference (`C1`–`C4`), URL redaction, TOML config, exporters | Yes (`stable`) |
| [`crates/epibrhx-layout`](crates/epibrhx-layout) | Hierarchical Sugiyama-style layout (`LayoutEngine`, cycle breaking, barycenter ordering, overlap resolution, N-hop subgraph) | Yes (`stable`) |
| [`crates/epibrhx-sources`](crates/epibrhx-sources) | Native read-only loaders (`sqlite`, `postgres`, `sqlfile`) and `epibrhx.toml` path resolution | Native only |
| [`crates/epibrhx-app`](crates/epibrhx-app) | GPUI Kit Dock workbench, ER canvas, CLI entrypoint, and WASM web wrapper | Desktop + WASM (`nightly`) |
| [`tools/schemagen`](tools/schemagen) | Deterministic synthetic schema generator (`100`/`500`/`2000` scale benchmarks) | Yes |

---

## Security & Privacy Guarantees

1. **No Business Data Queries**: Only system catalogs (`sqlite_master`/`PRAGMA`, `information_schema`/`pg_catalog`) or user-provided DDL/JSON are read.
2. **Credential Redaction**: Passwords in PostgreSQL URLs/DSNs are stripped via `redact_connection_url` before entering UI labels, logs, errors, or stdout/stderr.
3. **Credential-Free Persistence**: `epibrhx.toml` stores only structural overrides (`confirmed_relations`, `rejected_relations`, `manual_relations`, `table_groups`, `collapsed_groups`, `node_positions`, `viewport`) and is keyed for PostgreSQL by a hash of normalized `host + port + database` without username or password.
4. **Zero Telemetry / Network Calls**: EPIBRHX performs zero analytics, update checks, or outbound network traffic beyond explicit user-initiated PostgreSQL metadata connections.

---

## Further Documentation

- [`docs/SPIKE-REPORT.md`](docs/SPIKE-REPORT.md) — Phase 4 desktop & WASM 100/500/2000 table FPS benchmarks
- [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) — Known limitations, PostgreSQL live verification instructions, and post-MVP roadmap
- [`docs/NOTES.md`](docs/NOTES.md) — Toolchain, WASM build, and design notes
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — Phase 0–7 execution log
