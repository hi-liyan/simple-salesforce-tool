# 架构分析与数据源扩展优化报告

> **分析范围**：`src-tauri/src/`（Rust / Tauri 2 后端）与 `src/`（React / TypeScript 前端）全量代码结构。  
> **报告目标**：针对当前仅支持 Salesforce 与 MySQL 的现状，诊断数据源抽象缺失与工程目录规范问题，提出面向多数据源扩展的架构演进方案与标准目录规范。

---

## 一、执行摘要（Executive Summary）

本项目已具备较完整的数据库客户端核心功能（多源对象树、SQL/SOQL 控制台、SmartInput、DataGrid 虚拟滚动与行内编辑、事务提交预览、系统日志、本地 SQLite v2 持久化与 Secret 隔离、内置终端、AI 助手与工具箱），但在**架构可扩展性**与**工程目录规范**上存在明显历史包袱：

1. **后端缺乏 Trait 级数据源抽象**：`DataProvider` 当前是一个硬编码包含 `Salesforce` 与 `MySql` 两个变体的 `enum`，每次新增数据源都需要修改核心枚举及所有 `match` 分支；业务校验、日志结构、运行时 Secret 注入散落在 `commands.rs` 与 `source_service.rs` 的 `if/else` 中。
2. **领域模型“Salesforce 中心化”**：核心结构体仍命名为 `SalesforceSource`、`SalesforceObject`，顶层强绑定 `instance_url`、`access_token`、`api_version`，默认类型硬编码为 `"salesforce"`。
3. **前端缺少 Driver 注册表模式**：除 Monaco 语言模块（`LANGUAGE_MODULE_MAP`）外，表单、树结构、DataGrid 空值占位符、右键菜单、变更规划器、Secret 水合等 10+ 处均通过 `sourceType === "mysql"` 硬编码分支。
4. **前后端目录存在“平铺混杂”与“巨型文件”**：后端 `commands.rs` 达 3293 行、`mysql_provider.rs` 达 1999 行；前端 `DataQueryTabPane.tsx`（1860 行）、`TerminalPanel/index.tsx`（1709 行）、`SettingsPanel/index.tsx`（1565 行）等单文件过重，通用组件与业务组件混放。

---

## 二、现状深度诊断

### 2.1 后端架构与数据源抽象问题

#### 1. `DataProvider` 为封闭枚举而非开放 Trait
在 `src-tauri/src/providers/mod.rs` 中：
- `DataProvider<'a>` 定义为 `enum { Salesforce(SalesforceProvider<'a>), MySql(MySqlProvider) }`。
- `provider_for_source` 通过 `if source.is_salesforce()` 和 `if source.source_type.eq_ignore_ascii_case("mysql")` 硬编码构造。
- 每个操作（`test_connection`、`list_objects`、`describe_object`、`query_records`、`create_record`、`save_records`、`save_records_with_deletes`、`update_record`、`delete_record`、`get_object_ddl` 等）都在 `impl DataProvider<'_>` 中手写重复的 `match self` 转发。
- **签名与能力不一致**：例如 `query_records` 对 Salesforce 忽略 `describe` 参数，对 MySQL 却依赖 `describe: Option<&ObjectDescribe>`；`save_records_with_deletes` 对 Salesforce 直接硬编码返回错误 `"Salesforce 暂不支持单事务批量提交（含删除）。"`，缺乏统一的能力声明（Capabilities）机制。

#### 2. Salesforce 与 MySQL 的实现位置与职责不对称
- `src-tauri/src/providers/salesforce_provider.rs`（144 行）仅是一层薄包装，真正逻辑在根目录的 `src-tauri/src/salesforce.rs`（564 行）与 `src-tauri/src/sf_cli.rs`（938 行）。
- `src-tauri/src/providers/mysql_provider.rs`（1999 行）则把配置结构体、字段写入能力推导、SQL 解析/分页改写、DDL 提取、类型映射、变更 SQL 预览、事务执行全部塞在同一个文件中。

