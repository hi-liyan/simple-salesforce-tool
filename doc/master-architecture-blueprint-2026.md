# 数据库客户端全栈架构重塑总纲（DataGrid 抽象、SQL LSP、执行安全与审计）

> **文档定位**：本报告结合前两份专项报告（[架构分析与数据源扩展优化报告](file:///d:/test-workspace/simple-salesforce-tool/doc/architecture-and-datasource-optimization-report.md)、[前端 UI 重塑、状态与插件化架构及后端 SQLite 优化报告](file:///d:/test-workspace/simple-salesforce-tool/doc/frontend-ui-state-and-sqlite-optimization-report.md)），对**前端数据表格（DataGrid）抽象、主流数据库查询窗口与 SQL LSP 集成、SQL 安全防护与执行一致性闭环**进行最终深度审查，并补充成熟数据库客户端（DataGrip / DBeaver / Chat2DB）必备的工程能力，形成“脱胎换骨”式重构的完整技术总纲。

---

## 一、前两份报告回顾与本次重点补全

前两份报告已系统解决了以下四大基础架构问题：
1. **多数据源扩展性**：后端 `DataSourceDriver` Trait + `ProviderCapabilities` + `DriverRegistry` + `ConnectionManager`；前端 `src/drivers/` 注册表模式。
2. **UI 视觉与插件化**：Islands 大圆角浮岛风格、无边框自绘标题栏（`decorations: false`）、标准化 Layout 体系（`AppShellLayout` / `SubWindowLayout` / `SplitPaneLayout`）、`src/plugins/` 插件系统（命令库、终端与 6 大工具全部插件化）。
3. **无阻塞启动与状态分层**：移除全屏启动遮罩，按“外壳配置 / Tab 草稿 / 重型结果懒加载 / 插件存储 / 瞬态内存”5 级拆分状态与持久化。
4. **SQLite 规范化**：版本化增量迁移（`MigrationRunner`）替换归档删库、WAL 读写分离、外键/索引补全与密钥加密升级。

**本次重点审查并补全以下 4 个核心盲区**：
1. **前端 DataGrid 表格的数据源抽象缺失**
2. **查询窗口交互与 SQL LSP（语言服务）的成熟度差距**
3. **数据安全性、SQL 执行审计与前后端 SQL 执行一致性（消除“黑盒”）**
4. **数据库客户端核心工程能力补全（查询取消、SSH 隧道、多格式导出、事务会话）**

---

## 二、前端 DataGrid 表格抽象设计

### 2.1 现状诊断（为什么当前表格难以扩展新数据源）
审查 `src/components/DataGrid/` 发现，表格组件虽然做了内部子目录拆分，但**仍深度耦合 Salesforce 与 MySQL 的特定实现**：
1. **反向依赖业务层**：`DataGrid/logic/cellEditHandler.ts`（L13-17）直接导入了 `src/features/main/QueryPanel/logic/mysqlValueSemantics.ts`（`createMysqlDraftNullValue` 等），导致通用基础表格组件依赖特定数据源的草稿编码。
2. **硬编码主键与源类型分支**：`DataGrid/index.tsx`（L115-120）直接判断 `(selectedSourceType || "salesforce").toLowerCase() !== "mysql"` 并硬编码扫描 `columnKey === "PRI"`；`DataGridProps` 直接暴露 `salesforceTimezone`、`selectedSourceType` 等特定参数。
3. **空值与类型策略封闭**：`DataGrid/utils/value.ts`（L56）写死 MySQL 显示 `"Null"`、Salesforce 显示 `"None"`；`fieldTypeStrategy.ts` 仅支持 `picklist / date / datetime / number / boolean / text` 六种策略及 `BIGINT UNSIGNED` 特判，未来接入 PostgreSQL（`jsonb`、`uuid`、`array`、`inet`）、MongoDB（嵌套文档）或 ClickHouse 时无法扩展自定义单元格渲染器与编辑器。

### 2.2 `GridDataSourceAdapter` 抽象方案

将 `DataGrid` 彻底改造为**数据源无关的纯渲染与编辑引擎**，所有数据源差异通过 `DataSourceDriver` 注入的 `GridAdapter` 适配：

```typescript
export interface GridAdapter {
  /** 空值占位文本（如 "Null" / "None" / "-"） */
  nullPlaceholder: string;
  /** 从元数据与记录中解析唯一行定位键（支持单主键、复合主键、ROWID） */
  resolveRecordKey: (record: Record<string, unknown>, describe?: ObjectDescribe) => string;
  /** 单元格值编解码：统一封装 omit / default / null / value 语义，消除外部耦合 */
  codec: {
    encodeNull: () => GridDraftValue;
    encodeDefault: () => GridDraftValue;
    encodeOmit: () => GridDraftValue;
    encodeValue: (val: unknown) => GridDraftValue;
    toDisplayText: (val: unknown, fieldMeta: ObjectField) => string;
  };
  /** 字段策略解析与自定义编辑器/渲染器扩展点 */
  resolveFieldStrategy: (fieldMeta: ObjectField) => GridFieldStrategy;
  /** 右键菜单扩展项（如 Salesforce 注入“打开网页端记录”、SQL 源注入“复制为 INSERT/UPDATE”） */
  getContextMenuItems?: (ctx: GridContextMenuContext) => ContextMenuEntry[];
}
```

**收益**：
- `DataGrid` 组件不再接收 `selectedSourceType` 或 `salesforceTimezone`，也不再 import 任何 `mysql*` 文件。
- 未来接入 PostgreSQL、SQLite、Oracle 等数据源时，只需在对应 Driver 中实现 `GridAdapter`（例如为 PG 的 `jsonb` 注册 JSON 弹窗编辑器、为 `array` 注册标签渲染器），表格能力立即无缝复用。

---

## 三、主流查询窗口重构与 SQL LSP 集成方案

### 3.1 查询窗口（Query Console）与主流产品的差距
当前 `SoqlExecutorWorkspace.tsx`（1422 行）已具备基本的编辑器、执行与结果查看能力，但对标 DataGrip / DBeaver / Chat2DB 还缺少以下主流特性：
1. **多语句执行与独立结果 Tab**：主流客户端支持在同一个编辑器写入多条 SQL（以 `;` 分隔），运行后在底部生成`执行摘要`（每条语句的耗时、影响行数、状态）+ 多个独立的结果集 Tab（`结果 1`、`结果 2`），以及只执行光标所在当前语句（`Ctrl/Cmd + Enter`）。
2. **查询取消（Cancel / Abort）**：长耗时慢查询执行期间，工具栏“运行”按钮应变为“停止”，支持立即中断请求（后端调用数据库 `KILL QUERY <id>` / `pg_cancel_backend` 或中止 HTTP 请求）。
3. **执行计划（Explain）**：SQL 工具栏支持一键 `EXPLAIN` / `EXPLAIN ANALYZE`，在底部结果区展示执行计划树或表格。
4. **执行历史（Query History）**：自动记录每次成功/失败的查询语句、数据源、耗时与时间，支持检索与一键回填。

### 3.2 产品级 SQL 语言服务（LSP）集成架构

当前 `src/components/monaco/languages/mysqlLanguage.ts` 仅依赖**正则启发式匹配**（如 `\bfrom\s+`），无法处理表别名（`SELECT u. FROM users u`）、多表 `JOIN`、CTE（`WITH ... AS`）、子查询作用域，也没有实时语法诊断与悬浮文档。

**推荐方案：Tauri 2 混合嵌入式 SQL 语言服务（Backend Rust AST + Worker）**

利用项目已有的 Rust 后端与本地 SQLite 元数据缓存（`MetadataService`），无需外挂重型进程，即可实现媲美专业 IDE 的 SQL 编写体验：

| 能力维度 | 实现机制 | 效果对标 |
| :--- | :--- | :--- |
| **1. AST 级上下文补全** | 后端引入 `sqlparser`（Rust 多方言 SQL AST 解析器，支持 MySQL/PG/SQLite/Generic）或前端 WebWorker 运行 `dt-sql-parser`（ANTLR4 语法树），结合光标位置精确识别作用域内的**表名、别名（`u.` -> `users` 字段）、Schema.Table、函数与关键字**。 | 消除单表正则限制，支持多表 `JOIN`、CTE 与子查询补全。 |
| **2. 实时语法与语义诊断** | 基于解析器在输入防抖（200ms）后返回语法错误位置；同时对照本地缓存的 `source_objects` / `source_object_fields` 校验表名与字段名是否存在，通过 `monaco.editor.setModelMarkers` 渲染红/黄波浪线。 | 输入即报错提示，不用等到提交数据库才发现拼写错误。 |
| **3. Hover 悬浮元信息** | 注册 Monaco `HoverProvider`：鼠标悬停表名展示表注释、字段数；悬停字段名展示数据类型、是否可空、主外键标识、默认值与列注释。 | 无需反复打开右侧字段抽屉即可查看表结构。 |
| **4. 格式化与 Code Actions** | 集成标准 SQL Formatter（支持按方言缩进、关键字大小写规范）与快捷重构（如 `SELECT *` 光标处触发灯泡提示“展开为全部列名”）。 | 一键规范 SQL 风格。 |
| **5. 统一语言服务接口** | 遵循标准 LSP 能力模型（`completion`、`diagnostics`、`hover`、`formatting`、`codeAction`）封装 `SqlLanguageService` 桥接层，每种数据源只需配置方言（Dialect）与元数据适配器即可接入。 | 未来新增 PostgreSQL / ClickHouse 时直接复用整套编辑器智能能力。 |

---

## 四、数据安全性、SQL 执行审计与前后端执行一致性（消除黑盒）

这是数据库客户端**最核心的生命线**。当前存在两大隐患：
- **隐患 A（预览与执行二次拼装不一致）**：前端 `mysqlMutationPlanner.ts` 规划出 `creates/updates/deletes` 发给 `preview_save_records_with_deletes` 预览；用户确认后前端又把原始数据发给 `save_records_with_deletes` 让后端**重新拼装 SQL 执行**，存在预览与实际执行不一致的风险。
- **隐患 B（黑盒执行与高危裸奔）**：后端对查询 SQL 做的自动 `LIMIT` 改写对前端不可见；缺少只读环境锁与无 `WHERE` 更新/删表拦截；系统日志吞掉写入错误且记录的是“预估文本”而非数据库实际执行详情。

### 4.1 保障“所见即所执”的两阶段编译执行协议

针对表格编辑保存（Create / Update / Delete），废除“预览算一遍、执行再算一遍”的模式，改为 **Plan -> Preview -> Commit** 单一真相源协议：

1. **`prepare_mutation_plan`（后端编译并签发计划）**：
   - 前端将变更意图（`creates` / `updates` / `deletes`）发给后端。
   - 后端驱动一次性生成**确定性的参数化执行语句列表**（含 SQL 模板、严格类型化的绑定参数、以及供人类阅读的渲染 SQL），生成唯一 `planId` 与内容摘要 `planHash`（存入后端短时内存缓存，如 TTL 5 分钟）。
   - 返回 `planId`、`planHash` 与预览 SQL 列表给前端弹窗确认。
2. **`commit_mutation_plan(planId, planHash)`（原样执行已预览计划）**：
   - 用户点击“确认执行”时，前端**只传 `planId` 和 `planHash`**。
   - 后端校验哈希一致后，在事务内**直接执行刚才预览通过的那份编译语句**，确保用户看到的预览 SQL 与最终落库执行的 SQL **100% 字节级一致**。
   - **乐观锁防并发覆盖**：生成 `UPDATE`/`DELETE` 时可选附带旧值条件（`WHERE pk = ? AND updated_col = old_val`），若 `rows_affected == 0` 立即回滚并提示“数据已被其他会话修改”。

### 4.2 后端 SQL 安全网关（SQL Safety Guard）

所有从查询控制台发往数据库的 SQL，在驱动层执行前**必须**经过后端 AST 级安全网关（不信任前端校验）：

| 安全策略 | 触发条件（基于后端 AST 解析） | 拦截与交互行为 |
| :--- | :--- | :--- |
| **只读数据源强制锁** | 数据源配置标记 `readOnly: true` 时，检测到任何非只读语句（`INSERT`/`UPDATE`/`DELETE`/`DDL`/`GRANT` 等）。 | **硬拦截**，直接拒绝执行并返回错误提示。 |
| **高危语句二次确认** | 1. 任何 `DROP` / `TRUNCATE` / `ALTER` 语句；<br>2. 无 `WHERE` 子句（或永真条件如 `WHERE 1=1`）的 `UPDATE` / `DELETE`；<br>3. 生产环境（`environment === "prod"`）下的任意写操作。 | 返回 `ConfirmationRequired { riskLevel, summary, statements }`，前端弹出高亮警示框（展示影响表名与风险等级），用户二次确认并携带确认令牌后才执行。 |
| **查询结果透明化** | 后端对查询做自动分页（`LIMIT`/`OFFSET`）或超时包装时。 | `QueryResult` 必须返回 **`executedSql`（实际下发给数据库的完整 SQL）**、耗时 `durationMs` 与是否被截断 `truncated`，在前端状态栏/执行摘要中明文展示，彻底打破黑盒。 |

### 4.3 不可抵赖的 SQL 执行审计（Execution Audit）

升级现有的 `system_logs`，建立专门的 **`sql_execution_audit`** 表与审计流水线：
- **强制记录时机**：在驱动执行 `finally` 阶段（无论成功、失败、超时还是被安全网关拦截）强制写入审计记录，**不允许静默吞掉审计失败**（写库失败需至少输出结构化本地文件日志兜底）。
- **核心审计字段**：
  - `audit_id`、`source_id`、`source_name`、`environment`（prod/dev 等）
  - `operation_source`（`console` / `datagrid_commit` / `ai_tool`）
  - `raw_sql`（用户原始输入）、`executed_sql`（实际下发 SQL）
  - `statement_type`（SELECT/INSERT/UPDATE/DELETE/DDL）、`risk_level`
  - `rows_affected` / `rows_returned`、`duration_ms`、`success`、`error_message`
  - `plan_hash`（若来自 DataGrid 两阶段提交，关联同一份计划哈希，实现全链路可追溯）。
- **审计合规与脱敏**：支持在设置中配置“审计日志脱敏模式”（对 `INSERT`/`UPDATE` 中的敏感字面量参数可选掩码存储），并支持按时间/数据源筛选与 CSV/JSON 导出。

---

## 五、结合数据库客户端经验的其他关键能力补全

除了上述重点外，对标成熟桌面数据库客户端，还应在重构架构中预留或同步落地以下能力：

1. **连接安全与网络通道（SSH 隧道 & TLS/SSL）**：
   - 在 `ConnectionManager` 中抽象统一的传输层，支持为 MySQL/PostgreSQL 等数据源配置 **SSH 跳板机隧道**（密码/私钥认证，本地随机端口转发）与 **SSL/TLS CA 证书校验**。
2. **大结果集流式读取与内存保护（OOM Guard）**：
   - 后端查询设置单次最大行数与单页内存字节上限，超大字段（如 `BLOB` / 超长 `TEXT`）在列表查询时支持截断预览、点击单元格再按主键按需拉取完整值，防止 WebView 内存溢出卡死。
3. **专业数据导入 / 导出管道（Export Pipeline）**：
   - 支持将当前结果集或流式重查全量数据导出为 **CSV、JSON、SQL INSERT 语句、Markdown 表格**，并复用 `Plugin` 或后端流式写文件，避免前端拼装百万行字符串导致卡顿。
4. **控制台事务会话控制（Auto-Commit / Manual Transaction）**：
   - 允许用户在 SQL 控制台切换“自动提交”与“手动事务”模式；手动模式下为该控制台 Tab 绑定独立的数据库物理连接会话，支持 `BEGIN`、`COMMIT`、`ROLLBACK` 按钮，关闭 Tab 时自动回滚并释放连接。
5. **敏感凭证硬件级加密（Keyring + AEAD）**：
   - 替换当前 `secret_repo.rs` 的 `'plain-text/v1'`，通过系统凭证库（Windows Credential Manager / macOS Keychain / Linux Secret Service）托管主密钥，结合随机 `nonce` 对 `secret_items` 进行 AES-256-GCM 加密存储。

---

## 六、终极重构全景路线图（合并前两份报告）

| 阶段 | 核心里程碑 | 关键交付物 |
| :--- | :--- | :--- |
| **Milestone 1：地基重塑（P0）** | 后端驱动 Trait + SQLite 增量迁移 + 无边框窗口与无阻塞启动 | 1. `DataSourceDriver` Trait、`ProviderCapabilities`、`ConnectionManager`。<br>2. `MigrationRunner` + WAL 读写分离 + `sql_execution_audit` / `plugin_kv_store` 表。<br>3. `decorations: false` + `AppShellLayout` + 自绘标题栏 + 去除全屏启动遮罩。 |
| **Milestone 2：UI 浮岛与插件体系（P1）** | Islands 大圆角视觉 + `src/plugins/` 插件内核 + 状态分级持久化 | 1. 三栏大圆角浮岛工作区 + `SubWindowLayout`。<br>2. `src/plugins/core/` SDK 与 `builtin/`（命令库、终端、6 大工具全部插件化）。<br>3. 拆解 `workspaceSnapshot.ts`，落地 4 类状态分级与按 Tab 懒加载。 |
| **Milestone 3：专业数据库能力升级（P1）** | `GridAdapter` 抽象 + 两阶段提交 + SQL 安全网关 + SQL LSP | 1. `DataGrid` 彻底解耦，接入 `GridAdapter`。<br>2. 实现 `Plan -> Preview -> Commit` 一致性协议与 AST 安全网关（只读锁/高危拦截）。<br>3. 接入 SQL AST 补全、语法诊断与 Hover 元信息提示。 |
| **Milestone 4：企业级特性打磨（P2）** | 多语句/取消查询/导出/SSH/Keyring 加密 | 1. 查询中断（`KILL QUERY`）、多结果集 Tab、EXPLAIN 视图。<br>2. 流式 CSV/JSON/SQL 导出、SSH 隧道与凭证 AEAD 加密。<br>3. 全量前后端测试与多平台打包验证。 |
