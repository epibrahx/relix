# Shopify Admin GraphQL 数据源（Track G3）

## 接入方式

1. **内置官方核心 SDL 快照（免店铺、免 Token）**：包含 Shopify Admin API `2026-10` 核心电商模型（`Product`、`ProductVariant`、`Collection`、`Media`、`InventoryItem`、`InventoryLevel`、`Location`、`Order`、`LineItem`、`DraftOrder`、`FulfillmentOrder`、`Fulfillment`、`Customer`、`MailingAddress`、`DiscountNode`、`Market`）。
2. **在线只读内省（支持官方公共代理或店铺端点）**：
   - 官方公共 Schema 代理：`https://shopify.dev/admin-graphql-direct-proxy/2026-10`（无需店铺与 Token；若浏览器受 CORS 限制，系统会自动给出明确中文提示并推荐一键快照或本地导入）
   - 真实店铺端点：`https://<shop>.myshopify.com/admin/api/<version>/graphql.json`，携带 `X-Shopify-Access-Token`（仅驻留内存，绝不落地）。
3. **本地 SDL / Introspection 文件导入**：支持拖入或选择已下载的 Shopify Admin GraphQL `.graphql` 或 Introspection `.json` 文件。

## 最小权限与数据安全

- **所需权限**：使用公共代理或快照时 **无需任何 Token**；连接店铺端点时仅需最小只读权限（不执行任何业务查询或 Mutation）。
- **是否读取业务数据**：**否**。仅读取 `__schema` 类型定义与字段元数据。
- **API 版本说明**：支持按版本（如 `2026-10`、`2026-07`）切换；标题栏会明确标示当前快照版本与读取日期。

## 特殊映射说明

- **Connection 折叠**：自动识别 Shopify Relay `*Connection`（支持 `nodes` 与 `edges.node` 两种形态），折叠为清晰的 `1:N` 关系线，过滤 `PageInfo` / `*Edge` / `*Input` / `UserError` 等非实体类型。
