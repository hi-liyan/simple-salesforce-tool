# SQLite v2 生产级重构设计

> 实现备注（2026-04-27）：当前代码已完成 `storage / services / commands` 分层接线，`src-tauri/src/db.rs` 与迁移期 `command_store.rs` 残留已移除；具体实施与验证状态以 [`docs/sqlite-v2-implementation-plan-2026-04-22.md`](/mnt/d/test-workspace/simple-salesforce-tool/docs/sqlite-v2-implementation-plan-2026-04-22.md) 为准。

## 1. 文档目标

本文档定义本项目本地 SQLite 持久层的 v2 目标架构。该版本明确采用**生产级、可破坏性重构**策略，不要求兼容当前 v1 schema，也不保留长期双写或 legacy 表兜底逻辑。

本次设计的目标不是继续修补 [`src-tauri/src/db.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs)，而是把当前“单文件 + 多职责 + 历史兼容层 + UI 快照黑盒”的本地存储体系，重构为：

- 可迁移
- 可扩展
- 可审计
- 可恢复
- 可清理
- 可分层维护

同时满足两个业务约束：

1. 后端允许重做 Tauri `commands` / service / repository / DTO。
2. 前端当前功能与交互效果保持不变，用户视角下不降级。
3. 设置页的数据源编辑界面在 v2 下仍可查看并编辑完整 secret 明文，例如 Salesforce `accessToken`，无需脱敏。

## 2. 现状问题

基于 [`docs/mysql-frontend-crud-review-2026-04-22.md`](/mnt/d/test-workspace/simple-salesforce-tool/docs/mysql-frontend-crud-review-2026-04-22.md)、[`docs/mysql-refactor-iteration-plan-2026-04-22.md`](/mnt/d/test-workspace/simple-salesforce-tool/docs/mysql-refactor-iteration-plan-2026-04-22.md)、当前 [`src-tauri/src/db.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/db.rs)、[`src-tauri/src/commands.rs`](/mnt/d/test-workspace/simple-salesforce-tool/src-tauri/src/commands.rs) 和前端持久化 store 的现状，v1 主要存在以下结构性问题：

- `data_sources` 与 `salesforce_sources` 长期并存，形成事实上的双模型与双写。
- `object_metadata_cache`、`source_metadata_cache`、`column_visibility_settings` 仍挂在 legacy 外键上。
- `app_settings` 同时承载产品配置与 UI 状态，语义边界混乱。
- Query / Console / Tool / Terminal 的持久化模型不统一，大量状态以 `ui.* -> JSON` 方式回写 SQLite。
- 结果集、baseline、dirty 草稿与轻量 UI 恢复没有结构化分层。
- `db.rs` 同时承担 schema 初始化、兼容迁移、数据源 CRUD、缓存、日志、终端命令、设置存取等多种职责。
- 读路径带修复副作用，例如读取前归一化排序，说明数据不变量没有被写路径收住。
- 当前敏感信息直接落在普通业务表和配置 JSON 中，不满足生产级安全边界。
- 系统日志仍偏 troubleshooting log，缺乏结构化 detail、关联 ID、清理策略和更明确的领域分层。

因此，SQLite v2 不应继续沿着“兼容旧结构并逐步缝补”的路径推进，而应直接建立新的本地存储边界。

## 3. 设计原则

SQLite v2 必须遵守以下原则：

### 3.1 领域分层

本地数据库按领域拆分，而不是按“一个万能表 + 若干附属表”组织。配置、密钥、元数据、工作区、诊断、自动化必须各自有清晰边界。

### 3.2 结构化优先

业务逻辑优先消费结构化表，不再直接依赖 blob JSON。当需要保留 provider 原始载荷时，使用专门的 blob 表作为补充。

### 3.3 恢复与运行态分离

能够恢复用户现场，不等于持久化全部运行态。所有“请求中 / 连接中 / streaming 中 / 临时 hover 状态”都不应落库。

### 3.4 密钥与普通配置分离

敏感信息允许暂时仍落在 SQLite 内，但必须单独进入 `secrets` 域，普通表只保留 `secret_bundle_id` 或等效引用。

