# SQLite v2 数据库式样书

> 文档日期：2026-04-28  
> 适用范围：`simple-salesforce-tool` 本地 SQLite v2 持久层  
> 结论口径：**以当前仓库代码实现为准**，并补充对 [`docs/sqlite-v2-design-2026-04-22.md`](./sqlite-v2-design-2026-04-22.md) 与 [`docs/sqlite-v2-implementation-plan-2026-04-22.md`](./sqlite-v2-implementation-plan-2026-04-22.md) 的落地差异说明。

## 1. 文档目标

本文档用于沉淀当前 SQLite v2 的数据库正式式样，覆盖以下内容：

- 数据库文件与启动规则
- 运行时 PRAGMA 约束
- 各领域数据表、主键、外键、主要字段与用途
- 前后端实际读写链路
- 当前实现与目标设计之间的差异

本文档不重复展开完整重构动机；若需查看背景，请优先阅读设计稿与实施计划。

## 2. 依据资料

- 设计稿：[`docs/sqlite-v2-design-2026-04-22.md`](./sqlite-v2-design-2026-04-22.md)
- 实施计划：[`docs/sqlite-v2-implementation-plan-2026-04-22.md`](./sqlite-v2-implementation-plan-2026-04-22.md)
- 启动与建库实现：[`src-tauri/src/storage/bootstrap.rs`](../src-tauri/src/storage/bootstrap.rs)、[`src-tauri/src/storage/schema.rs`](../src-tauri/src/storage/schema.rs)、[`src-tauri/src/storage/pragma.rs`](../src-tauri/src/storage/pragma.rs)
- 领域仓储与服务：[`src-tauri/src/storage`](../src-tauri/src/storage)、[`src-tauri/src/services`](../src-tauri/src/services)
- 前端工作区恢复：[`src/store/tauriStorage.ts`](../src/store/tauriStorage.ts)、[`src/store/workspaceSnapshot.ts`](../src/store/workspaceSnapshot.ts)

## 3. 数据库总体说明

### 3.1 数据库文件

- 主数据库文件名：`app.db`
- 当前仍为**单 SQLite 文件**
- 由 Tauri 启动时通过 `Storage::open_or_bootstrap()` 统一打开

### 3.2 启动切库与归档规则

启动时会先检查现有 `app.db`：

- 若不存在，则直接创建新库
- 若识别为 v1 或任意 legacy 库，则归档为 `app.v1.backup.<timestamp>.db`
- 若识别为旧版 v2 中间库或当前 v2 但关键列不完整，则归档为 `app.v2.stale.backup.<timestamp>.db`

当前归档判断条件包括：

- 不存在 `schema_meta`
- `schema_meta.schema_version` 不是 `2`
- `schema_meta.bootstrap_version` 不是 `"sqlite-v2-bootstrap-2026-04-24"`
- `data_sources` 缺少当前实现依赖的关键列

### 3.3 运行时 PRAGMA

启动后统一执行以下 PRAGMA：

- `PRAGMA foreign_keys = ON`
- `PRAGMA journal_mode = WAL`
- `PRAGMA synchronous = NORMAL`
- `PRAGMA temp_store = MEMORY`
- `PRAGMA busy_timeout = 5000`

### 3.4 存储访问边界

当前后端已按 `storage / services / commands` 分层：

- `Storage`：连接、事务、建库、PRAGMA
- `repo`：单领域 CRUD
- `service`：跨表编排
- `commands.rs`：Tauri 命令入口

当前仍存在一层迁移期兼容入口 [`src-tauri/src/command_storage.rs`](../src-tauri/src/command_storage.rs)，但其底层已复用 v2 schema 与 repo。

## 4. 领域总览

当前 SQLite v2 实际已建表如下：

| 领域 | 表 |
| --- | --- |
| `config` | `schema_meta`、`app_settings`、`data_sources`、`source_tags` |
| `secrets` | `secret_bundles`、`secret_items`、`secret_access_audit` |
| `metadata` | `source_objects`、`source_object_fields`、`source_object_relations`、`source_object_indexes`、`source_object_constraints`、`source_metadata_blobs`、`source_object_ddls`、`query_column_visibility` |
| `workspace` | `workspace_tabs`、`workspace_ui_state`、`query_tab_state`、`query_result_sets`、`query_row_drafts`、`console_tab_state`、`tool_tab_state`、`terminal_tab_state` |
| `diagnostics` | `system_logs`、`migration_logs` |
| `automation` | `terminal_command_groups`、`terminal_commands` |

