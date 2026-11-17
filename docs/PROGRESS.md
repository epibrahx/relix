# EPIBRHX Progress

## Phase 0 — 脚手架与可行性冒烟（已完成）

- [x] P0-T1: Cargo workspace 与 5 个 crate 骨架（`epibrhx-core`、`epibrhx-sources`、`epibrhx-layout`、`epibrhx-app`、`schemagen`），配置 `mise.toml`、`rust-toolchain.toml`、`rustfmt.toml`、`Cargo.toml` clippy lints、CI 脚本 `scripts/ci.sh`
- [x] P0-T2: GPUI Kit 桌面端 Hello World 窗口启动验证通过
- [x] P0-T3: GPUI Kit WASM (`wasm32-unknown-unknown`) 编译并在浏览器（`http://localhost:4173/`）渲染及点击交互验证通过；构建与依赖说明记录于 `docs/NOTES.md`
- [x] P0-T4: `epibrhx-core` 与 `epibrhx-layout` 独立编译通过 `wasm32-unknown-unknown`

## Next
- Phase 1 — 数据模型 + SQLite 加载器（P1-T1 ~ P1-T4）
