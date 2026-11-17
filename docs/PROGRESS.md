# EPIBRHX Progress

## Phase 0 — 脚手架与可行性冒烟（已完成）

- [x] P0-T1: Cargo workspace 与 5 个 crate 骨架，配置 `mise.toml`、`rust-toolchain.toml`、`rustfmt.toml`、`Cargo.toml` clippy lints、CI 脚本 `scripts/ci.sh`
- [x] P0-T2: GPUI Kit 桌面端 Hello World 窗口启动验证通过
- [x] P0-T3: GPUI Kit WASM (`wasm32-unknown-unknown`) 编译并在浏览器渲染及点击交互验证通过；记录于 `docs/NOTES.md`
- [x] P0-T4: `epibrhx-core` 与 `epibrhx-layout` 独立编译通过 `wasm32-unknown-unknown`

## Phase 1 — 数据模型 + SQLite 加载器（已完成）

- [x] P1-T1: `epibrhx-core` 统一数据模型 (`Schema` / `Table` / `Column` / `Index` / `Relation`) 与 `type_family` 归一化（含 JSON round-trip 与表驱动单测）
- [x] P1-T2: `epibrhx-sources::sqlite` 只读模式 (`SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON`) 通过 `sqlite_master` 与 `PRAGMA` 读取元数据
- [x] P1-T3: 三套 fixtures（`01_ecommerce`、`02_blog_cms`、`03_wild_legacy`，含 `.sql` 与 `.db`）
- [x] P1-T4: 复合主键、复合外键、自引用外键、无主键表、视图 (`TableKind::View`) 边界处理与 `insta` 快照测试

## Next
- Phase 2 — Postgres 与 SQL 文件加载器（P2-T1 ~ P2-T5）