#### 3. 领域模型与存储层硬编码数据源类型
- `src-tauri/src/models.rs`（991 行）：核心模型仍叫 `SalesforceSource`、`SalesforceObject`，顶层字段包含 `instance_url`、`access_token`、`api_version`，并带有 `is_salesforce(&self)` 方法和默认 `"salesforce"` 类型。`SourceSecretView` 硬编码 `access_token` 和 `password`。
- `src-tauri/src/services/source_service.rs`：
  - `get_runtime_source`（第 43-55 行）硬编码判断 `is_mysql`，从 `secrets` 取出 `password` 后手动注入 `config_json`。
  - `extract_source_secrets` 硬编码抽取 `accessToken` 与 `password`，新增数据源（如 SSH 隧道密钥、Client Secret、SSL 证书密码）需要修改核心 Service。
- `src-tauri/src/storage/source_repo.rs`：`normalize_source_type`（第 246-252 行）仅识别 `"mysql"`，其余全部回退为 `"salesforce"`。

#### 4. 连接池与生命周期管理缺失
- `src-tauri/src/app_state.rs` 中只持有 `sf_client: SalesforceClient`，而 `MySqlProvider::new()` 是无状态结构体，未在 `AppState` 中缓存按 `source_id` 复用的 `MySqlPool` 连接池，也缺少数据源配置变更/删除时的连接池驱逐（Eviction）机制。

#### 5. `commands.rs` 巨型化与逻辑泄漏
- `src-tauri/src/commands.rs` 达到 **3293 行**，集成了全部 Tauri Command（数据源、元数据、查询、CLI、窗口、AI、日志、终端、工作区），同时内嵌了 `validate_payload`（按 `source_type` 分支校验）以及 `MysqlMutationLogDetail` 等特定数据源的日志序列化逻辑，存在 **15+ 处** `is_salesforce()` / `"mysql"` 分支。

#### 6. AI 工具模块强绑定 Salesforce
- `src-tauri/src/ai/tools.rs` 中工具名与描述硬编码为 `find_salesforce_objects` 等，未接入统一的元数据抽象与方言提示。

---

### 2.2 前端架构与数据源抽象问题

#### 1. 缺少前端数据源驱动（Driver）抽象
全项目至少存在以下位置直接通过 `sourceType` 字符串硬编码分支：
- **数据源管理**：`src/components/SourcePanel.tsx`（表单字段渲染、提交组装、类型切换默认值）、`src/components/DataSourceSelector.tsx`（徽章文案与颜色样式）、`src/features/main/SettingsPanel/sourceSecrets.ts`（仅针对 Salesforce 读取 `accessToken`）。
- **对象与元数据**：`src/components/ObjectList.tsx`、`src/features/main/QueryPanel/logic/sourceTreeProviders.ts`（虽然拆分了 `buildSalesforceRootChildren` / `buildMySqlRootChildren`，但缺少统一注册表分发）。
- **查询执行与工作区**：`src/features/main/QueryPanel/components/DataQueryTabPane.tsx`（1860 行，直接区分 `"salesforce" | "mysql-ddl" | "mysql-fields"` 与 `isMysqlSource`）、`src/features/main/QueryPanel/logic/queryExecutionContext.ts`。
- **DataGrid 数据网格**：`src/components/DataGrid/index.tsx`、`DataGridSurface.tsx`、`useDataGridColumns.ts`、`useDataGridMenuActions.ts`、`cellEditHandler.ts`、`contextMenu.ts`、`getCellContent.ts`、`utils/value.ts`（硬编码 MySQL 显示 `"Null"`、Salesforce 显示 `"None"`）。
- **状态与接口命名**：`src/types/index.ts` 中 `DataSourceType = "salesforce" | "mysql"`，通用数据源类型仍叫 `SalesforceSource`、`SalesforceObject`；`src/queries/salesforce.ts` 实际包含通用的 `useSourcesQuery`、`useObjectsQuery`、`useSystemLogsQuery`。

#### 2. 良好的局部实践（可作为重构样板）
- `src/components/monaco/languages/index.ts` 已采用 `LANGUAGE_MODULE_MAP: Record<QueryLanguage, MonacoLanguageModule>` 注册表模式，新增 SQL 方言时结构清晰。

---

### 2.3 前后端目录结构规范性问题