同时，**存储分域**与**前端是否允许明文查看**是两个不同问题：v2 要求 secret 不再混存于普通业务表，但设置页在显式进入数据源编辑场景时，仍允许按需解密并返回完整明文给前端表单。

### 3.5 无 legacy 常驻兼容层

v2 不保留 `salesforce_sources`、不保留长期 dual-write、不保留读路径自动补旧表的兼容逻辑。

### 3.6 所有多表写入显式事务化

跨领域或跨表写入必须通过统一事务 helper 执行，不允许再出现“一次业务操作拆成多条无事务 SQL”的情况。

### 3.7 缓存显式失效

缓存必须具备 TTL、版本号、失效原因和清理策略，不能靠“读到脏数据后顺便修”。

## 4. 范围与非目标

### 4.1 本次设计覆盖范围

- 程序设定数据的重构
- 数据源设定数据的重构
- 敏感信息域的单独建模
- 元数据域的全量结构化重构
- Query / Console / Tool / Terminal 工作区持久化重构
- Query 结果集与编辑草稿恢复模型
- 诊断日志与后台任务模型
- 终端命令与自动化配置模型
- SQLite 运行时、事务、PRAGMA、模块拆分和后端实施顺序

### 4.2 明确不做

- 不继续兼容旧版 SQLite schema
- 不保留 `salesforce_sources` 作为过渡表
- 不在 v2 里引入事件溯源式 event store 全量架构
- 不在首版引入系统凭据管理器，密钥仍允许存在 SQLite 内
- 不改变当前前端产品功能范围与主要交互路径

## 5. 总体架构

SQLite v2 统一按 6 个领域组织：

1. `config`
   程序级设定、数据源设定、全局偏好、开关策略
2. `secrets`
   数据源密码、`access_token`、LLM `apiKey` 等敏感信息
3. `metadata`
   对象目录、字段、索引、约束、关系、DDL、原始 describe/blob
4. `workspace`
   Query / Console / Tool / Terminal 的标签页、视图态、结果集、草稿、标签日志
5. `diagnostics`
   系统日志、后台任务、迁移日志、安全访问审计
6. `automation`
   终端命令组、命令模板、保存的查询与未来脚本能力

这 6 个域可以仍存放在同一个 SQLite 文件里，但 schema、repository、service 和 DTO 不允许重新混成一个 `db.rs` 大杂烩。

## 6. 领域表结构设计

以下表结构是 v2 的推荐目标边界。字段名和个别列类型在实现时可以微调，但职责划分不应改变。

### 6.1 `config` 域

#### 6.1.1 `schema_meta`

用途：记录数据库 schema 信息与启动校验元信息。

建议字段：

