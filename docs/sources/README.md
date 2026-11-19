# RELIX 远程数据源指南（Track G）

RELIX 通过统一的 `SchemaSource` 抽象将远程 API Schema 映射为标准 `Schema`（表 / 字段 / 关系），与本地 SQL DDL 共享同一套画布、分组、手动连线与五格式导出能力。

## 严格边界与安全红线

1. **当前聚焦范围**：仅接入 **Saleor** 与 **Shopify** 两个电商 GraphQL 源。
2. **绝不读取业务数据**：在线内省仅发送只读 `__schema` Introspection 查询，不查询商品、订单、客户等任何业务数据行。
3. **凭据不落地**：访问 Token 仅在内存中使用，不写入 `localStorage`、不写入配置文件、不出现在导出文件或报错信息中（强制脱敏）。
4. **浏览器 CORS 说明**：部分自托管或店铺端点的 GraphQL API 未开放浏览器跨域（CORS）访问。若直连受阻，RELIX 会明确提示，并支持一键加载官方核心快照或直接导入本地 `.graphql` SDL / Introspection JSON 文件。

## GraphQL → ER 图统一映射规则

| GraphQL 概念 | RELIX ER 模型 | 说明 |
|---|---|---|
| 核心业务 `type`（Object） | `Table` | 自动过滤 `Query` / `Mutation` / `Subscription` / `*Input` / `*Payload` / `*Error` / `PageInfo` / `__*` |
| 标量 / 枚举字段 | `Column` | 保留 `!` 非空、`[]` 列表标记与字段/枚举注释 |
| 直接实体引用字段 | `Relation (declared)` | 直接从来源字段连线至目标实体主键 |
| `*CountableConnection` / `*Connection` | 折叠为 `1:N` `Relation (declared)` | 解析 `edges -> node` 或 `nodes`，画布不出现多余的 `Connection` / `Edge` 包装表 |
| `@doc(category: "...")` 或实体前缀 | `Table.domain` 业务域分组 | 自动归类到 Catalog / Orders / Inventory / Billing / Customers / Channels |

## 各连接器详细文档

- [Saleor GraphQL 连接器](./saleor.md)
- [Shopify Admin GraphQL 连接器](./shopify.md)