| 维度 | 当前问题 | 对产品演进的影响 |
| :--- | :--- | :--- |
| **后端目录分层** | `commands.rs`、`models.rs`、`salesforce.rs`、`sf_cli.rs`、`terminal.rs`、`lan_file_receiver.rs`、`llm.rs` 直接平铺在 `src-tauri/src/` 根目录，与 `providers/`、`services/`、`storage/`、`ai/` 混杂。 | 职责边界模糊，新开发者难以区分“接入层 / 领域层 / 基础设施层 / 独立工具模块”。 |
| **后端单文件膨胀** | `commands.rs`（3293 行）、`mysql_provider.rs`（1999 行）、`models.rs`（991 行）。 | 代码审查、合并冲突解决、单元测试隔离成本极高。 |
| **前端组件混放** | `src/components/` 既放通用基础组件（`NoticeAlert`、`ErrorBoundary`、`tabs/`、`DataGrid/`），又放业务强耦合组件（`SourcePanel`、`ObjectList`、`DataSourceSelector`、`SoqlMonacoEditor`）。同时存在 `DataGrid.tsx` 与 `DataGrid/` 并存。 | 组件复用边界不清，业务组件难以随 Feature 内聚演进。 |
| **前端巨型页面/面板** | `DataQueryTabPane.tsx`（1860 行）、`TerminalPanel/index.tsx`（1709 行）、`SettingsPanel/index.tsx`（1565 行）、`SoqlExecutorWorkspace.tsx`（1327 行）。 | 渲染逻辑、业务状态、异步请求高度耦合。 |
| **前端 Store 与命名** | `src/store/` 混放全局与局部 Feature 状态（如 `useJsonDiffStore`、`useQrCodeToolStore`、`useSoqlExecutorStore`）；测试目录 `tests/dategrid/` 存在拼写错误（应为 `datagrid`），且部分工具箱测试放在 `tests/query-panel/` 下。 | 状态归属不明确，目录检索心智负担重。 |

---

## 三、抽象数据源接口设计方案

核心思想：**“Driver + Capability + Registry + Generic Domain Model”**。  
任何新数据源（PostgreSQL、SQLite、Oracle、ClickHouse、REST API 等）只需实现前后端各自的 Driver 并在 Registry 注册，业务主流程（Command、Service、QueryPanel、DataGrid、Settings）**无需修改 `if/else` 分支**。

### 3.1 后端抽象设计（Rust）

#### 1. 定义统一领域模型（去 Salesforce 化）
- 将 `SalesforceSource` 重构为 `DataSource`（前期可保留 `pub type SalesforceSource = DataSource;` 过渡），核心字段收敛为通用属性：
  - `id`、`name`、`source_type: SourceKind`（或标准化字符串）、`sort_order`、`environment`、`color`、`enabled`
  - `config: Value`（由各 Driver 自己反序列化为强类型配置，如 `MySqlConfig`、`SalesforceConfig`、`PostgresConfig`）
  - `secrets: HashMap<String, String>`（仅运行时内部流转，不暴露给前端列表接口）
- 将 `SalesforceObject` 重构为 `DataObject`，增加通用扩展属性 `object_type`（如 `table` / `view` / `sobject` / `collection`）、`schema`、`comment`、`capabilities`。

#### 2. 定义 `ProviderCapabilities` 能力声明矩阵
通过能力矩阵替代散落各处的 `if is_salesforce()` 判断：
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    /// 查询语言标识（如 "soql" / "mysql" / "postgres"）。
    pub query_language: String,
    /// 是否支持 DDL 查看。
    pub supports_ddl: bool,
    /// 是否支持单事务批量提交（含删除）。
    pub supports_transactional_batch: bool,
    /// 是否支持单条记录删除/更新/新增。
    pub supports_create: bool,
    pub supports_update: bool,
    pub supports_delete: bool,
    /// 是否支持变更前 SQL 预览。
    pub supports_mutation_preview: bool,
    /// 是否支持子关系查询（如 Salesforce ChildRelationship）。
    pub supports_child_relationships: bool,
    /// 空值展示文本（如 "Null" 或 "None"）。
    pub null_display_text: String,
}
```
前端通过后端返回的 `capabilities`（或前端 Driver 对齐声明）决定 UI 按钮显隐（如是否显示 DDL 抽屉、是否允许批量事务删除、是否支持 SQL 预览），彻底消除硬编码。

#### 3. 定义 `DataSourceDriver` Trait 与拆分职责
建议将大而全的 Provider 拆分为清晰的 Trait（可用 `#[async_trait]` 或标准 `Pin<Box<dyn Future>>` 保证对象安全 `Arc<dyn DataSourceDriver>`）：
- **元数据与配置契约**：
  - `kind(&self) -> &'static str`
  - `capabilities(&self) -> ProviderCapabilities`
  - `validate_config(&self, payload: &SourceUpsertPayload) -> Result<(), AppError>`
  - `extract_secrets(&self, payload: &SourceUpsertPayload) -> HashMap<String, String>`
  - `inject_runtime_secrets(&self, config: &mut Value, secrets: &HashMap<String, String>)`
  - `build_secret_view(&self, secrets: &HashMap<String, String>) -> Value`（替代写死的 `SourceSecretView`）