- `key TEXT PRIMARY KEY`
- `value_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

建议键：

- `schema_version`
- `min_reader_version`
- `last_migration_id`
- `migrated_at`
- `bootstrap_version`

#### 6.1.2 `app_settings`

用途：只存产品级配置，不再承载 UI 现场。

建议字段：

- `setting_key TEXT PRIMARY KEY`
- `value_json TEXT NOT NULL`
- `scope TEXT NOT NULL DEFAULT 'global'`
- `schema_version INTEGER NOT NULL`
- `updated_at TEXT NOT NULL`

适合内容：

- `sf_cli_path`
- `terminal.shell.command`
- LLM 默认 provider/model/timeout
- 日志保留天数
- 自动刷新策略
- 跨模块共享的轻量全局偏好

#### 6.1.3 `data_sources`

用途：统一替代现在的 `data_sources + salesforce_sources`。

建议字段：

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `source_type TEXT NOT NULL`
- `environment TEXT NOT NULL DEFAULT 'default'`
- `color TEXT NOT NULL DEFAULT ''`
- `sort_order INTEGER NOT NULL`
- `enabled INTEGER NOT NULL DEFAULT 1`
- `config_json TEXT NOT NULL`
- `secret_bundle_id TEXT NULL`
- `version INTEGER NOT NULL DEFAULT 1`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `archived_at TEXT NULL`

约束：

- `secret_bundle_id` 外键指向 `secret_bundles(id)`
- 删除数据源时相关 metadata / workspace / automation 数据按策略级联清理或归档

#### 6.1.4 `source_tags`

用途：给数据源挂环境、团队、用途、风险等级等标签。

建议字段：

- `source_id TEXT NOT NULL`
- `tag_key TEXT NOT NULL`
- `tag_value TEXT NOT NULL`
- `created_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, tag_key, tag_value)`

### 6.2 `secrets` 域

#### 6.2.1 `secret_bundles`

用途：敏感信息容器，一个数据源、一个 LLM 配置或一个集成配置对应一个 bundle。

建议字段：

- `id TEXT PRIMARY KEY`
- `owner_type TEXT NOT NULL`
- `owner_id TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'active'`
- `description TEXT NOT NULL DEFAULT ''`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### 6.2.2 `secret_items`

用途：真实密文记录。

建议字段：

- `id TEXT PRIMARY KEY`
- `bundle_id TEXT NOT NULL`
- `secret_key TEXT NOT NULL`
- `cipher_text TEXT NOT NULL`
- `algorithm TEXT NOT NULL`
- `key_version INTEGER NOT NULL`
- `nonce TEXT NOT NULL`
- `fingerprint TEXT NOT NULL`
- `last_verified_at TEXT NULL`
- `rotated_at TEXT NULL`
- `expires_at TEXT NULL`
- `updated_at TEXT NOT NULL`

约束：

- `UNIQUE(bundle_id, secret_key)`
- `FOREIGN KEY(bundle_id) REFERENCES secret_bundles(id) ON DELETE CASCADE`

#### 6.2.3 `secret_access_audit`

用途：记录密钥读取、更新、轮换、失效。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `bundle_id TEXT NOT NULL`
- `secret_item_id TEXT NULL`
- `action TEXT NOT NULL`
- `trigger_source TEXT NOT NULL`
- `success INTEGER NOT NULL`
- `message TEXT NOT NULL`
- `correlation_id TEXT NOT NULL DEFAULT ''`
- `detail_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`

#### 6.2.4 Secret 读取策略

v2 明确支持以下产品语义：

- 设置页的数据源编辑界面可以读取并展示完整 secret 明文
- 数据源新增/编辑时可以直接回填现有 secret 到表单
- 不要求在该界面做脱敏展示

但同时必须满足以下约束：

- 只有显式的“编辑数据源/读取设置”链路允许解密返回
- `data_sources`、`app_settings`、`workspace` 等普通表仍禁止直接存 secret 明文
- `system_logs`、`tab_logs`、调试导出、错误栈拼接不得输出明文 secret
- 每次显式读取 secret 明文都应写入 `secret_access_audit`

### 6.3 `metadata` 域

#### 6.3.1 `source_objects`

用途：统一对象目录，覆盖 Salesforce object 与 MySQL table/view。

建议字段：

- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `object_type TEXT NOT NULL`
- `label TEXT NOT NULL DEFAULT ''`
- `comment TEXT NOT NULL DEFAULT ''`
- `capabilities_json TEXT NOT NULL`
- `schema_version INTEGER NOT NULL DEFAULT 1`
- `snapshot_version INTEGER NOT NULL DEFAULT 1`
- `identity_hash TEXT NOT NULL`
- `refresh_reason TEXT NOT NULL DEFAULT ''`
- `fetched_at TEXT NOT NULL`
- `expires_at TEXT NULL`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, object_name)`

#### 6.3.2 `source_object_fields`

用途：统一字段/列元数据。

建议字段：

- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `field_name TEXT NOT NULL`
- `ordinal_position INTEGER NOT NULL`
- `label TEXT NOT NULL DEFAULT ''`
- `data_type TEXT NOT NULL`
- `native_type TEXT NOT NULL DEFAULT ''`
- `nullable INTEGER NOT NULL`
- `default_expr TEXT NOT NULL DEFAULT ''`
- `is_primary_key INTEGER NOT NULL DEFAULT 0`
- `is_generated INTEGER NOT NULL DEFAULT 0`
- `is_auto_increment INTEGER NOT NULL DEFAULT 0`
- `write_capability TEXT NOT NULL DEFAULT 'unknown'`
- `metadata_json TEXT NOT NULL`
- `schema_version INTEGER NOT NULL DEFAULT 1`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, object_name, field_name)`

#### 6.3.3 `source_object_indexes`

用途：索引与主键索引信息。

建议字段：

- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `index_name TEXT NOT NULL`
- `index_type TEXT NOT NULL`
- `is_unique INTEGER NOT NULL`
- `is_primary INTEGER NOT NULL`
- `columns_json TEXT NOT NULL`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, object_name, index_name)`