设计稿中提出但**当前代码尚未实现为正式表**的对象：

- `workspace_tab_views`
- `tab_logs`
- `background_jobs`
- `saved_queries`

## 5. 表式样

### 5.1 `config` 域

#### 5.1.1 `schema_meta`

- 用途：保存 schema 与 bootstrap 元信息
- 主键：`key`
- 字段：`key`、`value_json`、`updated_at`
- 当前写入键：
  - `schema_version`
  - `min_reader_version`
  - `last_migration_id`
  - `bootstrap_version`
  - `migrated_at`

#### 5.1.2 `app_settings`

- 用途：保存产品级设置
- 主键：`setting_key`
- 字段：`setting_key`、`value_json`、`scope`、`schema_version`、`updated_at`
- 当前仓储：`config_repo`
- 当前语义：只作为 key/value JSON 配置表使用

#### 5.1.3 `data_sources`

- 用途：统一保存 Salesforce / MySQL 数据源基础配置
- 主键：`id`
- 外键：`secret_bundle_id` 逻辑上关联 `secret_bundles.id`，但当前 schema **未显式声明外键约束**
- 字段：
  - `id`
  - `name`
  - `source_type`
  - `environment`
  - `color`
  - `sort_order`
  - `enabled`
  - `config_json`
  - `secret_bundle_id`
  - `version`
  - `created_at`
  - `updated_at`
  - `archived_at`
- 关键约束：
  - 列表查询仅返回 `archived_at IS NULL`
  - 排序按 `sort_order, created_at, id`
  - `config_json` 中会主动剔除 `accessToken`、`password`

#### 5.1.4 `source_tags`

- 用途：数据源标签扩展表
- 复合主键：`(source_id, tag_key, tag_value)`
- 外键：`source_id -> data_sources(id) ON DELETE CASCADE`
- 字段：`source_id`、`tag_key`、`tag_value`、`created_at`
- 当前状态：**已建表，仓储读写尚未落地**

### 5.2 `secrets` 域

#### 5.2.1 `secret_bundles`

- 用途：secret 容器
- 主键：`id`
- 字段：`id`、`owner_type`、`owner_id`、`status`、`description`、`created_at`、`updated_at`
- 当前用途：
  - `owner_type = data_source`
  - `owner_id = data_sources.id`

#### 5.2.2 `secret_items`

- 用途：单条 secret 存储
- 主键：`id`
- 唯一约束：`UNIQUE(bundle_id, secret_key)`
- 外键：`bundle_id -> secret_bundles(id) ON DELETE CASCADE`
- 字段：
  - `id`
  - `bundle_id`
  - `secret_key`
  - `cipher_text`
  - `algorithm`
  - `key_version`
  - `nonce`
  - `fingerprint`
  - `last_verified_at`
  - `rotated_at`
  - `expires_at`
  - `updated_at`
- 当前实现说明：
  - `cipher_text` 当前阶段实际保存**可逆明文**
  - `algorithm` 固定写入 `plain-text/v1`
  - `nonce` 为空字符串
  - `fingerprint` 为轻量长度指纹，不是加密摘要

#### 5.2.3 `secret_access_audit`

- 用途：记录 secret 读取与变更审计
- 主键：`id INTEGER AUTOINCREMENT`
- 字段：
  - `id`
  - `bundle_id`
  - `secret_item_id`
  - `action`
  - `trigger_source`
  - `success`
  - `message`
  - `correlation_id`
  - `detail_json`
  - `created_at`
- 当前已使用场景：
  - 设置页编辑数据源时读取明文 secret

### 5.3 `metadata` 域

#### 5.3.1 `source_objects`

- 用途：对象/表目录主表
- 复合主键：`(source_id, object_name)`
- 外键：`source_id -> data_sources(id) ON DELETE CASCADE`
- 字段：
  - `source_id`
  - `object_name`
  - `label`
  - `comment`
  - `queryable`
  - `createable`
  - `updateable`
  - `deletable`
  - `schema_version`
  - `snapshot_version`
  - `identity_hash`
  - `refresh_reason`
  - `updated_at`
- 当前用途：
  - Salesforce 对象列表缓存
  - MySQL 表/视图目录缓存

#### 5.3.2 `source_object_fields`

- 用途：字段级结构化元数据
- 复合主键：`(source_id, object_name, field_name)`
- 外键：`(source_id, object_name) -> source_objects`
- 字段：
  - `source_id`
  - `object_name`
  - `field_name`
  - `label`
  - `data_type`
  - `nillable`
  - `updateable`
  - `createable`
  - `metadata_json`
  - `sort_order`

