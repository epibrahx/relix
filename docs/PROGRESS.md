# RELIX Progress

## Phase 0 — 脚手架与可行性冒烟（已完成）

- [x] P0-T1: Cargo workspace 与 5 个 crate 骨架，配置 `mise.toml`、`rust-toolchain.toml`、`rustfmt.toml`、`Cargo.toml` clippy lints、CI 脚本 `scripts/ci.sh`
- [x] P0-T2: GPUI Kit 桌面端 Hello World 窗口启动验证通过
- [x] P0-T3: GPUI Kit WASM (`wasm32-unknown-unknown`) 编译并在浏览器渲染及点击交互验证通过；记录于 `docs/NOTES.md`
- [x] P0-T4: `relix-core` 与 `relix-layout` 独立编译通过 `wasm32-unknown-unknown`

## Phase 1 — 数据模型 + SQLite 加载器（已完成）

- [x] P1-T1: `relix-core` 统一数据模型与 `type_family` 归一化
- [x] P1-T2: `relix-sources::sqlite` 只读加载器
- [x] P1-T3: 三套 fixtures（`01_ecommerce`、`02_blog_cms`、`03_wild_legacy`）
- [x] P1-T4: 复合 PK/FK、自引用、无主键表、视图边界处理与 `insta` 快照测试

## Phase 2 — Postgres 与 SQL 文件加载器（已完成）

- [x] P2-T1: `relix-sources::postgres` 只读加载器
- [x] P2-T2: `relix-core::redact` 连接串密码脱敏与无凭据 config key 生成
- [x] P2-T3: `relix-core::sqlfile` + `relix-sources::sqlfile`
- [x] P2-T4: `RELIX_TEST_PG_URL` 集成测试与三套 fixtures SQLite/sqlfile 等价性验证
- [x] P2-T5: 友好错误文案与凭据脱敏验证

## Phase 3 — 关系推断引擎（已完成）

- [x] P3-T1: `relix-core::infer` 确定性规则引擎（C1–C4，无打分，歧义候选不自动画线）
- [x] P3-T2: `relix-core::morphology` 单复数、驼峰/下划线及可配置表前缀处理
- [x] P3-T3: 三套 fixtures 期望关系黄金文件与精确率/召回率回归测试
- [x] P3-T4: `relix-core::config` + `relix-sources::config`（`relix.toml` 持久化）

## Phase 4 — 图画布性能验证（已完成，决策关卡：✅ 通过）

- [x] P4-T1: `tools/schemagen` 合成 schema 生成器（100 / 500 / 2000 规模）
- [x] P4-T2: `relix-layout` 分层布局（去环、分层、重心排序、防重叠坐标分配、N 层聚焦子图）
- [x] P4-T3: GPUI Kit ER 图最小画布（表卡片、正交实/虚线连线、滚轮缩放、拖拽平移、节点拖拽）
- [x] P4-T4: 视口裁剪 + 三级 LOD 降级绘制
- [x] P4-T5: 桌面与 WASM 双端 100/500/2000 性能实测并产出 `docs/SPIKE-REPORT.md`

## Phase 5 — MVP 界面（已完成）

- [x] P5-T1: GPUI Kit `DockArea` 工作台主框架（左导航面板、中 ER 画布、右详情面板）
- [x] P5-T2: 表卡片展示 PK 徽标、字段类型、超长列点击展开/折叠及高度重算
- [x] P5-T3: 连线绘制（声明实线、自动推断虚线、确认实线+标记），悬停/选中展示 `evidence` 浮层
- [x] P5-T4: 左侧搜索框支持表名/字段名搜索，点击平滑居中定位并闪烁高亮
- [x] P5-T5: 点击表节点高亮 1 跳上下游表与连线，其余节点与连线淡出
- [x] P5-T6: 聚焦模式（默认 2 层，支持界面 +/- 调节跳数 N）
- [x] P5-T7: 业务域自动前缀分组、组容器渲染、折叠/展开成组节点、手动改组与拖入他组持久化
- [x] P5-T8: 推断关系确认/驳回/重置及歧义候选消解，实时更新并持久化至 `relix.toml`
- [x] P5-T9: 拖拽节点坐标与视口状态持久化至 `relix.toml`，支持一键「Auto Layout」重置
- [x] P5-T10: 右侧 Inspector 面板（列详情/索引/上下游关系/歧义消解/警告列表/`syntect` 只读 SQL DDL 标签页）
- [x] P5-T11: 数据源加载流程（CLI 自动识别、桌面本地连接/文件导入、SQL/JSON 粘贴、3 套内置 fixture 切换，密码严格脱敏）
- [x] P5-T12: 系统浅色/深色外观同步与实时监听（`Theme::sync_system_appearance` + `observe_window_appearance`）