#### 6.3.4 `source_object_constraints`

用途：唯一约束、外键、检查约束等。

建议字段：

- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `constraint_name TEXT NOT NULL`
- `constraint_type TEXT NOT NULL`
- `definition_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, object_name, constraint_name)`

#### 6.3.5 `source_object_relations`

用途：关系导航信息，包括 Salesforce child relationship 与 MySQL FK relation。

建议字段：

- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `relation_key TEXT NOT NULL`
- `relation_type TEXT NOT NULL`
- `target_object_name TEXT NOT NULL`
- `field_name TEXT NOT NULL DEFAULT ''`
- `relation_name TEXT NOT NULL DEFAULT ''`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `updated_at TEXT NOT NULL`
- `PRIMARY KEY(source_id, object_name, relation_key)`

#### 6.3.6 `source_metadata_blobs`

用途：保留 provider 原始载荷。

建议字段：

- `id TEXT PRIMARY KEY`
- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL DEFAULT ''`
- `blob_type TEXT NOT NULL`
- `payload TEXT NOT NULL`
- `snapshot_version INTEGER NOT NULL`
- `content_hash TEXT NOT NULL`
- `fetched_at TEXT NOT NULL`
- `expires_at TEXT NULL`

### 6.4 `workspace` 域

#### 6.4.1 `workspace_tabs`

用途：统一 Query 数据 tab、Console tab、Terminal tab、工具 tab。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `tab_kind TEXT NOT NULL`
- `title TEXT NOT NULL`
- `source_id TEXT NULL`
- `binding_key TEXT NOT NULL DEFAULT ''`
- `sort_order INTEGER NOT NULL`
- `is_active INTEGER NOT NULL DEFAULT 0`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### 6.4.2 `workspace_tab_views`

用途：轻量视图态。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `view_state_json TEXT NOT NULL`
- `schema_version INTEGER NOT NULL`
- `updated_at TEXT NOT NULL`

可存内容：

- 抽屉开关
- 当前子面板
- 查询栏显隐
- 侧栏宽度
- 底部 panel 显隐

#### 6.4.3 `query_tab_state`

用途：Query tab 的业务上下文。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `query_language TEXT NOT NULL`
- `query_text TEXT NOT NULL`
- `query_draft TEXT NOT NULL`
- `where_clause TEXT NOT NULL DEFAULT ''`
- `limit_value INTEGER NOT NULL`
- `sort_field TEXT NOT NULL DEFAULT ''`
- `sort_direction TEXT NOT NULL DEFAULT 'DESC'`
- `sort_clause TEXT NOT NULL DEFAULT ''`
- `column_visibility_json TEXT NOT NULL`
- `active_result_set_id TEXT NULL`
- `updated_at TEXT NOT NULL`

#### 6.4.4 `query_result_sets`

用途：完整结果集快照。

建议字段：

- `result_set_id TEXT PRIMARY KEY`
- `tab_id TEXT NOT NULL`
- `source_id TEXT NOT NULL`
- `object_name TEXT NOT NULL`
- `result_status TEXT NOT NULL`
- `columns_json TEXT NOT NULL`
- `records_json TEXT NOT NULL`
- `baseline_records_json TEXT NOT NULL`
- `row_count INTEGER NOT NULL`
- `schema_version INTEGER NOT NULL`
- `metadata_identity_hash TEXT NOT NULL DEFAULT ''`
- `fetched_at TEXT NOT NULL`
- `expires_at TEXT NULL`
- `invalid_reason TEXT NOT NULL DEFAULT ''`

`result_status` 取值建议：

- `fresh`
- `stale`
- `invalid`

#### 6.4.5 `query_row_drafts`

用途：保存新增 / 编辑 / 删除草稿，支持重启恢复。

建议字段：

- `id TEXT PRIMARY KEY`
- `tab_id TEXT NOT NULL`
- `result_set_id TEXT NOT NULL`
- `row_stable_id TEXT NOT NULL`
- `row_locator_json TEXT NOT NULL`
- `draft_scope TEXT NOT NULL`
- `field_name TEXT NOT NULL DEFAULT ''`
- `draft_kind TEXT NOT NULL`
- `draft_value_json TEXT NOT NULL`
- `baseline_value_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

