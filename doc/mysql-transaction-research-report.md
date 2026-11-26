# DBX（DBeaver）事务机制调研与 MySQL 事务支持设计报告

> **调研范围**：DBeaver（DBX）事务模型、本仓库现有 MySQL 执行与连接配置架构（`src-tauri/src/drivers/`、`src/drivers/mysql/`、`src/features/source-manager/`、`src/features/main/QueryPanel/`）。

---

## 一、DBX（DBeaver）事务体系调研

DBeaver 将事务控制分为**连接级默认策略**与**编辑器/会话级运行时控制**两层，核心提供三种事务模式：

| 事务模式 | 英文标识 | 核心行为 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **自动提交** | `Auto-commit` | 每条 SQL（`INSERT` / `UPDATE` / `DELETE` / DDL）执行后立即自动提交，无法 `ROLLBACK` | 日常查询、只读排查、快速测试脚本 |
| **手动提交** | `Manual commit` | 连接会话保持 `autocommit = 0`（或显式开启事务），所有变更处于挂起态，直到用户显式点击 **Commit** 或 **Rollback** | 生产环境变更、多步关联更新、需人工二次确认的脚本 |
| **智能提交** | `Smart commit` | 混合模式：执行 `SELECT` 等只读语句时不开启/不持有长事务（避免锁表与阻塞）；一旦检测到写操作（DML），自动切换为手动提交态并挂起事务，等待 Commit / Rollback | 既常做查询又偶发修改数据，兼顾性能与防误操作 |

### DBX 的关键交互细节
1. **连接配置与环境联动**：
   - 在新建/编辑连接时可指定默认事务模式（Auto / Manual / Smart），也可按连接类型（Development / Test / Production）预设默认策略（例如 Production 默认 Manual commit）。
2. **工具栏/状态栏实时控制**：
   - 显示当前事务模式指示器（绿色 `Auto` / 橙红色 `Manual` / 蓝色 `Smart`）及当前挂起事务状态。
   - 提供快捷按钮：**Commit**、**Rollback**、**Transaction Log（未提交 SQL 列表）**，并在有未提交变更时高亮按钮与计数徽标。
3. **会话隔离与未提交保护**：
   - 每个 SQL 编辑器 Tab 绑定独立的物理数据库连接（Session），保证 `BEGIN` / `SET autocommit = 0` / `COMMIT` / `ROLLBACK` 在同一会话内连续生效。
   - 关闭 Tab、切换连接或退出应用时，若存在未提交事务，弹窗提示用户选择 **提交 / 回滚 / 取消关闭**，避免连接归还连接池时残留脏事务或长锁。

---

## 二、本仓库现状与能力缺口分析

结合当前代码实现，项目在 MySQL 事务方面处于**“表格批量保存有内部短事务，控制台交互无会话级事务”**的状态：