#### 5.3.3 `source_object_relations`

- 用途：对象关系元数据
- 复合主键：`(source_id, object_name, relation_name)`
- 外键：`(source_id, object_name) -> source_objects`
- 字段：
  - `source_id`
  - `object_name`
  - `relation_name`
  - `child_sobject`
  - `field_name`
  - `relationship_name`
  - `deprecated_and_hidden`
  - `relation_type`
  - `sort_order`

#### 5.3.4 `source_object_indexes`

- 用途：索引结构化表
- 复合主键：`(source_id, object_name, index_name)`
- 字段：`source_id`、`object_name`、`index_name`、`payload_json`、`sort_order`
- 当前状态：**仅建表，当前 repo/service 未写入也未读取**

#### 5.3.5 `source_object_constraints`

- 用途：约束结构化表
- 复合主键：`(source_id, object_name, constraint_name)`
- 字段：`source_id`、`object_name`、`constraint_name`、`payload_json`、`sort_order`
- 当前状态：**仅建表，当前 repo/service 未写入也未读取**

#### 5.3.6 `source_metadata_blobs`

- 用途：保存 describe 等原始载荷快照
- 主键：`id`
- 外键：`source_id -> data_sources(id) ON DELETE CASCADE`
- 字段：
  - `id`
  - `source_id`
  - `object_name`
  - `blob_type`
  - `payload_json`
  - `schema_version`
  - `snapshot_version`
  - `created_at`
- 当前已使用类型：
  - `describe`

#### 5.3.7 `source_object_ddls`

- 用途：保存 DDL 聚合结果
- 复合主键：`(source_id, object_name)`
- 外键：`(source_id, object_name) -> source_objects`
- 字段：
  - `source_id`
  - `object_name`
  - `create_table_ddl`
  - `index_ddls_json`
  - `constraint_ddls_json`
  - `updated_at`
- 当前用途：MySQL `SHOW CREATE TABLE` 与索引/约束 DDL 缓存

#### 5.3.8 `query_column_visibility`

- 用途：保存对象字段列显隐配置
- 复合主键：`(source_id, object_name)`
- 外键：`source_id -> data_sources(id) ON DELETE CASCADE`
- 字段：`source_id`、`object_name`、`payload_json`、`updated_at`
- 当前用途：Query 结果表头显隐恢复

### 5.4 `workspace` 域

#### 5.4.1 `workspace_tabs`

- 用途：统一保存 Query / Console / Tool / Terminal 标签主模型
- 主键：`tab_id`
- 字段：
  - `tab_id`
  - `tab_kind`
  - `title`
  - `source_id`
  - `sort_order`
  - `is_active`
  - `payload_json`
  - `updated_at`
- 当前实现说明：
  - 使用 `payload_json` 承接扩展字段
  - 尚未拆出设计稿中的 `binding_key`、`status`、`created_at`

#### 5.4.2 `workspace_ui_state`

- 用途：保存轻量 UI 扩展状态
- 主键：`state_key`
- 字段：`state_key`、`value_json`、`updated_at`
- 当前已使用 key：
  - `app.selectedSourceId`
  - `app.viewMode`
  - `app.soqlSidebarWidth`
  - `app.activeTabObjectName`
  - `query.workspaceTabOrder`
  - `query.sourceTreeUiState`
  - `terminal.tabOrder`
  - `terminal.activeTabId`
  - `tool.jsonFormatter.tabOrder`
  - `tool.jsonFormatter.activeTabId`
  - `tool.jsonDiff.tabOrder`
  - `tool.jsonDiff.activeTabId`
  - `tool.textDiff.tabOrder`
  - `tool.textDiff.activeTabId`
- 当前实现说明：
  - 这是当前代码对设计稿 `workspace_tab_views` 的部分替代
  - 仍承担部分通用 UI 状态回写

#### 5.4.3 `query_tab_state`