说明：

- `row_stable_id` 只服务 UI 恢复、高亮、选择与 dirty 标记
- `row_locator_json` 才服务后端更新/删除定位
- `draft_kind` 明确区分 `omit/null/value/default/delete/create`

#### 6.4.6 `console_tab_state`

用途：Console/SOQL 执行器状态。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `source_id TEXT NOT NULL`
- `query_language TEXT NOT NULL`
- `draft_text TEXT NOT NULL`
- `selected_text TEXT NOT NULL DEFAULT ''`
- `show_bottom_panel INTEGER NOT NULL DEFAULT 0`
- `ai_mode INTEGER NOT NULL DEFAULT 0`
- `ai_prompt_draft TEXT NOT NULL DEFAULT ''`
- `ai_conversation_snapshot_json TEXT NOT NULL DEFAULT '{}'`
- `updated_at TEXT NOT NULL`

#### 6.4.7 `tool_tab_state`

用途：JSON Formatter / JSON Diff / Text Diff 等工具状态。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `tool_type TEXT NOT NULL`
- `state_json TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### 6.4.8 `terminal_tab_state`

用途：终端 tab 的可恢复 UI 状态，不持久化 PTY 运行态。

建议字段：

- `tab_id TEXT PRIMARY KEY`
- `title TEXT NOT NULL`
- `input_draft TEXT NOT NULL DEFAULT ''`
- `output_snapshot_json TEXT NOT NULL DEFAULT '[]'`
- `updated_at TEXT NOT NULL`

#### 6.4.9 `tab_logs`

用途：面向用户的 tab 内日志。

建议字段：

- `id TEXT PRIMARY KEY`
- `tab_id TEXT NOT NULL`
- `action TEXT NOT NULL`
- `success INTEGER NOT NULL`
- `summary TEXT NOT NULL`
- `detail_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`

### 6.5 `diagnostics` 域

#### 6.5.1 `system_logs`

用途：排障与结构化系统日志。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `created_at TEXT NOT NULL`
- `level TEXT NOT NULL`
- `category TEXT NOT NULL`
- `action TEXT NOT NULL`
- `source_id TEXT NULL`
- `workspace_tab_id TEXT NULL`
- `target TEXT NULL`
- `success INTEGER NOT NULL`
- `message TEXT NOT NULL`
- `detail_text TEXT NULL`
- `detail_json TEXT NOT NULL DEFAULT '{}'`
- `correlation_id TEXT NOT NULL DEFAULT ''`
- `retention_policy TEXT NOT NULL DEFAULT 'default'`
- `expires_at TEXT NULL`

#### 6.5.2 `background_jobs`

用途：记录后台任务。

建议字段：

- `job_id TEXT PRIMARY KEY`
- `job_type TEXT NOT NULL`
- `target_scope TEXT NOT NULL`
- `target_id TEXT NOT NULL DEFAULT ''`
- `status TEXT NOT NULL`
- `progress_json TEXT NOT NULL DEFAULT '{}'`
- `correlation_id TEXT NOT NULL DEFAULT ''`
- `started_at TEXT NOT NULL`
- `finished_at TEXT NULL`
- `error_message TEXT NOT NULL DEFAULT ''`

#### 6.5.3 `migration_logs`

用途：记录 v2 级别 schema/bootstrap/migration 行为。

建议字段：

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `migration_id TEXT NOT NULL`
- `phase TEXT NOT NULL`
- `success INTEGER NOT NULL`
- `message TEXT NOT NULL`
- `detail_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`

### 6.6 `automation` 域

#### 6.6.1 `terminal_command_groups`

用途：终端命令组。

建议字段：

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `sort_order INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### 6.6.2 `terminal_commands`