- **连接与目录发现**：
  - `test_connection(&self, ctx: &RuntimeSource) -> Result<(), AppError>`
  - `list_objects(&self, ctx: &RuntimeSource) -> Result<Vec<DataObject>, AppError>`
  - `describe_object(&self, ctx: &RuntimeSource, object_name: &str) -> Result<ObjectDescribe, AppError>`
  - `get_object_ddl(&self, ctx: &RuntimeSource, object_name: &str) -> Result<ObjectDdl, AppError>`（默认返回 Unsupported）
- **查询与数据变更**：
  - `query_records(&self, ctx: &RuntimeSource, req: QueryRequest) -> Result<QueryResult, AppError>`
  - `create_record` / `update_record` / `delete_record` / `save_records` / `save_records_with_deletes`
  - `preview_mutations`（默认返回 Unsupported）
  - `get_current_user_context`（默认返回空上下文）

#### 4. 引入 `DriverRegistry` 与 `ConnectionPoolManager`
- 在 `AppState` 中持有 `driver_registry: Arc<DriverRegistry>` 与 `connection_manager: Arc<ConnectionManager>`。
- `DriverRegistry` 在应用启动时注册 `SalesforceDriver`、`MySqlDriver`（未来直接注册 `PostgresDriver`、`SqliteDriver` 等）。
- `ConnectionManager` 按 `(source_id, config_hash)` 缓存并复用连接池（如 `sqlx::MySqlPool`、`sqlx::PgPool`），在更新/删除数据源或应用退出时主动关闭并清理池资源。

---

### 3.2 前端抽象设计（TypeScript / React）

#### 1. 定义 `DataSourceDriver` 前端接口
在 `src/drivers/types.ts` 中定义统一前端驱动契约：
- **基础元信息**：`kind`、`displayName`、`badgeLabel`、`badgeClassName`、`defaultPort` / `defaultConfig`
- **能力集 `capabilities`**：`queryLanguage`、`supportsDdl`、`supportsMutationPreview`、`supportsRecordPageLink`、`supportsAuthWindow`、`nullPlaceholder`（`"Null"` | `"None"`）、`defaultDrawerView`
- **表单与校验适配器**：`ConnectionFormFields` 组件（渲染各自配置字段）、`validateForm`、`toUpsertPayload`、`fromSourceRecord`、`hydrateSecrets`
- **导航树适配器**：`buildRootChildren(source, ctx)`、`buildGroupChildren(node, ctx)`
- **查询与编辑器适配器**：`monacoLanguage`、`SmartInputComponent`、`buildConsoleSql`、`buildMutationPlanner`

#### 2. 建立 `DriverRegistry`（`src/drivers/registry.ts`）
- 提供 `registerDataSourceDriver(driver)`、`getDataSourceDriver(sourceType)`、`listDataSourceDrivers()`。
- **消除散落分支**：
  - `DataSourceSelector.tsx` 直接读取 `driver.badgeLabel` 与 `driver.badgeClassName`。
  - `SourcePanel.tsx` 动态渲染 `driver.ConnectionFormFields`，下拉框遍历 `listDataSourceDrivers()` 自动生成。
  - `DataGrid` 读取 `driver.capabilities.nullPlaceholder` 和 `supportsRecordPageLink`。
  - `sourceSecrets.ts` 调用 `driver.hydrateSecrets(...)` 替代写死的 `isSalesforceSource`。

---

## 四、推荐工程目录规范（Tauri 2 数据库客户端标准）