## Phase 6 — 导出器与 CLI（已完成）

- [x] P6-T1: Mermaid `erDiagram` 导出器（区分声明实线、自动推断虚线 `[inferred]`、已确认 `[confirmed]`，省略已驳回）
- [x] P6-T2: Markdown 数据字典导出（含表概览、字段详情、索引、关系清单与警告，不含连接凭据）
- [x] P6-T3: 独立 SVG 导出（基于布局坐标、实/虚线与颜色区分、XML 安全转义）
- [x] P6-T4: 单文件离线交互式 HTML 导出（内嵌 SVG + 零外链 JS 缩放/平移/高亮/搜索）
- [x] P6-T5: CLI 命令（`relix <source>`、`relix export <source> --format ... -o <path>`）与 UI Export 弹窗（预览、剪贴板复制、文件保存）
- [x] P6-T6: PNG 导出经核实 GPUI 桌面/Web 平台暂未实现 `render_to_image`，已记录于 `docs/NOTES.md`

## Phase 7 — 收尾与发布准备（已完成）

- [x] P7-T1: 核实 `RELIX_TEST_PG_URL` 真实库回归入口；当前环境未设置该环境变量，已如实记录于 `docs/KNOWN-ISSUES.md`，SQLite / `sqlfile` / PG 脱敏与错误处理测试全部通过
- [x] P7-T2: 编写 `README.md`（1 分钟快速上手、CLI/UI/WASM 用法、只读与隐私安全约束、架构说明）
- [x] P7-T3: 添加发布构建脚本 `scripts/build-release.sh` 并记录跨平台桌面与 WASM 静态站点构建步骤
- [x] P7-T4: 编写 `docs/KNOWN-ISSUES.md`（已知限制、PG 实测步骤及复用 `relix-core::Schema` 的 Data/Behavior 后续路线图）

## Status
MVP 全部阶段（Phase 0 – Phase 7）实施与验收已完成。

---

## Round-2 精细化打磨计划（2026-11-18，Web 版全面推进）

### Track F — 推断隐藏善后（P0 · 已完成）
- [x] F1: 全面清理 UI、标题、导出、README 中「推断 / 隐含 / inferred」文案；`ENABLE_INFERENCE = false` 默认关闭，仅在受控核心逻辑与测试中保留代码。
- [x] F2: 5 种导出格式（Mermaid、Markdown、SVG、HTML、JSON）默认均不含任何推断关系或字段，单元测试已覆盖断言。
- [x] F3: 开关关闭与显式开启两条测试路径均通过（共 15/15 单元测试通过）。
- [x] F4: 已将 `docs/POLISH-PLAN.md` 归档入库，并更新 `docs/PROGRESS.md`、`docs/NOTES.md`、`docs/KNOWN-ISSUES.md`。

### Track G — 远程 GraphQL 电商数据源：Saleor & Shopify（P0 · 已完成）
- [x] G1: 抽象统一 `SchemaSource` 协议、`SourceSpec` 与 GraphQL SDL + Introspection JSON（`__schema`）双格式解析器，实现 `*CountableConnection` / `*Connection` → `edges.node` 自动折叠、非实体过滤与 `@doc(category)` 自动分组；UI 入口明确标注「是否读取业务数据：否」，凭据仅驻留内存不落盘。
- [x] G2: 落地 Saleor 3.20 核心 SDL 官方快照、本地 `.graphql`/`.json` 文件导入、在线只读内省及文档 `docs/sources/saleor.md`。
- [x] G3: 落地 Shopify Admin `2026-10` 核心 SDL 官方快照（含 `Product`/`ProductVariant`/`Order`/`FulfillmentOrder`/`InventoryLevel` 等核心实体）、公共代理/店铺端点直连、本地导入及文档 `docs/sources/shopify.md`。
- [x] G4: 实现 401/403/429/CORS 中文错误分类与 Token 严格脱敏，并在顶部工具栏展示快照版本与日期。

