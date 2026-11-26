# 编码规则

- 前后端代码必须有中文注释，前端要做到属性、函数、TSX元素注释。后端要做到属性、函数、结构体、枚举等注释。对于前后端的函数处理，要添加行内注释。
- 输出的代码和注释等必须使用 UTF-8（无 BOM）编码，eol=lf。


## 上下文全量检索 (生成代码前必须执行)
**执行时机**：在生成任何建议或代码之前
**工具调用**：本地全量检索方式

**检索策略**：
- 禁止基于假设 (Assumption) 回答
- 使用自然语言构建语义查询 (Where/What/How)
- 完整性检查：必须获取相关类、函数、变量的完整定义与签名
- 若上下文不足，触发递归检索直至信息完整

**需求对齐**：若检索后需求仍有模糊空间，必须向用户输出引导性问题列表，直至需求边界清晰（无遗漏、无冗余）。


## GIT规则
用户要求提交代码时，仅根据修改内容生成中文 commit message（`type(scope): message` 的格式）。
每次用户要求提交代码时，默认使用以下身份：`Author: LiYan <721748889@qq.com>`、`Committer: LiYan <721748889@qq.com>`。
用户要求以指定名义或邮箱提交代码时，必须使用一次性的 `GIT_AUTHOR_NAME`、`GIT_AUTHOR_EMAIL`、`GIT_COMMITTER_NAME`、`GIT_COMMITTER_EMAIL` 完成提交或重写提交，不得修改当前仓库或全局的 git 用户配置。


---

## 工程架构与设计强制约束（防偏离与防 AI 幻觉准则）

> 以下架构设计为本项目的**唯一权威约束**。任何功能迭代、重构或 Bug 修复必须严格遵守，禁止为了图快而引入破坏边界的临时方案或假设性实现。详细设计见 `doc/` 目录下四份架构文档（`architecture-and-datasource-optimization-report.md`、`frontend-ui-state-and-sqlite-optimization-report.md`、`master-architecture-blueprint-2026.md`、`implementation-plan-2026.md`）。

### 1. 多数据源抽象约束（禁止硬编码分支）
- **后端**：所有数据源能力必须通过 `drivers/mod.rs` 中的 `DataSourceDriver` Trait + `ProviderCapabilities` + `DriverRegistry` 接入；连接池与物理客户端由 `ConnectionManager` 统一托管与驱逐。**禁止**在 `commands/`、`services/` 或 `storage/` 中新增 `if source.is_salesforce()`、`if source_type == "mysql"` 等硬编码数据源分支。
- **前端**：所有数据源差异必须收口至 `src/drivers/<kind>/` 并通过 `getDataSourceDriver(sourceType)` 获取。**禁止**在通用组件（尤其是 `DataGrid`、`SourcePanel`、`DataSourceSelector`、`QueryPanel`）中直接判断 `sourceType === "mysql"` 或反向导入特定数据源的逻辑文件（如 `mysqlValueSemantics.ts`）。
- **DataGrid 抽象**：表格组件必须通过 `GridAdapter` 消费主键解析、空值文本、草稿值编解码、字段编辑器与右键菜单，保持数据源无关性。

### 2. UI 风格、窗口与布局约束
- **视觉规范**：全面采用 **Islands 大圆角浮岛风格**（浅灰画布底壳 + 白色大圆角浮岛卡片 `rounded-xl`/`12px` + `6px–8px` 呼吸间隙 + `1px` 极细边框）。
- **无边框与自绘标题栏**：主窗与独立小窗（`AuthPage`、`FieldMetaPage`）统一使用无原生边框（`decorations: false`）+ 自绘标题栏（`CustomTitleBar` / `SubWindowLayout`）。
- **布局复用**：禁止“各页面各自为营”重复实现拖拽分栏、标题栏或弹窗壳，必须复用 `src/layouts/` 下的 `AppShellLayout`、`SubWindowLayout`、`SplitPaneLayout` 与 `WorkspaceTabBar`。
- **禁止启动阻塞**：严禁使用全屏模态遮罩阻塞应用启动；必须采用“应用壳首帧秒开 + 局部 Skeleton 异步水合 + 非激活 Tab 与后台任务懒加载”。

