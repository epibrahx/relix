# RELIX Migration Parity Baselines (from `0dc76cb`)

> 生成来源：`archive/react-prototype`（提交 `0dc76cb`）· 生成日期：2026-11-18 · 推断开关：`ENABLE_INFERENCE = false`

本目录存放 TypeScript 原型版对各示例导出的 **Mermaid (`.mmd`) / Markdown (`.md`) / JSON (`.json`)** 行为基准，供迁移回 **Rust + GPUI Kit**（基线 `90ee867`）时做逐项对照验收。

| 基准集 | 说明 | 实体 / 表数 | 关系数 | 来源说明 |
|---|---|---:|---:|---|
| `01_ecommerce` | 01 电商示例 | 9 | 7 (0 manual) | fixtures/01_ecommerce.sql (source commit 0dc76cb) |
| `03_wild_legacy` | 03 无外键库（零外键基准） | 8 | 0 (0 manual) | fixtures/03_wild_legacy.sql (source commit 0dc76cb, ENABLE_INFERENCE=false) |
| `03_wild_legacy_manual` | 03 无外键库（含 1 条手动关系基准） | 8 | 1 (1 manual) | fixtures/03_wild_legacy.sql + manual relation (source commit 0dc76cb) |
| `04_edge_cases_cn` | 04 边界与中文 | 6 | 1 (0 manual) | fixtures/04_edge_cases_cn.sql (source commit 0dc76cb) |
| `saleor_prototype_subset` | Saleor 3.20（TS 原型子集基准，非官方完整 SDL） | 19 | 43 (0 manual) | archive/react-prototype src/core/sources/saleor.ts (source commit 0dc76cb; replace with official BSD-3-Clause saleor/graphql/schema.graphql in R1.3) |
| `shopify_prototype_subset` | Shopify Admin 2026-10（TS 原型子集基准，非官方完整 SDL） | 16 | 33 (0 manual) | archive/react-prototype src/core/sources/shopify.ts (source commit 0dc76cb; do NOT bundle Shopify SDL in Rust repo per Shopify API Terms) |

## R1.3 官方 SDL 许可核查结论（供 Rust 迁移直接采用）
- **Saleor (`saleor/saleor`)**：**BSD-3-Clause** 许可，允许附带原始版权声明与许可文本随仓库分发官方完整 `saleor/graphql/schema.graphql`。
- **Shopify (`shopify.dev/admin-graphql-direct-proxy/<version>`)**：受 **Shopify API License and Terms of Use** 约束，不授予开源再分发授权；Rust 仓库**不得内置** Shopify SDL，仅在文档与界面中说明用户自行拉取/导入方式。