用途：命令模板。

建议字段：

- `id TEXT PRIMARY KEY`
- `group_id TEXT NOT NULL`
- `name TEXT NOT NULL`
- `command_text TEXT NOT NULL`
- `description TEXT NOT NULL DEFAULT ''`
- `sort_order INTEGER NOT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

#### 6.6.3 `saved_queries`

用途：保存 SQL / SOQL / 模板 / 最近查询。

建议字段：

- `id TEXT PRIMARY KEY`
- `source_id TEXT NULL`
- `query_language TEXT NOT NULL`
- `query_type TEXT NOT NULL`
- `title TEXT NOT NULL`
- `query_text TEXT NOT NULL`
- `tags_json TEXT NOT NULL DEFAULT '[]'`
- `last_used_at TEXT NULL`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

## 7. 工作区恢复模型

SQLite v2 的工作区恢复必须采用“标签页主模型 + 分层快照 + 显式失效语义”。

### 7.1 恢复分层

恢复顺序必须分成 4 层：

1. `workspace_tabs`
   恢复有哪些 tab、顺序如何、谁是激活项、绑定哪个 source / object / tool
2. `*_tab_state`
   恢复业务上下文，例如 Query 条件、SQL 草稿、列显隐、Console 草稿、工具文本
3. `query_result_sets`
   恢复上次看到的结果集
4. `query_row_drafts`
   恢复未提交草稿

### 7.2 Query 结果集恢复状态

每个结果集必须有明确状态：

- `fresh`
  结果集仍在有效期内，且依赖的对象元数据版本未变化
- `stale`
  结果集仍可展示，但 TTL 已过或元数据需要校验，UI 需提示“历史结果”
- `invalid`
  source 已删除、对象结构冲突或草稿无法安全重放时，只恢复 query state，不恢复结果表格

### 7.3 草稿恢复规则

草稿必须基于“行身份 + 字段语义”恢复，不允许通过当前表格值反推。

规则：

- `row_stable_id` 只服务 UI 身份
- `row_locator_json` 才服务后端定位
- 草稿挂在明确的 `result_set_id` 下
- 新查询生成新 `result_set_id`
- 旧草稿不自动迁移到结构已变化的新结果集

### 7.4 启动恢复顺序

建议启动流程：

1. 恢复 `workspace_tabs`
2. 恢复 Query / Console / Tool / Terminal 的轻量状态
3. 优先恢复激活 tab 的结果集与草稿
4. 其余 tab 延迟加载
5. 后台触发静默重查、元数据校验、过期标记修正

### 7.5 不持久化的运行态

以下状态不应落库：

- loading
- token refresh 中间态
- PTY/session/PID
- toast/notice
- AI streaming 中间片段
- hover/context menu/dragging

## 8. 元数据模型与缓存策略

### 8.1 元数据分层

业务逻辑优先使用结构化表：

- `source_objects`
- `source_object_fields`
- `source_object_indexes`
- `source_object_constraints`
- `source_object_relations`

只有在需要完整 provider 原始载荷时才访问 `source_metadata_blobs`。

### 8.2 版本语义

每个对象元数据需引入两类版本：

- `schema_version`
  字段、主键、索引、约束等结构变化时递增
- `snapshot_version`
  本地第几次抓取快照

同时记录：

- `identity_hash`
- `fetched_at`
- `expires_at`
- `refresh_reason`

### 8.3 缓存失效

按数据类型设置不同 TTL：

- 对象列表：较短
- describe / fields：中等
- DDL / indexes / constraints：较长
- explain / query analysis：短期临时缓存

必须支持 3 类主动失效：

- 用户手动刷新
- 数据源配置版本变化
- 运行时发现结构冲突

### 8.4 与 Query 可信编辑链路的关系

metadata 域必须直接支撑：

- 结果集是否可编辑
- 字段可写能力与只读原因
- 主键 / 唯一键 / 自增 / 生成列识别
- 恢复时旧结果集与当前元数据兼容性判断
- 草稿恢复与提交前的语义校验

## 9. 设置、密钥、UI 状态与日志边界

### 9.1 `app_settings`

只允许存产品级配置，不再存工作区现场、结果集与 tab 快照。

### 9.2 `ui_state`

v2 不推荐继续把大状态回退成 `ui.key -> json` 黑盒。

如仍需保留轻量通用状态表，可限定为：

- `scope`
- `state_key`
- `value_json`
- `ttl_seconds`
- `schema_version`
- `updated_at`

且只允许存：

- 主页面 view mode
- 左树轻量展示状态
- 复用 tabs 的顺序等小体量状态

不允许存：

- 完整 Query tab
- 完整结果集
- 草稿
- 工具大文本
- 终端运行输出全历史

### 9.3 `secrets`

安全底线：

1. 普通业务表禁止存明文凭据
2. 所有敏感信息只能进入 `secret_bundles + secret_items`
3. 设置页中的数据源编辑表单允许显式读取并展示明文 secret，不做脱敏
4. 后端日志禁止输出明文 secret
5. 调试导出默认脱敏 `detail_json` 中的敏感字段

### 9.4 `system_logs` 与 `tab_logs`

必须分层：

- `tab_logs` 面向用户当前工作区
- `system_logs` 面向开发、支持与排障
- 安全访问与迁移行为进入 `secret_access_audit` / `migration_logs`

## 10. 索引与清理策略

### 10.1 关键索引

建议至少建立以下索引：

- `data_sources(sort_order, id)`
- `source_objects(source_id, object_name)`
- `source_objects(source_id, object_type, sort_order)`
- `source_objects(expires_at)`
- `source_object_fields(source_id, object_name, field_name)`
- `source_object_fields(source_id, object_name, ordinal_position)`
- `source_object_indexes(source_id, object_name, index_name)`
- `source_object_constraints(source_id, object_name, constraint_name)`
- `source_metadata_blobs(source_id, object_name, blob_type, snapshot_version DESC)`
- `workspace_tabs(sort_order, tab_id)`
- `query_result_sets(tab_id, fetched_at DESC)`
- `query_row_drafts(tab_id, result_set_id, row_stable_id)`
- `system_logs(created_at DESC)`
- `system_logs(correlation_id, created_at DESC)`
- `background_jobs(status, started_at DESC)`
- `secret_access_audit(bundle_id, created_at DESC)`

### 10.2 清理策略

SQLite v2 必须具备明确的清理能力：

- `system_logs` 按天数或条数滚动清理
- `tab_logs` 随 tab 生命周期裁剪
- `query_result_sets` 按 TTL 或数量清理旧快照
- `query_row_drafts` 随结果集失效联动清理
- `source_metadata_blobs` 保留当前快照 + 有限历史
- `ui_state` 支持 TTL 失效
- `secret_access_audit` 支持归档或长保留分页

## 11. 运行时与连接配置

启动时至少统一设置：

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA busy_timeout = 5000`
- `PRAGMA temp_store = MEMORY`

