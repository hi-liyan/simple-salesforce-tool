# 全栈架构重塑最终实现计划（Implementation Plan 2026）

> **关联设计文档**：
> - [architecture-and-datasource-optimization-report.md](file:///d:/test-workspace/simple-salesforce-tool/doc/architecture-and-datasource-optimization-report.md)（数据源抽象与目录规范）
> - [frontend-ui-state-and-sqlite-optimization-report.md](file:///d:/test-workspace/simple-salesforce-tool/doc/frontend-ui-state-and-sqlite-optimization-report.md)（Islands UI、自绘标题栏、插件系统、状态分级与 SQLite 规范化）
> - [master-architecture-blueprint-2026.md](file:///d:/test-workspace/simple-salesforce-tool/doc/master-architecture-blueprint-2026.md)（DataGrid 抽象、SQL LSP、执行安全与审计总纲）

---

## 一、总体实施原则

1. **增量演进、禁止一次性推倒停摆**：每个 Milestone 结束后必须保证 `tsc && vite build`、`cargo test` 与前端 Node 单测全部通过，应用可正常启动运行。
2. **先立契约，再迁实现**：先定义 Trait / Interface / Schema / Plugin SDK，再将现有 Salesforce、MySQL、终端、工具面板逐一迁入新体系。
3. **严格遵循工程约束**：所有新增与重构代码必须遵守根目录 [AGENTS.md](file:///d:/test-workspace/simple-salesforce-tool/AGENTS.md) 中的架构边界与编码规范，严禁回退到硬编码分支或巨型快照模式。

---

## 二、分阶段实现计划

### Milestone 1：后端地基重塑（SQLite 规范化 + 数据源 Trait 抽象）

**目标**：消除“升级丢数据”和“无法扩展数据源”的两大底座风险。

#### Task 1.1：SQLite 版本化增量迁移与 WAL 读写分离
- **范围**：`src-tauri/src/storage/`（`mod.rs`、`bootstrap.rs`、`schema.rs`、`tx.rs`、`pragma.rs`）
- **具体动作**：
  1. 实现 `MigrationRunner`（基于 `PRAGMA user_version` + `migration_logs`），将现有 v2 schema 设为基线迁移 `V1`，未来变更通过 `V2, V3...` 增量事务脚本执行，移除 `bootstrap.rs` 中“版本不一致即整库归档删库”逻辑。
  2. 改造 `Storage` 为“单写连接 + 只读连接池（`OpenFlags::SQLITE_OPEN_READ_ONLY`）”，移除 `Storage::connection()` 裸锁暴露；在 `tx.rs` 实现 `SQLITE_BUSY` 退避重试。
  3. 增量迁移新增/修复：
     - 补全 `source_object_indexes`、`source_object_constraints` 的外键级联删除及外键/查询索引；
     - 新增 `plugin_kv_store (plugin_id, storage_key, value_json, updated_at)`；
     - 新增 `sql_execution_audit` 审计表；
     - 清理死表 `terminal_tab_state`；
     - 接入系统 Keyring + AEAD 替换 `secret_repo.rs` 的 `'plain-text/v1'`。
- **验收**：`cargo test` 通过；模拟旧库升级保留全部用户数据且零报错；并发读不阻塞写事务。

#### Task 1.2：后端 `DataSourceDriver` Trait 与目录重组
- **范围**：`src-tauri/src/providers/` -> `drivers/`、`domain/`、`services/`、`commands/`、`modules/`
- **具体动作**：
  1. 在 `domain/` 中建立去 Salesforce 化的通用模型（`DataSource`、`DataObject`、`ObjectDescribe`、`QueryRequest`、`QueryResult`），短期保留类型别名兼容前端。
  2. 在 `drivers/mod.rs` 定义 `DataSourceDriver` Trait、`ProviderCapabilities`、`DriverRegistry` 与 `ConnectionManager`（按 `source_id` 缓存并管理 `MySqlPool` 等连接池）。
  3. 将 `salesforce.rs` + `sf_cli.rs` + `salesforce_provider.rs` 收敛至 `drivers/salesforce/`；将 1999 行的 `mysql_provider.rs` 拆分为 `drivers/mysql/{mod,config,metadata,query,mutation,log_detail}.rs`。
  4. 将 3293 行的 `commands.rs` 按领域拆分为 `commands/{source,metadata,query,workspace,auth_window,ai,terminal,tools,settings}_commands.rs`；将 `terminal.rs`、`lan_file_receiver.rs`、`ai/`、`llm.rs` 归位至 `modules/`。
- **验收**：`commands/` 与 `source_service.rs` 中不再出现 `if source.is_salesforce()` 或 `"mysql"` 硬编码分支。

---

### Milestone 2：无边框自绘标题栏、Islands UI 与无阻塞启动

**目标**：彻底改变前端视觉形态，实现秒开无阻塞交互与统一 Layout 体系。

#### Task 2.1：Tauri 无边框窗口与自绘标题栏
- **范围**：`src-tauri/tauri.conf.json`、`src-tauri/capabilities/main-window.json`、`src/layouts/`
- **具体动作**：
  1. `tauri.conf.json` 中为所有窗口配置 `"decorations": false`；`main-window.json` 授予 `core:window:allow-start-dragging`、`allow-minimize`、`allow-toggle-maximize`、`allow-close`、`allow-is-maximized`。
  2. 在 `src/styles/` 定义 Islands 大圆角设计 Token（画布底色 `#F2F4F7`、浮岛卡片 `12px` 圆角、`8px` 间距、`1px` 极细边框）。
  3. 实现 `CustomTitleBar`（高 `42px`）：左侧集成 `新建连接`、`新建查询`、`数据传输`（预留）、`驱动管理`、`更多`；右侧集成 `插件中心`、`AI 助手`、`系统日志`、`设置` 及自绘窗口控制按钮。

#### Task 2.2：标准化 Layout 体系与无阻塞启动
- **范围**：`src/layouts/`、`src/pages/`、`src/App.tsx`、`src/main.tsx`
- **具体动作**：
  1. 实现 `AppShellLayout`（三栏大圆角浮岛 + 底部状态栏 + 全局 Toast/Modal Portal）、`SplitPaneLayout`（统一指针拖拽分栏，仅 `onPointerUp` 持久化宽度）、`SubWindowLayout`（统一 `AuthPage`、`FieldMetaPage` 无边框小窗壳）。
  2. 移除 `MainPage.tsx` 全屏启动阻塞遮罩（`z-[120]`），改为外壳首帧秒开 + 局部 Skeleton 异步水合；将 `useMainPageQueryPanel` 从 `MainPage` 下沉回工作区内部。
  3. 将 CLI 同步、非激活 Tab 恢复、版本更新检查延后至后台空闲执行。
- **验收**：启动后 50ms 内可操作标题栏与各面板切换；多窗口视觉风格与大圆角体系完全统一。

---

### Milestone 3：前端状态分级重构、数据源 Driver 与插件系统落地

**目标**：拆解 `workspaceSnapshot.ts` 巨型快照，实现前端数据源驱动化与工具/命令库插件化。

#### Task 3.1：4 类持久化状态分级与增量接口
- **范围**：`src/store/`、`src-tauri/src/services/workspace_service.rs`、`src-tauri/src/commands/workspace_commands.rs`
- **具体动作**：
  1. 废除整包 `save_workspace_snapshot` / `load_workspace_snapshot` 覆写，后端提供按 key 读写 `app_settings`、按 `tab_id` 增量 Upsert Tab 元数据、以及按 `tab_id` 懒加载 `query_result_sets` / `query_row_drafts` 的接口。
  2. 前端拆解 `workspaceSnapshot.ts`（781 行）：`useAppShellStore` 仅管外壳与布局；`queryWorkspaceStore` 按 Tab 增量保存；移除 `useTerminalStore` 无效持久化。
  3. 将 `src/queries/salesforce.ts` 重命名并迁入 `src/core/query/`，按领域拆分 `src/api/index.ts`。

#### Task 3.2：前端 `DataSourceDriver` 注册表与分支清零
- **范围**：`src/drivers/`、`src/features/source-manager/`、`src/features/query-workspace/`
- **具体动作**：
  1. 建立 `src/drivers/types.ts` 与 `src/drivers/registry.ts`，实现 `src/drivers/salesforce/` 与 `src/drivers/mysql/`。
  2. 将 `SourcePanel`、`DataSourceSelector`、`ObjectList`、`sourceSecrets.ts`、`sourceTreeProviders.ts` 全部改为消费 `getDataSourceDriver(sourceType)`。
- **验收**：全局搜索 `sourceType === "mysql"` 或 `isMysqlSource` 在核心业务与通用组件中归零。

#### Task 3.3：标准化插件系统（`src/plugins/`）与内置插件迁移
- **范围**：`src/plugins/core/`、`src/plugins/builtin/`、`src/features/main/ToolsPanel/`、`src/features/main/TerminalPanel/`
- **具体动作**：
  1. 建设 `src/plugins/core/`（`PluginManifest`、`PluginContext`、`PluginRegistry`、`WorkspaceTabHost` / `DockPanelHost` / `ModalHost`）及后端 `plugin_kv_store` IPC 命令。
  2. 将**命令库（`command-library`）**、**系统终端（`terminal-workspace`）** 与 **6 个工具**（`json-formatter`、`json-diff`、`text-diff`、`qr-code`、`unicode-converter`、`lan-file-receiver`）逐一迁入 `src/plugins/builtin/`。
  3. 实现插件间事件联动（命令库一键发送命令至终端、编辑器选中文本一键打开工具插件），删除旧 `ToolsPanel` 目录。
- **验收**：中央工作区支持 Data / Console / Plugin 混合 Tab，右侧 Dock 支持 AI 与插件停靠切换。

---

### Milestone 4：DataGrid 抽象、SQL LSP、执行安全与企业级能力

**目标**：达到主流成熟数据库客户端的 SQL 编写体验与数据安全闭环。

#### Task 4.1：DataGrid 数据源无关化抽象（`GridAdapter`）
- **范围**：`src/components/data-grid/`（原 `DataGrid/`，移除冗余 `DataGrid.tsx` 转发壳，修正 `tests/dategrid` 为 `tests/datagrid`）
- **具体动作**：
  1. 定义 `GridAdapter` 接口，剥离 `cellEditHandler.ts` 对 `mysqlValueSemantics.ts` 的反向依赖，剥离 `DataGrid/index.tsx` 中硬编码的 `mysqlPrimaryKeyField` 与 `salesforceTimezone`。
  2. 将空值占位符、主键解析、草稿值编解码、自定义字段编辑器与右键菜单扩展全部收敛至各 `DataSourceDriver.gridAdapter`。

#### Task 4.2：两阶段编译提交 + SQL 安全网关 + 强制执行审计
- **范围**：`src-tauri/src/services/query_service.rs`、`src-tauri/src/drivers/`、`src/features/query-workspace/`
- **具体动作**：
  1. 实现表格变更 **`prepare_mutation_plan` -> 预览确认 -> `commit_mutation_plan(planId, planHash)`** 两阶段协议，保证预览 SQL 与实际落库 SQL 100% 一致，支持乐观锁防并发脏写。
  2. 落地后端 AST 级 **`SqlGuard`**：强制只读数据源锁；`DROP` / `TRUNCATE` / `ALTER` / 无 `WHERE` 的 `UPDATE`/`DELETE` / 生产环境写操作触发二次确认；查询结果返回实际下发的 `executedSql`。
  3. 落地 **`sql_execution_audit`** 审计链路（不可静默吞错），记录 `raw_sql`、`executed_sql`、`plan_hash`、`risk_level`、`duration_ms`、`rows_affected`。

#### Task 4.3：SQL LSP 语言服务与查询窗口增强
- **范围**：`src-tauri/src/modules/sql_lsp/`（基于 `sqlparser`）、`src/components/monaco/`、`src/features/query-workspace/`
- **具体动作**：
  1. 接入基于 AST + 本地元数据快照的 SQL 语言服务：支持表别名推导（`u.`）、多表 `JOIN`、CTE 上下文补全、实时语法/字段诊断、Hover 表/列元数据提示与一键 SQL 格式化。
  2. 查询窗口补齐：多语句分号拆分与多结果集 Tab、慢查询中断（`KILL QUERY`）、`EXPLAIN` 执行计划、查询历史记录、流式 CSV/JSON/SQL 导出、手动事务会话（`BEGIN`/`COMMIT`/`ROLLBACK`）与 SSH 隧道/SSL 连接支持。
- **验收**：前后端全量构建与单测通过，形成完整、安全、可扩展的现代数据库客户端。
