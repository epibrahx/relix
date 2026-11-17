# EPIBRHX Notes

> Architecture decisions, tool/WASM build notes, and out-of-scope items deferred for post-MVP iterations.

## Toolchain & Build Notes

### Desktop / Core / Tests
- Managed by `mise.toml` (`rust = "stable"`, currently `rustc 1.100.0`) and `rust-toolchain.toml`.
- Standard verification script: `./scripts/ci.sh`
  - `cargo fmt --all -- --check`
  - `cargo clippy --workspace --all-targets -- -D warnings`
  - `cargo test --workspace`
  - `cargo check -p epibrhx-core -p epibrhx-layout --target wasm32-unknown-unknown`

### WASM (`wasm32-unknown-unknown`)
- `gpui-kit` `0.10.0` transitively depends on `wasm_thread v0.3.3`, which uses `#![feature(stdarch_wasm_atomic_wait)]` on `wasm32`. Therefore, compiling `epibrhx-app` for `wasm32-unknown-unknown` requires a **nightly** toolchain (while `epibrhx-core` and `epibrhx-layout` compile on `stable`), matching upstream `gpui-kit/crates/story-web`.
- Required setup:
  - `rustup toolchain install nightly --target wasm32-unknown-unknown --profile minimal`
  - `wasm-bindgen-cli` pinned to `0.2.130` (matching `Cargo.lock`, managed via `mise.toml` `cargo:wasm-bindgen-cli@0.2.130`)
  - `bun` in `crates/epibrhx-app/www` (`bun install`)
- Build & run commands:
  - Build WASM + JS bindings: `./crates/epibrhx-app/scripts/build-wasm.sh` (pass `--release` for release build; uses `-C link-arg=-zstack-size=8388608` and `wasm-bindgen --target web --no-typescript`)
  - Start local web dev server (with COOP/COEP headers): `cd crates/epibrhx-app/www && bun run dev`
- WASM fonts:
  - GPUI Web has no system font database and requires `IBM Plex Sans` (for `.SystemUIFont`) and UI fonts registered via `cx.text_system().add_fonts(...)` before opening the window.
  - Bundled in `crates/epibrhx-app/fonts/`: `IBMPlexSans-Regular.ttf`, `Inter-Regular.ttf`.

## Exporter Notes
- `P6-T6` (PNG export): GPUI desktop/web window platforms currently return `render_to_image not implemented for this platform`. Rather than introducing a direct `resvg` dependency inside `epibrhx-core` (keeping the core/WASM bundle minimal), PNG rasterization is deferred post-MVP; SVG, self-contained interactive HTML, Mermaid `erDiagram`, Markdown data dictionary, and JSON are supported cleanly.