### 1. 已有基础
- **表格编辑（DataGrid）原子提交**：[provider.rs](file:///d:/test-workspace/simple-salesforce-tool/src-tauri/src/drivers/mysql/provider.rs#L657-L774) 中的 `save_records_with_deletes` 已使用 `pool.begin() ... transaction.commit()`，能保证单次表格保存的增删改具备原子性。
- **连接池与驱逐机制**：[connection_manager.rs](file:///d:/test-workspace/simple-salesforce-tool/src-tauri/src/drivers/connection_manager.rs) 已按 `source_id` + `config_hash` 统一托管 `MySqlPool`，配置更新或删除时会自动 `evict`。
- **Schema 驱动连接表单**：[types.ts](file:///d:/test-workspace/simple-salesforce-tool/src/drivers/types.ts#L98-L119) 的 `DriverConnectionField` 已支持 `"select"` 类型与 `advanced` 高级折叠分组，[SourceConnectionModal.tsx](file:///d:/test-workspace/simple-salesforce-tool/src/features/source-manager/SourceConnectionModal.tsx) 可直接渲染下拉选项而无需硬编码分支。

### 2. 核心缺口
1. **连接配置缺少事务选项**：[mysql/index.ts](file:///d:/test-workspace/simple-salesforce-tool/src/drivers/mysql/index.ts#L89-L186) 的 `connectionSchema.fields` 目前仅包含 `host`、`port`、`database`、`username`、`password`、`primaryKey`，新建与编辑连接页面无法配置默认事务模式（自动 / 手动 / 智能）。
2. **后端缺少会话级连接绑定（Session Pinning）**：当前 SQL 控制台每次执行都会从 `MySqlPool` 临时借用连接并立即释放。若用户执行 `BEGIN;` 或 `SET autocommit = 0;`，下一条 SQL 可能落到不同连接上，无法实现跨语句手动提交或回滚。
3. **控制台工具栏缺少事务控制 UI**：[ConsoleToolbar.tsx](file:///d:/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/components/ConsoleToolbar.tsx) 仅包含执行、停止、Explain、格式化、换行、清空与数据源切换，缺少事务模式切换、Commit / Rollback 按钮、未提交计数与日志视图。
4. **缺少未提交事务关闭保护**：关闭控制台 Tab、切换控制台绑定数据源或更新连接配置时，尚无“存在未提交事务”的检测与提示拦截。

---

## 三、架构与功能设计方案（遵守多数据源抽象约束）

> 严格遵守 `AGENTS.md` 约束：所有能力通过 `DataSourceDriver` / `ProviderCapabilities` 声明，禁止在通用组件或 `commands/` 中硬编码 `sourceType === "mysql"`。

### 1. 连接配置层：新建与编辑连接支持事务选项
- **驱动 Schema 扩展**：在 [mysql/index.ts](file:///d:/test-workspace/simple-salesforce-tool/src/drivers/mysql/index.ts) 的 `connectionSchema.fields`（`group: "advanced"`，或按需要放在主连接区下方）新增 `transactionMode` 字段：
  - `type: "select"`
  - `defaultValue: "auto"`
  - `options`:
    - `{ label: "自动提交 (Auto-commit)", value: "auto" }`
    - `{ label: "手动提交 (Manual commit)", value: "manual" }`
    - `{ label: "智能提交 (Smart commit)", value: "smart" }`
- **配置持久化与回填**：
  - `extractFormValues` 从 `source.configJson.transactionMode` 读取并回填（兼容历史连接默认 `"auto"`）。
  - `buildPayload` 将 `transactionMode` 写入 `configJson`。
  - 后端 `MySqlSourceConfig` 解析 `transaction_mode` 字段（默认 `Auto`），作为该数据源新建控制台 Tab 时的初始事务模式。

### 2. 后端驱动与会话管理层
1. **能力声明扩展**：
   - 在 `ProviderCapabilities`（后端 `drivers/mod.rs` 与前端 `src/drivers/types.ts`）新增 `supports_interactive_transaction: bool` / `supportsInteractiveTransaction: boolean`（MySQL 为 `true`，Salesforce 为 `false`）。
2. **会话级连接托管（`ConnectionManager`）**：
   - 在 `ConnectionManager` 中新增 `console_sessions: Mutex<HashMap<String, ConsoleTxSession>>`（key 为 `console_tab_id` 或 `session_id`）：
     ```text
     ConsoleTxSession {
       source_id: String,
       mode: TransactionMode,        // Auto | Manual | Smart
       conn: Option<PoolConnection<MySql>>, // 处于未提交/手动事务时独占锁定的物理连接
       in_transaction: bool,         // 当前是否存在未提交事务
       uncommitted_sqls: Vec<String>,// 未提交语句摘要（供 Transaction Log 展示）
       last_active_at: Instant,
     }
     ```
   - **执行流转规则**：
     - **Auto 模式**：直接从 `pool` 执行，不长期占用连接；若用户手动输入 `BEGIN`/`START TRANSACTION`，可提示或切入会话事务态。
     - **Manual 模式**：若 `conn` 为空则从 `pool.acquire()` 绑定连接并执行 `SET autocommit = 0`（或 `START TRANSACTION`），后续所有 SQL 均在该 `conn` 上执行，直到调用 `commit` / `rollback`。
     - **Smart 模式**：只读语句（`SELECT` / `SHOW` / `EXPLAIN` / `DESCRIBE`，经 `sqlparser` AST 判定）走普通池执行，不占连接、不锁表；一旦检测到写语句（`INSERT` / `UPDATE` / `DELETE` / 显式事务语句），自动绑定 `conn` 并开启事务，进入挂起态。
     - **DDL 注意事项**：MySQL 中执行 DDL（`CREATE` / `ALTER` / `DROP` / `TRUNCATE`）会触发**隐式提交**，后端应在执行前提示或执行后同步更新 `in_transaction` 状态。
3. **新增统一 Tauri 命令（通过 `DriverRegistry` 分发）**：
   - `get_console_transaction_status(session_id)`
   - `set_console_transaction_mode(session_id, source_id, mode)`（若当前有未提交事务，禁止直接切回 Auto，需先 Commit 或 Rollback）
   - `commit_console_transaction(session_id, source_id)`
   - `rollback_console_transaction(session_id, source_id)`
   - `close_console_session(session_id)`（Tab 关闭或切换数据源时自动回滚并释放连接）

### 3. 前端控制台 UI 与交互设计
- **工具栏扩展（[ConsoleToolbar.tsx](file:///d:/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/components/ConsoleToolbar.tsx)）**：
  - 当 `driver.capabilities.supportsInteractiveTransaction` 为 `true` 时，展示：
    1. **事务模式切换器**：`自动 (Auto)` / `手动 (Manual)` / `智能 (Smart)`（带状态色点：绿 / 橙 / 蓝）。
    2. **Commit（提交）** 与 **Rollback（回滚）** 按钮：仅在 `inTransaction === true` 时可点击，并附带未提交语句数徽标。
    3. **事务日志弹层**：点击徽标可查看当前挂起事务已执行的语句列表。
- **状态同步与关闭拦截**：
  - 每次执行控制台 SQL 后刷新当前 `consoleTabId` 的事务状态。
  - 关闭控制台 Tab、切换控制台数据源或关闭窗口前，若 `inTransaction === true`，弹出确认框引导用户先提交或回滚。
- **与 `SqlGuard` 安全网关协同**：
  - 保留现有 `SqlGuard` 拦截与生产环境二次确认逻辑；只读连接（`readOnly: true`）仍硬拦截写操作。
  - 所有 `BEGIN` / `COMMIT` / `ROLLBACK` 及事务内 SQL 均完整写入 `sql_execution_audit` 审计表。

---

## 四、分阶段实施建议与风险控制

### 实施阶段
1. **Phase 1（连接配置与能力契约）**：在 `ProviderCapabilities` 增加事务能力标识；在 `mysqlDriver.connectionSchema` 增加 `transactionMode` 下拉配置；后端 `MySqlSourceConfig` 支持读取并校验默认值。
2. **Phase 2（会话事务引擎）**：扩展 `ConnectionManager` 托管会话级 `PoolConnection<MySql>`，实现 Auto / Manual / Smart 状态机、`commit` / `rollback` 命令及 `evict` / `close_all` 自动回滚清理。
3. **Phase 3（控制台 UI 与拦截保护）**：改造 `ConsoleToolbar` 与 `ConsoleTabPane`，接入事务状态展示、Commit/Rollback 按钮、未提交日志与 Tab 关闭二次确认。

### 关键风险与规避
- **连接池耗尽与长事务锁表**：为 `MySqlPool` 预留足够连接上限（如 `max_connections >= 10`），对闲置未提交会话设置超时告警，并在 `ConnectionManager::evict` / 应用退出时强制 `ROLLBACK` 并归还连接。
- **网络闪断导致物理连接失效**：若绑定连接执行报错断开，自动清理会话事务标记并提示用户“连接已重置，未提交事务已回滚”。
- **与 DataGrid 表格编辑的边界**：DataGrid 的 `prepare_mutation_plan -> commit_mutation_plan` 仍保持独立原子短事务，不与 SQL 控制台的手动事务混用同一物理连接，避免表格保存意外提交控制台未确认的脚本。
