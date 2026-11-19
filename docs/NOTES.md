# RELIX Notes

> Architecture decisions, tool/WASM build notes, and out-of-scope items deferred for post-MVP iterations.

## Toolchain & Build Notes

### Desktop / Core / Tests
- Managed by `mise.toml` (`rust = "stable"`, currently `rustc 1.100.0`) and `rust-toolchain.toml`.
- Standard verification script: `./scripts/ci.sh`
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `cargo check -p relix-core -p relix-layout --target wasm32-unknown-unknown`

### WASM (`wasm32-unknown-unknown`)
- `gpui-kit` `0.10.0` transitively depends on `wasm_thread v0.3.3`, which uses `#![feature(stdarch_wasm_atomic_wait)]` on `wasm32`. Therefore, compiling `relix-app` for `wasm32-unknown-unknown` requires a **nightly** toolchain (while `relix-core` and `relix-layout` compile on `stable`), matching upstream `gpui-kit/crates/story-web`.
- Required setup:
  - `rustup toolchain install nightly --target wasm32-unknown-unknown --profile minimal`
  - `wasm-bindgen-cli` pinned to `0.2.130` (matching `Cargo.lock`, managed via `mise.toml` `cargo:wasm-bindgen-cli@0.2.130`)
  - `bun` in `crates/relix-app/www` (`bun install`)
- Build & run commands:
  - Build WASM + JS bindings: `./crates/relix-app/scripts/build-wasm.sh` (pass `--release` for release build; uses `-C link-arg=-zstack-size=8388608` and `wasm-bindgen --target web --no-typescript`)
  - Start local web dev server (with COOP/COEP headers): `cd crates/relix-app/www && bun run dev`
- WASM fonts:
  - GPUI Web has no system font database and requires `IBM Plex Sans` (for `.SystemUIFont`) and UI fonts registered via `cx.text_system().add_fonts(...)` before opening the window.
  - Bundled in `crates/relix-app/fonts/`: `IBMPlexSans-Regular.ttf`, `Inter-Regular.ttf`.

## Exporter Notes
- `P6-T6` (PNG export): GPUI desktop/web window platforms currently return `render_to_image not implemented for this platform`. Rather than introducing a direct `resvg` dependency inside `relix-core` (keeping the core/WASM bundle minimal), PNG rasterization is deferred post-MVP; SVG, self-contained interactive HTML, Mermaid `erDiagram`, Markdown data dictionary, and JSON are supported cleanly.

---

## Round-2 Polish Plan Verification Notes (2026-11-18)

### Automated Unit Test Suite (`node:test` via `tsx --test`)
- Command: `npx --yes tsx --test src/core/inference_and_exports.test.ts src/core/sources/graphql.test.ts src/core/manual_relations.test.ts src/layout/routing.test.ts`
- Result: **15/15 tests passing** (0 failures):
  - Track F: Default `ENABLE_INFERENCE = false` strips inferred relations and produces zero inferred output across all 5 export formats; explicit inference path still passes golden assertions on `03_wild_legacy`.
  - Track G: Saleor 3.20 SDL, Shopify Admin `2026-10` SDL, and Introspection JSON (`__schema`) all fold `*CountableConnection` / `*Connection` wrappers cleanly, preserve `FulfillmentOrder`/`DraftOrder`, filter non-entity types, map `@doc(category)` domains, and classify 401/403/429/CORS errors in Chinese with strict secret token redaction.
  - Track A3/A4/A5: `04_edge_cases_cn.sql` parses ENUM, DOMAIN, VIEW, MATERIALIZED VIEW, partitioned parent/child tables, multi-schema quoted mixed-case identifiers, composite PK/FK, no-PK table, and Chinese comments; `05_chinook_subset.sql` (MIT) exports cleanly across all 5 formats.
  - Track B1: Manual relations use distinct `kind = 'manual'`, support note edits & delete, flag type-family mismatches without blocking, raise red missing-target warnings on reload instead of silent drops, and annotate `[manual]` / `[source: manual]` / `data-source="manual"` in all 5 export formats.
  - Track D1–D5: Obstacle-avoiding orthogonal routing achieves **0 segments crossing unrelated cards** on fixtures `01`–`05` AND the **100-table synthetic benchmark** (~207 ms total); `groupedSugiyamaLayout` packs multi-domain schemas with **0 overlapping domain containers**; `computeReloadDiff` preserves existing node coordinates and tags `NEW`/`MOD` items.

### Real Browser Verification (Headless Chromium via `playwright-cli`, 1440×900)
- **Round 1** caught 2 High visual defects (initial auto-fit clipped rightmost tables/top headers; domain containers overlapped on multi-group schemas) and 1 Low overlap (top-right legend near headers).
- **Fixes applied**: Added domain-clustered `groupedSugiyamaLayout`, upgraded `fitToView` to fit exact `[nodes ∪ containers]` bounds on initial mount and source switches, and moved the legend overlay to bottom-right.
- **Round 2** verified clean auto-fit on `01 电商示例` (48% zoom, 0 clipped cards), Saleor 3.20 (6 cleanly separated domain containers), `03 无外键库` manual relation workflow, `04 边界与中文` (`TenantAccount` wrapped Chinese comments, `VIEW`/`MVIEW`/`PART` badges, non-blocking type mismatch warning), Export Modal SVG Light/Dark toggle, and **0 browser console errors / 0 warnings**.

### GraphQL CORS Note
- Browser-side live GraphQL Introspection (`fetch`) obeys standard browser CORS rules. Public endpoints that return `Access-Control-Allow-Origin` (such as Saleor demo endpoints) can be introspected directly; private stores or endpoints without CORS headers display a clear Chinese guidance message recommending local `.graphql` / Introspection JSON import or built-in snapshots.