### 3. 插件系统约束（`src/plugins/`）
- **插件化范围**：原“命令库”、终端工作区以及各类辅助工具（JSON 格式化、JSON Diff、Text Diff、二维码、Unicode、局域网文件接收等）**必须**作为标准插件开发在 `src/plugins/builtin/<plugin-id>/` 下，并在 `src/plugins/core/` 注册。
- **沙箱与 API 隔离**：插件只能通过注入的 `PluginContext`（`ctx.storage`、`ctx.ui`、`ctx.workspace`、`ctx.ipc`、`ctx.events`）与主应用交互，**严禁**插件直接导入或读写主应用的内部 Store（如 `useAppShellStore`、`queryWorkspaceStore`）。

### 4. 前端状态与持久化分级约束
- **禁止巨型快照**：严禁将不相关的模块状态或重型查询结果打包成单一全量快照（如旧版 `WorkspaceSnapshotDto`）全量覆盖写盘。
- **五级状态边界**：
  1. **外壳与布局偏好**（主题、分栏宽度、折叠态、最后数据源）：存 `app_settings` 按 key 独立读写；拖拽分栏仅在 `onPointerUp` 时提交一次。
  2. **工作区 Tab 与草稿**（Tab 列表/顺序、SQL 草稿、筛选/排序/列显隐）：按单个 `tab_id` 增量 Upsert。
  3. **重型结果与编辑草稿**（`query_result_sets`、`query_row_drafts`）：启动时不加载，切换至非激活 Tab 时按 `tab_id` 懒加载。
  4. **插件状态**：通过 `ctx.storage` 隔离写入后端 `plugin_kv_store`。
  5. **瞬态 UI 状态**（终端运行输出流、弹窗开关、Loading、Toast、拖拽中临时坐标）：纯内存管理，**禁止持久化**。

### 5. 后端 SQLite 与迁移约束
- **严禁破坏性删库/归档**：所有表结构变更必须通过版本化增量迁移引擎（`MigrationRunner` + `PRAGMA user_version` + `migration_logs`）在单事务内完成，**禁止**以“版本号不匹配即重命名备份并重建空库”代替迁移。
- **并发与封装**：保持 `WAL` 模式并采用“单写连接（带 `SQLITE_BUSY` 退避重试）+ 只读连接池”读写分离；**禁止**向外暴露裸连接锁（如 `Storage::connection()`），所有持久化访问必须收口至 `storage/*_repo.rs` 与 `services/`。
- **凭证安全**：敏感凭证必须通过系统 Keyring + AEAD 加密落盘，禁止新增明文存储。

### 6. SQL 安全、一致性与审计约束（生命线）
- **所见即所执（两阶段提交）**：表格数据变更必须遵循 `prepare_mutation_plan -> 预览 -> commit_mutation_plan(planId, planHash)`，后端直接执行已编译缓存的同一份参数化计划，**严禁**预览算一遍、执行时再重新拼接 SQL。
- **AST 安全网关**：所有控制台 SQL 执行前必须经过后端 `SqlGuard`（只读数据源硬拦截；`DROP`/`TRUNCATE`/`ALTER`/无 `WHERE` 删改/生产环境写操作必须二次确认）。
- **透明化与强制审计**：若后端对查询做了分页/包装改写，必须在结果中返回实际下发的 `executedSql`；所有 SQL 执行与安全拦截结果必须可靠写入 `sql_execution_audit`，**禁止静默吞掉审计错误**。

### 7. 目录与单文件体量约束
- **后端（`src-tauri/src/`）**：严格按 `domain/`、`drivers/`、`services/`、`storage/`、`commands/`、`modules/` 分层；禁止在 `commands/` 中内嵌业务校验或 SQL 拼接逻辑。
- **前端（`src/`）**：严格按 `core/`、`drivers/`、`plugins/`、`layouts/`、`components/`（纯 UI 无数据源耦合）、`features/` 组织；单文件组件建议控制在 400 行以内，严禁再次出现上千行的巨型 God File。