参考成熟桌面数据库客户端（DBeaver / TablePlus / DataGrip）与 Tauri 2 最佳实践，建议采用**“核心抽象 + 独立驱动插件 + 领域垂直切片”**的目录结构。

### 4.1 后端推荐目录结构（`src-tauri/src/`）

```text
src-tauri/src/
├── main.rs                         # Tauri 启动装配、Plugin 注册、状态初始化、退出清理
├── app_state.rs                    # 全局 AppState（Storage、DriverRegistry、ConnectionManager、Runtime）
├── error.rs                        # 统一 AppError 与错误码映射
│
├── domain/                         # 领域模型与通用契约（不依赖具体数据库实现）
│   ├── mod.rs
│   ├── source.rs                   # DataSource、SourceUpsertPayload、RuntimeSource
│   ├── metadata.rs                 # DataObject、ObjectDescribe、ObjectField、ObjectDdl
│   ├── query.rs                    # QueryRequest、QueryResult、MutationBatch、MutationResult
│   ├── workspace.rs                # 工作区快照、Tab、列可见性 DTO
│   └── system.rs                   # 系统日志、CLI 设置、LLM 设置 DTO
│
├── drivers/                        # 数据源驱动抽象层与各数据源实现（原 providers/ 升级）
│   ├── mod.rs                      # DataSourceDriver Trait、ProviderCapabilities、DriverRegistry
│   ├── connection_manager.rs       # 通用连接池缓存、健康检查与配置变更驱逐
│   ├── salesforce/                 # Salesforce 驱动内聚包
│   │   ├── mod.rs                  # SalesforceDriver 实现
│   │   ├── client.rs               # 原 salesforce.rs（REST API 客户端）
│   │   ├── cli.rs                  # 原 sf_cli.rs（SF CLI 同步与登录）
│   │   └── error.rs                # Salesforce 错误解析
│   ├── mysql/                      # MySQL 驱动内聚包（拆分原 1999 行单文件）
│   │   ├── mod.rs                  # MySqlDriver 实现与连接池构建
│   │   ├── config.rs               # MySqlSourceConfig 与参数校验
│   │   ├── metadata.rs             # information_schema / SHOW CREATE TABLE / DDL 提取
│   │   ├── query.rs                # SQL 解析、分页改写、结果集值序列化
│   │   ├── mutation.rs             # 写能力推导、SQL 预览、单事务增删改执行
│   │   └── log_detail.rs           # 结构化变更日志构建（从 commands.rs 迁出）
│   └── postgres/                   # （未来扩展示例）只需新增目录并在 Registry 注册
│       └── mod.rs
│
├── services/                       # 领域服务层（编排 Storage 与 Drivers）
│   ├── mod.rs
│   ├── source_service.rs           # 数据源 CRUD、Secret 生命周期、驱动校验调用
│   ├── metadata_service.rs         # 对象与字段元数据缓存、刷新策略
│   ├── query_service.rs            # 查询执行、变更事务编排、统一审计日志写入
│   ├── secret_service.rs           # 密钥管理与访问审计
│   ├── workspace_service.rs        # 工作区快照与偏好设置
│   └── diagnostic_service.rs       # 系统日志与诊断
│
├── storage/                        # SQLite v2 持久化基础设施（保持现有良好分层）
│   ├── mod.rs
│   ├── bootstrap.rs / schema.rs / pragma.rs / tx.rs
│   └── *_repo.rs
│
├── commands/                       # Tauri IPC 接入层（按领域拆分为薄包装，禁止内嵌业务逻辑）
│   ├── mod.rs                      # 统一导出并注册 generate_handler!
│   ├── source_commands.rs          # 数据源管理与连接测试
│   ├── metadata_commands.rs        # 对象列表、Describe、DDL
│   ├── query_commands.rs           # 查询、单条/批量变更、预览
│   ├── workspace_commands.rs       # 工作区与列宽/显隐配置
│   ├── auth_window_commands.rs     # 认证窗体、字段元信息窗体、外部链接
│   ├── ai_commands.rs              # AI 对话与能力查询
│   ├── terminal_commands.rs        # 终端会话与命令组
│   ├── tools_commands.rs           # 局域网文件接收等工具命令
│   └── settings_commands.rs        # CLI 路径、LLM、系统日志
│
└── modules/                        # 独立于数据源的桌面辅助子系统
    ├── ai/                         # AI 编排与通用数据源工具（原 ai/ 与 llm.rs）
    ├── terminal/                   # PTY 终端运行时（原 terminal.rs）
    └── lan_receiver/               # 局域网接收服务（原 lan_file_receiver.rs）
```

