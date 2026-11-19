# RELIX

**RELIX** 是一款只读的数据库与 GraphQL Schema 结构可视化工作台：读取 SQL DDL / Schema JSON / Saleor & Shopify GraphQL Schema，自动绘制清晰的 ER 图，**展示声明外键关系与用户手动建立的关系**，并支持离线导出文档与交互式图谱。

## 核心特性

- **只读与隐私安全红线**：仅读取表结构与 Schema 元数据，**绝不查询任何业务数据行**；访问 Token 与密码仅驻留内存，绝不写入本地存储、日志或导出文件。
- **远程 GraphQL 数据源（Saleor & Shopify）**：内置 Saleor 3.20 与 Shopify Admin `2026-10` 官方核心 SDL 快照，支持本地 `.graphql` / Introspection JSON 导入及在线只读 `__schema` 内省；自动折叠 `*CountableConnection` / `*Connection` 分页包装类型为 `1:N` 实体关系。
- **手动关系（适配无外键库）**：支持在画布上从字段拖线至另一张表的字段（或在右侧面板中精准创建），支持添加备注、删除、类型不匹配提醒、重新读取时缺失目标标红警告，并在全部 5 种导出格式中明确标注来源。
- **清晰画布与中文支持**：
  - 避障正交布线（不穿越无关表卡片）+ 字段行级锚点 + 悬停连线双向高亮端点字段
  - 三级卡片密度（紧凑 / 标准 / 详细）+ `PK` / `FK` / `UQ` / `?` 徽标 + `VIEW` / `MVIEW` / 分区标记
  - 完整中文表/列注释自动换行展示、IME 输入法兼容搜索、键盘导航（`/` 搜索、方向键沿关系跳转、`Esc` 清除选中）
  - 一键「重新读取 (Reload)」保留现有节点坐标，仅轻量标记新增表与变更字段
- **五种离线导出格式**：Mermaid `erDiagram`、Markdown 数据字典（含完整表/列注释）、浅/深色 SVG（含图例与避障布线）、零外链交互式 HTML、JSON。

## 本地运行

```bash
npm install
npm run dev      # 启动开发服务 http://localhost:3000
npm run lint     # TypeScript 类型检查
npm run build    # 生产构建
```

## 文档索引

- [第二轮打磨计划](./docs/POLISH-PLAN.md)
- [远程数据源说明（Saleor & Shopify）](./docs/sources/README.md)
- [项目进度](./docs/PROGRESS.md)
- [开发笔记与验证记录](./docs/NOTES.md)
- [已知限制](./docs/KNOWN-ISSUES.md)