- 用途：保存 Query tab 业务上下文
- 主键：`tab_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：
  - `tab_id`
  - `binding_key`
  - `source_id`
  - `source_type`
  - `source_name`
  - `source_color`
  - `object_name`
  - `label`
  - `describe_json`
  - `where_clause`
  - `limit_value`
  - `sort_field`
  - `sort_direction`
  - `sort_clause`
  - `current_soql`
  - `soql_draft`
  - `show_query_bar`
  - `show_drawer`
  - `drawer_view`
  - `show_logs`
  - `column_visibility_json`
  - `notice_json`
  - `updated_at`
- 当前实现说明：
  - 比设计稿多保存了 `source_type/source_name/source_color/label/describe_json/notice_json`
  - 还未收敛为纯查询上下文最小模型

#### 5.4.4 `query_result_sets`

- 用途：保存 Query 结果集快照
- 主键：`result_set_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：`result_set_id`、`tab_id`、`result_status`、`total_size`、`records_json`、`updated_at`
- 当前状态值：`fresh / stale / invalid` 中已实际使用 `stale`
- 当前实现差异：
  - 未保存 `source_id`
  - 未保存 `object_name`
  - 未保存 `columns_json`
  - 未保存 `baseline_records_json`
  - 未保存 `expires_at`
  - 未保存 `invalid_reason`

#### 5.4.5 `query_row_drafts`

- 用途：保存 Query 表格编辑恢复状态
- 主键：`tab_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：
  - `tab_id`
  - `selected_record_ids_json`
  - `pending_delete_record_ids_json`
  - `dirty_cell_keys_json`
  - `baseline_records_json`
  - `updated_at`
- 当前实现差异：
  - 当前是一条 `tab_id` 级聚合记录
  - 设计稿中的 `result_set_id`、`row_stable_id`、`draft_kind`、`row_locator_json` 尚未落地

#### 5.4.6 `console_tab_state`

- 用途：保存 Console/SOQL 执行器状态
- 主键：`tab_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：
  - `tab_id`
  - `source_id`
  - `source_type`
  - `source_name`
  - `source_color`
  - `name`
  - `soql_draft`
  - `selected_soql_text`
  - `result_json`
  - `notice_json`
  - `logs_json`
  - `selected_record_ids_json`
  - `show_bottom_panel`
  - `ai_conversation_id`
  - `ai_prompt_draft`
  - `ai_messages_json`
  - `ai_mode`
  - `updated_at`
- 当前实现说明：
  - 比设计稿保留了更多 UI 层数据
  - `logs_json` 当前放在本表中，未拆到 `tab_logs`

#### 5.4.7 `tool_tab_state`

