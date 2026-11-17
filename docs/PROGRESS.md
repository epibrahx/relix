# EPIBRHX Progress

## Phase 0 — 脚手架与可行性冒烟（已完成）

- [x] P0-T1: Cargo workspace 与 5 个 crate 骨架，配置 `mise.toml`、`rust-toolchain.toml`、`rustfmt.toml`、`Cargo.toml` clippy lints、CI 脚本 `scripts/ci.sh`
- [x] P0-T2: GPUI Kit 桌面端 Hello World 窗口启动验证通过
- [x] P0-T3: GPUI Kit WASM (`wasm32-unknown-unknown`) 编译并在浏览器渲染及点击交互验证通过；记录于 `docs/NOTES.md`
- [x] P0-T4: `epibrhx-core` 与 `epibrhx-layout` 独立编译通过 `wasm32-unknown-unknown`

## Phase 1 — 数据模型 + SQLite 加载器（已完成）

- [x] P1-T1: `epibrhx-core` 统一数据模型与 `type_family` 归一化（含 JSON round-trip 与表驱动单测）
- [x] P1-T2: `epibrhx-sources::sqlite` 只读加载器
- [x] P1-T3: 三套 fixtures（`01_ecommerce`、`02_blog_cms`、`03_wild_legacy`）
- [x] P1-T4: 复合 PK/FK、自引用、无主键表、视图边界处理与 `insta` 快照测试

## Phase 2 — Postgres 与 SQL 文件加载器（已完成）

- [x] P2-T1: `epibrhx-sources::postgres` 只读加载器（`SET default_transaction_read_only = on` + `BEGIN READ ONLY`，查询 `pg_catalog`/`information_schema`，支持多 schema 且排除系统 schema，支持 `rustls` TLS）
- [x] P2-T2: `epibrhx-core::redact` 连接串密码脱敏与无凭据 config key 生成
- [x] P2-T3: `epibrhx-core::sqlfile` + `epibrhx-sources::sqlfile`（`sqlparser` 解析 DDL，容错记录 `warnings`，支持 WASM 复用）
- [x] P2-T4: `EPIBRHX_TEST_PG_URL` 环境变量控制的 Postgres 集成测试 + SQLite/sqlfile 三套 fixtures 等价性验证通过
- [x] P2-T5: `SourceError` 友好错误文案与凭据脱敏验证

## Next
- Phase 3 — 关系推断引擎（P3-T1 ~ P3-T4）