### Track A — 真实边界覆盖与错误体验（P0 · Web 可执行部分已完成，A1/A2 需本地 PG）
- [ ] A1 / A2: 真实 PostgreSQL 与 PgBouncer 事务级只读实测（当前容器无 PostgreSQL / PgBouncer 服务，已在 `docs/KNOWN-ISSUES.md` 如实标注）。
- [x] A3: 新增 `fixtures/04_edge_cases_cn.sql` 并升级 SQL 解析器，支持 ENUM、DOMAIN、VIEW、MATERIALIZED VIEW、分区表（`PARTITION BY`/`PARTITION OF`）、多 Schema、带引号大小写混合标识符、复合 PK/FK、无主键表与中英文表/列注释；视图与分区表在侧栏与画布均有醒目标记。
- [x] A4: 引入 MIT 许可的 Chinook 公开示例库子集 `fixtures/05_chinook_subset.sql`（11 张表、真实多跳外键网），全 5 种导出格式均通过回归断言。
- [x] A5: 补齐连不上/证书/sslmode/权限/空库/认证失败中文错误分类与 URI/KV/Bearer/Shopify Token 严格脱敏测试。

### Track B — 无外键场景：手动连线（P1 · B1 已完成）
- [x] B1: 引入独立 `kind: 'manual'` 关系类型（不复用 `inferred`），支持画布字段拖线与 Inspector 快捷创建、中文备注编辑、删除、按表名+字段名持久化、字段类型族不匹配非阻断提示、重载时目标表/字段缺失红色警告（不静默丢失）、紫色虚线+空心圆/菱形端点样式，以及全 5 种导出格式的来源标注。

### Track C — 中文场景打磨（P1 · 已完成）
- [x] C1: 引入中文字体回退栈（PingFang SC / Microsoft YaHei / Noto Sans CJK SC）。
- [x] C2: 搜索框支持中文输入法组合态（`compositionstart`/`compositionend`）与表名/字段名/中文注释联合检索。
- [x] C3: 画布悬停浮层支持长中文注释自动换行与视口边界防溢出，右侧 Inspector 完整展示多行中文注释。

### Track D — 画布体验打磨（P2 · D1–D6 已完成）
- [x] D1: 正交避障路由，在 01–05 fixtures 与 100 表压测集上实测穿过无关表卡片线段数为 **0**。
- [x] D2: 连线锚点精确贴齐起止字段行，悬停/选中连线时双向高亮端点字段行。
- [x] D3: 「重新读取」按钮保留既有节点坐标，为新增表与变更字段提供轻量 `NEW`/`MOD` 徽标与移除警告（不做完整 Diff 视图）。
- [x] D4: 业务域聚类分组布局（`groupedSugiyamaLayout`），各域容器带标题栏与内联折叠按钮，彻底消除域容器重叠。
- [x] D5: 表卡片三级密度切换（紧凑 / 标准 / 详细）与内联 `PK`/`FK`/`UQ`/`?` 徽标。
- [x] D6: 快捷键导航（`/` 聚焦搜索、方向键遍历关联表、`Esc` 关闭弹窗/退出连线/取消选中）与无障碍 `aria-label` / `role`。

### Track E — 首次体验与导出质感（P2 · E1–E2 已完成，E3 仅适用 Rust WASM）
- [x] E1: 默认启动加载 `01 电商示例` 并自动适配视口居中完整展示。
- [x] E2: SVG 与单文件交互式 HTML 导出新增浅色/深色主题切换与声明/手动图例，Markdown 导出补全表与列注释。
- [ ] E3: Rust `wasm-opt` 产物体积与加载耗时记录（当前运行环境为 React/Vite Web 应用，无 Rust/wasm-opt 工具链，已在 `docs/KNOWN-ISSUES.md` 如实记录）。