- 用途：保存 JSON Formatter / JSON Diff / Text Diff 标签状态
- 主键：`tab_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：`tab_id`、`tool_kind`、`name`、`payload_json`、`updated_at`

#### 5.4.8 `terminal_tab_state`

- 用途：保存终端标签的可恢复 UI 状态
- 主键：`tab_id`
- 外键：`tab_id -> workspace_tabs(tab_id) ON DELETE CASCADE`
- 字段：`tab_id`、`name`、`input_draft`、`outputs_json`、`updated_at`
- 当前实现说明：
  - 只保存输入草稿与输出快照
  - 不保存 PTY、PID、会话连接等运行态

### 5.5 `diagnostics` 域

#### 5.5.1 `system_logs`

- 用途：结构化系统日志
- 主键：`id INTEGER AUTOINCREMENT`
- 字段：
  - `id`
  - `created_at`
  - `level`
  - `category`
  - `action`
  - `source_id`
  - `workspace_tab_id`
  - `target`
  - `success`
  - `message`
  - `detail_text`
  - `detail_json`
  - `correlation_id`
  - `retention_policy`
  - `expires_at`
- 当前索引：`idx_system_logs_created_at(created_at DESC, id DESC)`

#### 5.5.2 `migration_logs`

- 用途：预留迁移日志
- 主键：`id INTEGER AUTOINCREMENT`
- 字段：`id`、`migration_id`、`status`、`detail_json`、`created_at`
- 当前状态：**已建表，当前代码未见正式写入链路**

### 5.6 `automation` 域

#### 5.6.1 `terminal_command_groups`

- 用途：终端命令组
- 主键：`id`
- 字段：`id`、`name`、`sort_order`、`created_at`、`updated_at`
- 当前索引：`idx_terminal_command_groups_sort(sort_order, id)`

#### 5.6.2 `terminal_commands`

- 用途：终端命令模板
- 主键：`id`
- 外键：`group_id -> terminal_command_groups(id) ON DELETE CASCADE`
- 字段：
  - `id`
  - `group_id`
  - `name`
  - `command_text`
  - `description`
  - `sort_order`
  - `created_at`
  - `updated_at`
- 当前索引：`idx_terminal_commands_group(group_id, sort_order, id)`

## 6. 当前主要读写链路

### 6.1 数据源与 secrets

- `SourceService.create_source/update_source/upsert_source_with_id`
  - 普通配置写入 `data_sources`
  - 凭据写入 `secret_bundles + secret_items`
- 公共 DTO 不返回明文 `accessToken/password`
- 运行时 provider 读取时，secret 会按需注回：
  - Salesforce：注入 `accessToken`
  - MySQL：注入 `config_json.password`
- 设置页编辑时可通过 `get_source_secret_view` 显式读取明文

### 6.2 元数据

- 对象目录写入 `source_objects`
- 字段写入 `source_object_fields`
- 子关系写入 `source_object_relations`
- describe 原始载荷写入 `source_metadata_blobs`
- DDL 写入 `source_object_ddls`
- 字段显隐写入 `query_column_visibility`

### 6.3 工作区恢复

- 前端多个 Zustand store 不再直接按 `ui.* -> sqlite key/value` 黑盒保存
- 前端统一组装 `WorkspaceSnapshotDto`
- 后端保存时会：
  - 先清空全部 workspace 相关表
  - 再整包重写 `workspace_tabs`、`query_tab_state`、`query_result_sets`、`query_row_drafts`、`console_tab_state`、`tool_tab_state`、`terminal_tab_state`、`workspace_ui_state`
- 这意味着当前工作区持久化模型是**整包覆盖式快照**

### 6.4 诊断与自动化

- secret 明文读取会写入 `secret_access_audit`
- 诊断服务可同步写入 `system_logs`
- 终端命令组与命令模板通过 `automation_repo` 管理

## 7. 与设计稿的主要差异

### 7.1 已落地并与设计基本一致

- `schema_meta`
- `app_settings`
- `data_sources`
- `secret_bundles`
- `secret_items`
- `secret_access_audit`
- `source_objects`
- `source_object_fields`
- `source_object_relations`
- `source_metadata_blobs`
- `source_object_ddls`
- `system_logs`
- `terminal_command_groups`
- `terminal_commands`
- 启动切库、WAL、事务入口、Storage 边界

### 7.2 已落地但仍是过渡实现

- `workspace_ui_state`
  - 设计目标更偏向轻量视图态与受控键集合
  - 当前仍承担多个通用 UI key 的恢复
- `workspace_tabs`
  - 当前依赖 `payload_json`
  - 尚未完全结构化
- `query_result_sets`
  - 结果集字段偏少，缺少 TTL、兼容性与列快照信息
- `query_row_drafts`
  - 仍是 tab 级聚合，不是行级草稿模型
- `console_tab_state`
  - 仍混入日志与较多 UI 态
- `secret_items`
  - 逻辑上已分域，但数据仍是 `plain-text/v1`

### 7.3 设计稿提出但当前未落地

- `workspace_tab_views`
- `tab_logs`
- `background_jobs`
- `saved_queries`
- `source_object_indexes` 的正式读写链路
- `source_object_constraints` 的正式读写链路
- 更完整的清理策略与 TTL 字段
- 更完整的数据库级索引集合

## 8. 当前实现风险与后续建议

### 8.1 高优先级风险

- `secret_items` 目前只是“分域保存”，并非真正加密保存
- `data_sources.secret_bundle_id` 未加数据库级外键约束
- workspace 快照采用“全量删除后重写”，未来在大状态下会放大写放大与冲突风险
- `source_object_indexes`、`source_object_constraints` 已建表但未接线，容易造成“看上去支持、实际未生效”的认知偏差

### 8.2 建议下一步补齐

- 为 `data_sources.secret_bundle_id` 增加正式外键约束
- 将 `query_result_sets` 扩充为设计稿中的完整结果集模型
- 将 `query_row_drafts` 从 tab 级聚合升级为行级草稿模型
- 引入 `workspace_tab_views` 或等价结构化视图表，进一步缩减 `workspace_ui_state`
- 补齐 `tab_logs`、`saved_queries`、`background_jobs`
- 为元数据、workspace、secret 审计补齐设计稿中的关键索引
- 将 `secret_items` 从 `plain-text/v1` 升级到正式加密方案

## 9. 结论

当前仓库中的 SQLite v2 已完成“按领域拆表”和“后端存储边界收口”的主干工作，已经不是设计草案阶段；但工作区恢复、结果集模型、索引/约束结构化、日志分层与 secret 加密仍处于**半落地到过渡态**之间。

因此，当前最准确的数据库结论应表述为：

- **数据库分域架构已落地**
- **核心表已可支撑现有前端功能**
- **部分表仍是面向最终模型的过渡版本**
- **设计稿中的若干目标表与清理/索引策略尚未全部实现**