### 4.2 前端推荐目录结构（`src/`）

```text
src/
├── main.tsx
├── App.tsx
├── styles/
│
├── core/                           # 应用级基础设施与通用 IPC/状态
│   ├── api/                        # 按领域拆分的 Tauri invoke 封装（替代单一 api/index.ts）
│   │   ├── client.ts               # invokeApi 统一错误处理
│   │   ├── source.ts / query.ts / workspace.ts / terminal.ts / ai.ts / tools.ts
│   ├── types/                      # 通用领域类型（DataSource、DataObject、QueryResult 等）
│   ├── query/                      # TanStack Query Keys 与通用 Hooks（原 queries/salesforce.ts 迁入并重命名）
│   └── storage/                    # Tauri 存储适配器（原 store/tauriStorage.ts）
│
├── drivers/                        # 前端数据源驱动插件体系（与后端 drivers/ 一一对应）
│   ├── types.ts                    # DataSourceDriver、DriverCapabilities 接口定义
│   ├── registry.ts                 # registerDriver / getDriver / listDrivers
│   ├── salesforce/                 # Salesforce 前端驱动
│   │   ├── index.ts                # 导出 SalesforceDriver
│   │   ├── SalesforceForm.tsx      # 连接配置表单与 CLI 同步入口
│   │   ├── treeBuilder.ts          # 树节点构建
│   │   ├── smartInput.tsx          # SalesforceSmartInput
│   │   └── language.ts             # SOQL Monaco 语言定义
│   └── mysql/                      # MySQL 前端驱动
│       ├── index.ts                # 导出 MySqlDriver
│       ├── MySqlForm.tsx           # 主机/端口/库/用户/密码/SSL 表单
│       ├── treeBuilder.ts          # tables / collations / users / virtual-views 分组树
│       ├── smartInput.tsx          # MysqlSmartInput
│       ├── mutationPlanner.ts      # 原 QueryPanel/logic/mysql*.ts 迁入此处
│       └── language.ts             # MySQL Monaco 语言定义
│
├── components/                     # 纯 UI 与跨领域通用组件（禁止耦合具体数据源业务）
│   ├── ui/                         # ErrorBoundary、NoticeAlert、ContextMenu 等基础 UI
│   ├── tabs/                       # ReusableTabs 通用标签页
│   ├── monaco/                     # 通用 Monaco 容器与语言注册表
│   └── data-grid/                  # 通用 DataGrid（移除冗余 DataGrid.tsx 转发壳，仅消费 Driver 能力）
│
├── features/                       # 垂直业务特性模块（高内聚：组件 + Hooks + 局部 Store + 逻辑）
│   ├── source-manager/             # 数据源选择器、新建/编辑弹窗（原 SourcePanel、DataSourceSelector）
│   ├── query-workspace/            # 原 QueryPanel 拆分与重构
│   │   ├── components/             # 拆分 1860 行 DataQueryTabPane（工具栏 / 抽屉 / 状态栏 / 弹窗）
│   │   ├── hooks/
│   │   ├── store/                  # 原 useQuerySourceTreeStore / useQueryWorkspaceTabsStore / useSoqlExecutorStore
│   │   └── logic/                  # 仅保留与数据源无关的通用查询与 Tab 逻辑
│   ├── terminal/                   # 拆分 1709 行 TerminalPanel（命令组侧栏 / xterm 视口 / 设置）+ useTerminalStore
│   ├── settings/                   # 拆分 1565 行 SettingsPanel（数据源 Tab / CLI Tab / LLM Tab / 系统日志 Tab）
│   └── tools/                      # 工具箱（JSON Diff / Text Diff / QR / Unicode / LAN）及各自 Store
│
├── layouts/                        # 页面布局壳
└── pages/                          # 路由/窗口顶层页面（MainPage、AuthPage、FieldMetaPage）
```