连接模型目标：

- v2 第一阶段可继续单连接，但必须统一进入 `Storage` 边界
- 显式区分读操作与写事务
- 所有多表写入必须走事务 helper
- 后续如需要，再评估连接池或更细粒度访问控制

## 12. 后端模块拆分设计

推荐新目录：

- `src-tauri/src/storage/mod.rs`
- `src-tauri/src/storage/bootstrap.rs`
- `src-tauri/src/storage/schema.rs`
- `src-tauri/src/storage/pragma.rs`
- `src-tauri/src/storage/tx.rs`
- `src-tauri/src/storage/config_repo.rs`
- `src-tauri/src/storage/source_repo.rs`
- `src-tauri/src/storage/secret_repo.rs`
- `src-tauri/src/storage/metadata_repo.rs`
- `src-tauri/src/storage/workspace_repo.rs`
- `src-tauri/src/storage/log_repo.rs`
- `src-tauri/src/storage/automation_repo.rs`

推荐 service 层：

- `source_service.rs`
- `workspace_service.rs`
- `metadata_service.rs`
- `secret_service.rs`
- `diagnostic_service.rs`

职责边界：

- `bootstrap/schema/pragma`：建库、版本检查、PRAGMA、初始化
- `tx`：统一事务入口
- `repo`：单领域 CRUD
- `service`：编排跨 repo 业务动作
- `commands.rs`：参数校验、调用 service、返回 DTO
- `providers/*`：远端 Salesforce / MySQL 访问

