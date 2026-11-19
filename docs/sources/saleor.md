# Saleor GraphQL 数据源（Track G2）

## 接入方式

1. **内置核心 SDL 快照（免 Token、免跨域）**：包含 Saleor 3.20 核心电商模型（`Product`、`ProductVariant`、`ProductType`、`Category`、`Collection`、`Channel`、`Warehouse`、`Stock`、`Allocation`、`Checkout`、`Order`、`OrderLine`、`Fulfillment`、`TransactionItem`、`User`、`Address`），完整保留 `@doc(category)` 业务域注解与 `*CountableConnection` 关系。
2. **本地 SDL / Introspection 文件导入**：支持从 Saleor 仓库直接导入 `saleor/graphql/schema.graphql` 或通过 CLI 导出的 Introspection JSON。
3. **在线只读内省（Live Introspection）**：输入自托管或云端 Saleor GraphQL 端点（如 `https://<your-saleor>/graphql/`），可选填只读 `Authorization: Bearer <token>`（仅驻留内存，不落地）。

## 最小权限与数据安全

- **所需权限**：仅需端点开放 GraphQL Introspection（公共 Schema 通常免 Token，或使用仅具只读权限的 App Token）。
- **是否读取业务数据**：**否**。仅执行只读 `__schema` 元数据查询。

## 特殊映射说明

- **Connection 折叠**：自动识别 Saleor 特有的 `*CountableConnection` / `*CountableEdge` 结构，沿 `edges.node` 折叠为直接的 `1:N` 实体关系，避免画布被大量分页包装节点淹没。
- **自动业务域分组**：优先读取 Saleor SDL 中的 `@doc(category: "...")` 指令进行自动分组。
- **CORS 提示**：若自托管 Saleor 未配置浏览器跨域允许，界面将明确提示「端点不可用或 CORS 受限」，建议导出 `schema.graphql` 后在浏览器直接本地解析。