> **测试目录规范**：建议将 `tests/dategrid/` 更名为 `tests/datagrid/`，并将工具箱相关单测（如 `jsonDiffLogic.test.ts`、`textDiffLogic.test.ts`）从 `tests/query-panel/` 移回 `tests/tools-panel/`，与 `src/` 结构保持镜像一致。

---

## 五、分阶段平滑重构路线图

为保证重构期间现有功能（`npm run build`、`cargo test`、Node 单测）持续可用，建议按以下 4 个阶段渐进式推进：

| 阶段 | 目标 | 核心动作 | 验收标准 |
| :--- | :--- | :--- | :--- |
| **Phase 1：后端 Trait 抽象与模型解耦** | 建立 `DataSourceDriver` Trait 与 `DriverRegistry`，消除 `DataProvider` 枚举 | 1. 定义 `DataSourceDriver` 与 `ProviderCapabilities`。<br>2. 将 `salesforce.rs` + `salesforce_provider.rs` 收敛为 `drivers/salesforce/`；将 `mysql_provider.rs` 拆分为 `drivers/mysql/`。<br>3. 在 `SourceService` 中通过驱动接口完成校验、Secret 抽取与注入。<br>4. 在 `AppState` 引入 `ConnectionManager` 管理 MySQL 连接池。 | `providers/mod.rs` 不再出现具体数据源枚举；新增数据源无需修改 `source_service.rs` 与 `source_repo.rs`。 |
| **Phase 2：后端 `commands.rs` 瘦身与领域拆分** | 解决 3293 行巨型文件与日志逻辑泄漏 | 1. 将 `commands.rs` 按领域拆分为 `commands/*.rs`。<br>2. 抽取 `QueryService` 统一承接查询/变更与结构化系统日志写入。<br>3. 将 `terminal.rs`、`lan_file_receiver.rs`、`ai/`、`llm.rs` 归位至 `modules/`。 | `commands/` 下每个文件职责单一、仅做参数校验与 Service 调用，不再直接出现 `is_salesforce()` 分支。 |
| **Phase 3：前端 Driver 注册表与分支消除** | 建立 `src/drivers/`，消除前端硬编码分支 | 1. 定义前端 `DataSourceDriver` 与 `registry.ts`，实现 `salesforce` 与 `mysql` 两个驱动。<br>2. 将 `SourcePanel`、`DataSourceSelector`、`DataGrid`、`sourceSecrets.ts` 改为消费 Driver 能力。<br>3. 将 `src/queries/salesforce.ts` 重命名并迁入 `core/query/`。 | 全局搜索 `sourceType === "mysql"` 或 `isMysqlSource` 归零（仅存在于 `drivers/mysql/` 内部）。 |
| **Phase 4：前端巨型组件拆分与目录规整** | 提升可维护性与代码可读性 | 1. 拆分 `DataQueryTabPane.tsx`（1860 行）、`TerminalPanel/index.tsx`（1709 行）、`SettingsPanel/index.tsx`（1565 行）。<br>2. 将全局 `src/store/` 中特性专属 Store 下沉至对应 `features/*/store/`。<br>3. 修正 `tests/dategrid` 拼写与测试目录归属。 | 单文件代码行数控制在合理范围（建议组件 < 400 行），前后端构建与全量测试通过。 |

---

## 六、未来新增数据源接入清单（以 PostgreSQL 为例）

完成上述重构后，未来新增 PostgreSQL（或 SQLite、ClickHouse）只需执行以下标准步骤，**零侵入修改现有核心代码**：

1. **后端**：在 `src-tauri/src/drivers/postgres/` 下实现 `DataSourceDriver` Trait（配置校验、Secret 抽取/注入、连接池、元数据查询、SQL 分页与事务变更）与 `ProviderCapabilities`。
2. **后端注册**：在 `DriverRegistry` 初始化时调用 `registry.register(Arc::new(PostgresDriver::new()))`。
3. **前端**：在 `src/drivers/postgres/` 下实现 `DataSourceDriver`（连接表单组件、树节点构建、Monaco SQL 方言配置、能力声明）。
4. **前端注册**：在 `src/drivers/registry.ts` 中调用 `registerDataSourceDriver(postgresDriver)`。
5. **完成**：数据源选择器、设置页表单、左侧对象树、查询控制台、DataGrid 渲染与能力按钮自动生效。