## 13. 迁移策略

由于本次接受破坏性设计，SQLite v2 建议采用**切库策略**而不是原地兼容迁移。

推荐流程：

1. 启动检测到旧版 `app.db`
2. 将旧库重命名归档，例如 `app.v1.backup.<timestamp>.db`
3. 直接创建新的 v2 数据库文件
4. 按 v2 schema 初始化全部表、索引与 PRAGMA
5. 不在主启动链路里做旧表逐表搬迁
6. 如需保留关键旧数据，后续单独提供“导入旧配置”流程

这样做的价值：

- 不把 legacy 表继续带入 v2
- 不在 repo 中长期同时理解 v1 / v2 两套结构
- 避免 ad-hoc 启动修补逻辑继续堆积

## 14. 实施顺序

### P0：Storage 基础设施

- 新数据库文件与 bootstrap
- `schema_meta`
- PRAGMA 初始化
- 事务 helper
- 基础 repository 骨架

### P1：配置域与数据源域

- `app_settings`
- `data_sources`
- `source_tags`
- `secret_bundles`
- `secret_items`
- 数据源 CRUD 全部切新 repo/service

### P2：Metadata 域

- `source_objects`
- `source_object_fields`
- `source_object_indexes`
- `source_object_constraints`
- `source_object_relations`
- `source_metadata_blobs`

### P3：Workspace 域

- `workspace_tabs`
- `workspace_tab_views`
- `query_tab_state`
- `query_result_sets`
- `query_row_drafts`
- `console_tab_state`
- `tool_tab_state`
- `terminal_tab_state`
- `tab_logs`

### P4：Diagnostics 与 Automation 域

- `system_logs`
- `background_jobs`
- `migration_logs`
- `secret_access_audit`
- `terminal_command_groups`
- `terminal_commands`
- `saved_queries`

### P5：Commands / 恢复流程 / DTO 重构

- 后端命令层全部切换到新 service/repo
- 前端功能和交互效果保持等效
- 启动恢复流程改为结构化恢复，不再依赖全量 store 黑盒快照

## 15. 对前端的约束

虽然 v2 允许重做后端接口层，但本轮设计要求前端行为保持不变：

- 页面结构不做产品级大改
- Query / Console / Tool / Terminal 当前主功能不减
- 启动恢复、tab 恢复、结果集恢复、草稿恢复体验保持等效或更稳
- 设置页的数据源编辑表单仍可看到并编辑完整 secret 明文，不因 `secrets` 分域而改成只显示掩码
- 允许调整 invoke command 名称、payload、DTO，只要最终前端效果不退化

## 16. 验收标准

SQLite v2 落地后，至少满足以下验收标准：

1. 新库初始化后不存在任何 legacy 表。
2. 不再保留 `salesforce_sources` / `data_sources` 双模型。
3. 所有敏感信息不再落普通业务表或普通配置 JSON。
4. Query / Console / Tool / Terminal 工作区可以在重启后恢复。
5. Query 结果集与未提交草稿可以恢复，并带有 `fresh/stale/invalid` 状态。
6. 元数据按结构化表缓存，并支持 TTL、版本与失效策略。
7. `system_logs` 与 `tab_logs` 分层明确，且具备结构化 detail。
8. 所有多表写入通过显式事务 helper 执行。
9. 后端不再存在一个超大 `db.rs` 承担全部职责。
10. 读路径不再承担修数据副作用。

## 17. 最终结论

SQLite v2 应采用“领域化重构 + 破坏性切库 + 结构化恢复”的路线，而不是继续给当前 schema 打补丁。

一句话总结：

> 保留 SQLite 作为本地持久层，但彻底重构其 schema、存储边界、恢复模型与后端访问层，把配置、密钥、元数据、工作区、诊断、自动化拆成清晰领域，接受不兼容旧结构的 v2 方案，一次把地基做对。
