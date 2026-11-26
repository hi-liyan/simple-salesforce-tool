# 表结构设计、多格式数据导出与数据库备份调研与集成方案报告

> 编制日期：2026-11-26  
> 调研对象：`d:\test-workspace\dbx`、DataGrip 主流交互范式、`d:\test-workspace\simple-salesforce-tool`  
> 架构约束：[AGENTS.md](file:///d:/test-workspace/simple-salesforce-tool/AGENTS.md)

---

## 一、主流产品与 `dbx` 实现调研对比

### 1. 新建表 / 编辑表结构（Table Designer）与 SQL 预览

| 维度 | `dbx` 实现方案 | DataGrip 实现范式 |
| --- | --- | --- |
| **入口与模式** | `TableStructureEditor.vue` 单一编辑器同时承载 **Create Mode**（`!tableName`）与 **Alter Mode**，分为 Columns / Indexes / Foreign Keys / Constraints / Triggers / 只读 DDL 页签。 | 对象树 `tables` 右键 `New -> Table`、表节点右键 `Modify Table`，弹窗内部分页签管理列、键、索引、外键与表选项。 |
| **SQL 预览机制** | 前端不直接拼接复杂 DDL，仅维护结构化草稿状态，**300ms 防抖**调用后端 `build_create_table_sql` / `build_table_structure_change_sql` 生成高保真方言 SQL 并在底部实时高亮预览。 | 底部内嵌只读 `SQL Preview` 面板，随表单修改实时刷新最终 `CREATE TABLE` / `ALTER TABLE` 脚本，保存前统一预览确认。 |
| **关键工程亮点** | 1. **能力矩阵裁剪**（`tableStructureCapabilities.ts`）：按方言声明是否支持重排列、改列类型、外键等。<br>2. **MySQL 最小化列重排**（`table_structure_sql/columns.rs`）：计算最长已排序子集，仅对移位列生成 `FIRST`/`AFTER`，并合并自增主键变更避免中间态报错。<br>3. **Fail-Closed 安全校验**：后端校验高危/不可逆变更，SQLite 重建采用 SHA-256 `schema_revision` 乐观锁。 | 强绑定 JDBC/ introspection 模型，支持增量 Diff 生成，但不同数据库驱动特性在 UI 中差异较大。 |

### 2. 多格式数据导出（Data Export）

| 维度 | `dbx` 实现方案 | DataGrip 实现范式 |
| --- | --- | --- |
| **支持格式** | **表/全量流式导出**：`CSV`、`XLSX`（支持附带 SQL Sheet）、`JSON`、`Markdown`、`SQL (INSERT)`、`TSV (TXT)`。 | 通过内置 Extractor 支持 `CSV`、`TSV`、`JSON`、`Markdown`、`HTML`、`SQL Inserts`、`SQL Updates` 等。 |
| **双路径导出** | 1. **本地内存快路径**（`useDataGridExport.ts`）：选中行或已完整加载的局部结果集直接在前端格式化导出/复制，免重跑慢查询。<br>2. **后端流式导出**（`table_export.rs` / `query_result_export.rs`）：原生驱动游标或 Keyset/Offset 10,000 行分批拉取，流式 `BufWriter` 落盘，突破内存与分页上限。 | 对结果集直接导出或通过 `Dump Data to File` 后台流式导出到磁盘，右下角显示后台任务进度条。 |
| **可靠性保障** | **Temp-File Staged Commit**（`tempfile::TempPath`）：先写临时文件，仅在全部成功且未取消时原子提交覆盖目标文件；取消或失败自动清理半成品，同时联动取消数据库在途查询。 | 支持任务取消，但在流式失败清理与本地缓存复用上不如 `dbx` 的暂存原子提交清晰。 |

### 3. 数据库备份与恢复（Database Backup / Dump）

| 维度 | `dbx` 实现方案 | DataGrip 实现范式 |
| --- | --- | --- |
| **实现路线** | **零外部工具依赖**：纯 Rust 实现多方言逻辑 SQL Dump（`database_export.rs`）+ SQLite 原生 Online Backup API（`sqlite_backup.rs`），无需本机安装 `mysqldump` / `pg_dump`。 | 依赖本机安装外部 `mysqldump` / `pg_dump` CLI，或使用内置 `SQL Inserts` 导出脚本（仅数据）。 |
| **备份核心能力** | - 选项：仅结构 / 仅数据 / 结构+数据、`CREATE DATABASE`、`DROP TABLE IF EXISTS`、剥离 `AUTO_INCREMENT=N`、视图/存储过程等对象。<br>- **一致性快照**：`begin_database_backup_snapshot` 在专用连接上开启一致快照事务。<br>- **拓扑排序**：导出前按表外键与视图依赖排序，确保 `.sql` 可顺畅导入恢复。<br>- **流式进度**：`database-export-progress` 事件实时推送当前表名、进度与已导出行数。 | 外部 CLI 能力强，但跨平台（尤其 Windows 用户未配 PATH）部署成本高、报错不直观。 |

---

## 二、当前项目（`simple-salesforce-tool`）现状与缺口

| 模块 | 当前代码现状 | 核心缺口 |
| --- | --- | --- |
| **表结构设计** | - 已有只读 DDL 读取（`MySqlProvider::get_object_ddl`）与字段元数据读取（`describe_object`）。<br>- 左树已展示 `columns` / `keys` / `indexes` 目录（[sourceTreeProviders.ts](file:///d:/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/logic/sourceTreeProviders.ts)）。 | - 缺少图形化**新建表 / 编辑表结构**界面及实时 **SQL 预览**。<br>- 缺少后端 `CREATE TABLE` / `ALTER TABLE` 差异生成服务。 |
| **数据导出** | - [DataGridSurface.tsx](file:///d:/test-workspace/simple-salesforce-tool/src/components/DataGrid/components/DataGridSurface.tsx) 仅支持选区复制 TSV。<br>- [SqlAuditTab.tsx](file:///d:/test-workspace/simple-salesforce-tool/src/features/logs/SqlAuditTab.tsx) 仅支持导出审计 JSON。<br>- [mysql/provider.rs](file:///d:/test-workspace/simple-salesforce-tool/src-tauri/src/drivers/mysql/provider.rs) 已有 `build_insert_preview_sql` / `format_mysql_value_literal`，但仅用于两阶段提交预览，未对外提供数据导出。 | - 缺少 **CSV / TSV / JSON / Markdown / SQL INSERT / XLSX** 多格式导出弹窗与复制动作。<br>- 缺少突破前端 `PAGE_SIZE_MAX = 2000` 与大字段 `4096` 字符截断的**后端全量流式导出**。 |
| **数据库备份** | - 无任何数据库/单表逻辑备份与 `.sql` 转储恢复能力。 | - 缺少按数据源/表粒度的一键 `.sql` 备份、进度推送、取消与一致性快照机制。 |
| **基础插件依赖** | - `Cargo.toml` 与 `package.json` 尚未引入文件保存对话框（`tauri-plugin-dialog`）与 XLSX 写入库（如 `rust_xlsxwriter`）。 | - 后端落盘流式导出/备份需配合文件保存路径选择（或默认导出目录 + 对话框）。 |

---

## 三、架构集成方案（严格遵循 `AGENTS.md` 约束）

### 3.1 必须守住的架构红线
1. **禁止硬编码数据源分支**：所有能力显隐必须通过后端 `ProviderCapabilities`（[drivers/mod.rs](file:///d:/test-workspace/simple-salesforce-tool/src-tauri/src/drivers/mod.rs)）与前端 `FrontendDriverCapabilities`（[drivers/types.ts](file:///d:/test-workspace/simple-salesforce-tool/src/drivers/types.ts)）声明，禁止在 `DataGrid`、`QueryPanel`、`sourceTreeContextMenu.ts` 中写 `sourceType === "mysql"`。
2. **安全网关与强制审计**：表结构创建/修改生成的 SQL 必须经由 `QueryService::execute_guarded_query`（[query_service.rs](file:///d:/test-workspace/simple-salesforce-tool/src-tauri/src/services/query_service.rs)）触发 `SqlGuard`（如 `ALTER` / `DROP` / `prod` 环境二次确认）并强制写入 `sql_execution_audit`。
3. **大字段完整性与异步非阻塞**：全量导出与数据库备份**禁止复用带 4096 字符截断的查询路径**，必须使用独立未截断读取路径并配合 `tokio::io::BufWriter` 流式写盘，所有命令声明为 `pub async fn`。
4. **单文件体量控制**：前端按模块化拆分（每个文件 `< 400` 行），禁止出现类似 `dbx` 单文件数千行的巨型组件。

### 3.2 模块 A：新建表 / 编辑表结构 + SQL 预览

- **能力声明**：在 `ProviderCapabilities` 与 `FrontendDriverCapabilities` 新增 `supports_table_designer` / `supportsTableDesigner`（MySQL 设为 `true`，Salesforce 设为 `false`）。
- **入口挂载**：在 [sourceTreeContextMenu.ts](file:///d:/test-workspace/simple-salesforce-tool/src/features/main/QueryPanel/logic/sourceTreeContextMenu.ts) 中：
  - `group`（`tables`）节点新增 **「新建表」**；
  - `object`（表）节点新增 **「编辑表结构」**。
- **后端设计（`src-tauri/src/drivers/mysql/table_ddl.rs` + `DataSourceDriver`）**：
  - 定义通用结构化表模型 `TableStructureSpec` / `TableColumnSpec` / `TableIndexSpec` / `TableForeignKeySpec`；
  - 实现 `preview_create_table_sql` 与 `preview_alter_table_sql`（含列增删改、重命名、注释、`PRIMARY KEY`、索引增删、外键增删、最小化 `FIRST/AFTER` 排序）；
  - 执行保存时**直接复用 `QueryService::execute_guarded_query`**（支持批量语句预览确认与审计落盘）。
- **前端拆分（`src/features/table-designer/`）**：
  - `TableDesignerModal.tsx`（Islands 浮岛主容器 + 保存确认）
  - `ColumnsEditorTab.tsx`（列定义表格 + 类型/长度/可空/自增/默认值/注释）
  - `IndexesEditorTab.tsx`（索引与唯一键编辑）
  - `ForeignKeysEditorTab.tsx`（外键与级联规则）
  - `SqlPreviewPanel.tsx`（300ms 防抖调用后端预览接口 + CodeMirror 只读 SQL 高亮）

### 3.3 模块 B：多格式数据导出（CSV / TSV / JSON / Markdown / SQL INSERT / XLSX）

- **入口挂载**：
  - **DataGrid 工具栏与行右键菜单**（[DataGrid](file:///d:/test-workspace/simple-salesforce-tool/src/components/DataGrid/index.tsx)）：新增「导出数据」菜单（支持「复制为 INSERT / CSV / JSON / Markdown」与「导出到文件...」）。
  - **左树表节点右键菜单**：新增「导出表数据...」。
- **双路径导出引擎**：
  1. **当前页 / 选中行快速导出（前端纯格式化器 `src/features/data-export/formatters.ts`）**：
     - 统一消费 `gridAdapter` 处理空值文本与时间格式，支持 **SQL INSERT**、**CSV**（含 BOM 可选以兼容 Excel 中文）、**TSV**、**JSON**、**Markdown 表格**。
  2. **全表 / 全量查询结果流式导出（后端 `src-tauri/src/services/export_service.rs`）**：
     - 借助 `ConnectionManager` 分页拉取完整数据（绕过 4096 字符截断）；
     - 写入 `tempfile` 暂存文件并在完成后原子重命名落盘（借鉴 `dbx` Temp-File Staged Commit）；
     - 通过 Tauri Event `"data-export-progress"` 推送已导出行数，支持前端一键取消。

### 3.4 模块 C：数据库备份（纯 Rust 逻辑 SQL Dump）

- **能力声明**：`supports_backup` / `supportsBackup`。
- **入口挂载**：
  - 左树 `source` 节点右键菜单：**「备份数据库 (.sql)...」**
  - 左树 `object`（表）节点右键菜单：**「备份表 (.sql)...」**
- **后端核心实现（`src-tauri/src/services/backup_service.rs` + `DataSourceDriver`）**：
  - **零外部 `mysqldump` 依赖**：直接基于 `ConnectionManager` 连接池实现：
    1. 在事务内开启一致性快照（MySQL: `SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ; START TRANSACTION WITH CONSISTENT SNAPSHOT;`）；
    2. 写入文件头注释、`SET NAMES utf8mb4;`、`SET FOREIGN_KEY_CHECKS = 0;`；
    3. 按依赖顺序遍历选中表，依次写出 `DROP TABLE IF EXISTS`（可选）、`SHOW CREATE TABLE`（可选剥离 `AUTO_INCREMENT=N`）与分页批量 `INSERT INTO ... VALUES (...), (...);`（处理 `NULL`、单引号转义、二进制 `0x...` 十六进制字面量）；
    4. 尾部恢复 `SET FOREIGN_KEY_CHECKS = 1;` 与视图 DDL（可选）；
    5. 通过 `"database-backup-progress"` 事件流式推送进度与取消控制，并在结束后写入系统日志/审计。

---

## 四、分阶段实施路线图

| 阶段 | 交付范围 | 核心验证标准 |
| --- | --- | --- |
| **Phase 1：基础设施与多格式快捷导出** | - 引入 `tauri-plugin-dialog`（文件保存框）与 `rust_xlsxwriter`。<br>- 实现前端 `CSV / TSV / JSON / Markdown / SQL INSERT` 格式化器，补齐 DataGrid 复制为 INSERT/CSV/JSON 与当前页导出。 | 选中行与当前页可一键导出 5 种文本格式；中文 CSV 在 Excel 打开无乱码。 |
| **Phase 2：新建表 / 编辑表 + 实时 SQL 预览** | - 扩展前后端驱动能力矩阵 `supportsTableDesigner`。<br>- 实现 `MySqlProvider` 表结构模型与 `CREATE`/`ALTER` SQL 预览生成。<br>- 完成 `src/features/table-designer/` 弹窗并接入 `QueryService` 安全确认与审计。 | 新建表、增删改列/索引/外键均可在保存前实时预览准确 SQL，生产环境修改触发二次确认。 |
| **Phase 3：后端流式全量导出与数据库备份** | - 实现后端 `export_service.rs`（支持全表/查询结果流式导出 CSV/JSON/SQL/XLSX）与 `backup_service.rs`（纯 Rust 逻辑备份 `.sql`）。<br>- 对接左树右键菜单、进度条弹窗与取消令牌。 | 10 万行表导出不卡死、不截断 >4096 字符大字段；取消导出后无残余损坏文件；备份 `.sql` 可完整导入恢复。 |
