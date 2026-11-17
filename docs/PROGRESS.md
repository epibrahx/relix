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
