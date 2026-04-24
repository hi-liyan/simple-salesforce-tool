# SQLite v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前以 `src-tauri/src/db.rs` 和前端 `ui.* -> JSON` 黑盒快照为中心的 SQLite v1，重构为按 `config / secrets / metadata / workspace / diagnostics / automation` 六大领域拆分的 SQLite v2，同时保持前端现有功能与交互效果不降级。

**Architecture:** 后端新增 `storage + services + commands` 三层边界，`Storage` 负责切库、PRAGMA、schema 初始化与事务入口，`repo` 负责单领域 CRUD，`service` 负责跨表编排。前端不再把 Query / Console / Tool / Terminal 的完整运行态整体塞进 `app_settings`，而是改为通过结构化 workspace DTO 启动恢复与按需回写；设置页编辑数据源时继续允许读取完整 secret 明文，但 secret 只保存在 `secrets` 域。

**Tech Stack:** Rust 2021、Tauri 2、rusqlite、chrono、uuid、React 18、TypeScript、Zustand persist、Node test runner

---

## 实施状态（2026-04-24）

- 已落地：新增 `storage/` 与 `services/` 骨架，v2 schema / bootstrap / PRAGMA 已进入代码；数据源与 secret 已分域建模，并补了 `get_source`、`get_source_secret_view`、`load_workspace_snapshot`、`save_workspace_snapshot` 命令入口。
- 已落地：前端 `tauriStorage` 已改为通过结构化 workspace snapshot 读写，新增 [`tests/query-panel/workspaceSnapshot.test.ts`](/mnt/d/test-workspace/simple-salesforce-tool/tests/query-panel/workspaceSnapshot.test.ts) 锁定多 store 恢复映射；`node --test --experimental-strip-types tests/query-panel/workspaceSnapshot.test.ts tests/query-panel/startupPersistence.test.ts tests/query-panel/terminalStoreIsolation.test.ts` 已通过。
- 已落地：设置页编辑链路已切到 `getSourceSecretView`，MySQL / Salesforce 编辑表单与颜色更新链路会显式回填并保留 secret 明文。
- 待收尾：`AppState/main.rs` 仍保留旧 `db` 入口，`db.rs` 当前是 v2 兼容适配层，尚未完成计划中的最终移除；通用 `get_ui_state/save_ui_state` 已删除，但旧 `db.rs` 兼容层尚在。
- 已验证：`cargo test --manifest-path src-tauri/Cargo.toml`、`npm run test:query-panel`、`npm run test:datagrid-utils`、`npm run build` 均已通过。

### Task 1: 建立 SQLite v2 启动边界与切库 bootstrap

**Files:**
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/bootstrap.rs`
- Create: `src-tauri/src/storage/schema.rs`
- Create: `src-tauri/src/storage/pragma.rs`
- Create: `src-tauri/src/storage/tx.rs`
- Modify: `src-tauri/src/app_state.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/error.rs`

- [ ] **Step 1: 先写失败测试，锁定“检测 v1 -> 归档旧库 -> 创建 v2 新库”的行为**

```rust
#[cfg(test)]
mod tests {
    use super::open_or_bootstrap_storage;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn archives_v1_database_and_bootstraps_v2_schema() {
        let root = std::env::temp_dir().join(format!("sqlite-v2-bootstrap-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let legacy_db_path = root.join("app.db");

        let legacy = Connection::open(&legacy_db_path).unwrap();
        legacy
            .execute_batch(
                r#"
                CREATE TABLE data_sources (
                    id TEXT PRIMARY KEY,
                    access_token TEXT NOT NULL
                );
                CREATE TABLE salesforce_sources (
                    id TEXT PRIMARY KEY,
                    access_token TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        drop(legacy);

        let storage = open_or_bootstrap_storage(&root).unwrap();
        let archived = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().starts_with("app.v1.backup."));

        assert!(archived, "应先把旧库归档为 app.v1.backup.<timestamp>.db");
        let version: String = storage.read(|conn| {
            conn.query_row(
                "SELECT value_json FROM schema_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
        }).unwrap();
        assert!(version.contains("\"2\""), "v2 新库必须写入 schema_meta");
    }
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::bootstrap::tests::archives_v1_database_and_bootstraps_v2_schema -- --exact`
Expected: FAIL with `module storage not found` or `schema_meta: no such table`

- [ ] **Step 3: 实现 Storage、PRAGMA 与 schema 初始化骨架**

```rust
// src-tauri/src/storage/mod.rs
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Storage {
    // 行内注释：v2 第一阶段继续单连接，但所有读写都必须先过 Storage 边界。
    connection: Mutex<Connection>,
    db_path: PathBuf,
}

impl Storage {
    pub fn open_or_bootstrap(data_dir: &Path) -> Result<Self, crate::error::AppError> {
        let db_path = bootstrap::open_or_bootstrap_storage(data_dir)?;
        let connection = Connection::open(&db_path)?;
        pragma::apply_pragmas(&connection)?;
        schema::init_v2_schema(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            db_path,
        })
    }

    pub fn read<T, F>(&self, reader: F) -> Result<T, crate::error::AppError>
    where
        F: FnOnce(&Connection) -> rusqlite::Result<T>,
    {
        let connection = self.connection.lock().unwrap();
        Ok(reader(&connection)?)
    }
}
```

- [ ] **Step 4: 把 `AppState` 与 `main.rs` 接到新 Storage**

```rust
// src-tauri/src/app_state.rs
pub struct AppState {
    /// SQLite v2 存储入口：后续 commands 只能通过它访问本地库。
    pub storage: crate::storage::Storage,
    pub sf_client: SalesforceClient,
    pub cli_login_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub llm_conversations: Mutex<HashMap<String, Vec<LlmChatMessage>>>,
    pub llm_stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub terminal_sessions: Mutex<HashMap<String, TerminalSession>>,
}

// src-tauri/src/main.rs
mod storage;

let storage = storage::Storage::open_or_bootstrap(&data_dir).map_err(|error| {
    std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
})?;

app.manage(AppState {
    storage,
    sf_client: SalesforceClient::new(),
    cli_login_cancel: Mutex::new(None),
    llm_conversations: Mutex::new(HashMap::new()),
    llm_stream_cancels: Mutex::new(HashMap::new()),
    terminal_sessions: Mutex::new(HashMap::new()),
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::bootstrap::tests::archives_v1_database_and_bootstraps_v2_schema -- --exact`
Expected: PASS

- [ ] **Step 6: 提交基础设施骨架**

```bash
git add src-tauri/src/storage src-tauri/src/app_state.rs src-tauri/src/main.rs src-tauri/src/error.rs
git commit -m "feat(storage): 建立 sqlite v2 启动与切库边界"
```

### Task 2: 拆出配置域、数据源域与 secrets 域

**Files:**
- Create: `src-tauri/src/storage/config_repo.rs`
- Create: `src-tauri/src/storage/source_repo.rs`
- Create: `src-tauri/src/storage/secret_repo.rs`
- Create: `src-tauri/src/services/mod.rs`
- Create: `src-tauri/src/services/source_service.rs`
- Create: `src-tauri/src/services/secret_service.rs`
- Modify: `src-tauri/src/storage/schema.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 写失败测试，覆盖“配置与 secret 分表”以及“设置页可回填完整 secret 明文”**

```rust
#[test]
fn upsert_source_persists_secret_in_secret_items_and_can_read_plaintext_for_edit() {
    let storage = test_storage();
    let service = SourceService::new(&storage);

    let created = service.create_source(SourceUpsertRequest {
        name: "Prod".into(),
        source_type: "salesforce".into(),
        environment: "default".into(),
        color: "#2563EB".into(),
        config: serde_json::json!({
            "instanceUrl": "https://example.my.salesforce.com",
            "apiVersion": "v61.0"
        }),
        secrets: SourceSecretInput {
            access_token: "secret-token".into(),
        },
    }).unwrap();

    let list_item = service.get_source(created.id.as_str()).unwrap();
    assert_eq!(list_item.access_token, "", "普通 DTO 不应再直接返回明文 token");

    let edit_view = service.get_source_secret_view(created.id.as_str()).unwrap();
    assert_eq!(edit_view.access_token, "secret-token", "设置页编辑链路必须能显式拿到完整明文");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::source_service::tests::upsert_source_persists_secret_in_secret_items_and_can_read_plaintext_for_edit -- --exact`
Expected: FAIL with `SourceService not found` or `secret_bundles: no such table`

- [ ] **Step 3: 实现 config/source/secret repo 与事务化 service**

```rust
// src-tauri/src/services/source_service.rs
pub struct SourceService<'a> {
    storage: &'a Storage,
}

impl<'a> SourceService<'a> {
    pub fn create_source(&self, request: SourceUpsertRequest) -> Result<SourceDto, AppError> {
        self.storage.write_tx(|tx| {
            // 行内注释：先写 bundle，再写 source，保证普通表中只保留 secret_bundle_id。
            let bundle_id = secret_repo::upsert_source_secret_bundle(tx, &request)?;
            let record = source_repo::insert_source(tx, &request, Some(bundle_id.as_str()))?;
            Ok(record.into())
        })
    }
}

// src-tauri/src/models.rs
pub struct SourceDto {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub environment: String,
    pub color: String,
    pub config_json: Value,
    pub secret_bundle_id: Option<String>,
}

pub struct SourceSecretView {
    pub source_id: String,
    pub access_token: String,
}
```

- [ ] **Step 4: 切换 create/list/update/delete source commands 到新 service**

```rust
#[tauri::command]
pub fn get_source_secret_view(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SourceSecretView, String> {
    let service = SourceService::new(&state.storage);
    service
        .get_source_secret_view(&source_id)
        .map_err(AppError::to_string_error)
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::source_service::tests::upsert_source_persists_secret_in_secret_items_and_can_read_plaintext_for_edit -- --exact`
Expected: PASS

- [ ] **Step 6: 提交 config/source/secrets 切分**

```bash
git add src-tauri/src/storage/config_repo.rs src-tauri/src/storage/source_repo.rs src-tauri/src/storage/secret_repo.rs src-tauri/src/services src-tauri/src/storage/schema.rs src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(storage): 拆分配置数据源与密钥领域"
```

### Task 3: 用结构化 metadata 表替代 legacy cache 表

**Files:**
- Create: `src-tauri/src/storage/metadata_repo.rs`
- Create: `src-tauri/src/services/metadata_service.rs`
- Modify: `src-tauri/src/storage/schema.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/providers/mod.rs`

- [ ] **Step 1: 写失败测试，锁定对象快照、字段、索引、关系与 blob 的统一落库行为**

```rust
#[test]
fn replace_object_snapshot_writes_structured_metadata_and_blob_history() {
    let storage = test_storage();
    let service = MetadataService::new(&storage);

    service.replace_object_snapshot(MetadataSnapshotUpsert {
        source_id: "sf-1".into(),
        object_name: "Account".into(),
        schema_version: 3,
        snapshot_version: 7,
        identity_hash: "hash-v3".into(),
        refresh_reason: "manual-refresh".into(),
        object: SourceObjectRecord::salesforce("Account", "客户"),
        fields: vec![SourceObjectFieldRecord::text("Account", "Name", 1)],
        indexes: vec![],
        constraints: vec![],
        relations: vec![],
        blobs: vec![SourceMetadataBlobRecord::describe("Account", "{\"name\":\"Account\"}")],
    }).unwrap();

    let snapshot = service.get_object_snapshot("sf-1", "Account").unwrap().unwrap();
    assert_eq!(snapshot.object.schema_version, 3);
    assert_eq!(snapshot.fields.len(), 1);
    assert_eq!(snapshot.blobs.len(), 1);
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::metadata_service::tests::replace_object_snapshot_writes_structured_metadata_and_blob_history -- --exact`
Expected: FAIL with `source_objects: no such table`

- [ ] **Step 3: 实现 metadata repo 与版本/TTL 语义**

```rust
pub fn replace_object_snapshot(
    tx: &rusqlite::Transaction<'_>,
    payload: &MetadataSnapshotUpsert,
) -> Result<(), AppError> {
    // 行内注释：先删同对象旧快照，再一次性重建结构化字段，避免读路径再做修复副作用。
    delete_object_snapshot(tx, &payload.source_id, &payload.object_name)?;
    upsert_source_object(tx, &payload.object)?;
    replace_source_object_fields(tx, &payload.fields)?;
    replace_source_object_indexes(tx, &payload.indexes)?;
    replace_source_object_constraints(tx, &payload.constraints)?;
    replace_source_object_relations(tx, &payload.relations)?;
    insert_source_metadata_blobs(tx, &payload.blobs)?;
    Ok(())
}
```

- [ ] **Step 4: 把 `list_objects / describe_object / get_object_ddl / resolve_field_child_relationship_name` 改走 metadata service**

```rust
#[tauri::command]
pub fn describe_object(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<ObjectDescribe, String> {
    let service = MetadataService::new(&state.storage, &state.sf_client);
    service
        .describe_object(&source_id, &object_name)
        .map_err(AppError::to_string_error)
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::metadata_service::tests::replace_object_snapshot_writes_structured_metadata_and_blob_history -- --exact`
Expected: PASS

- [ ] **Step 6: 提交 metadata 结构化缓存**

```bash
git add src-tauri/src/storage/metadata_repo.rs src-tauri/src/services/metadata_service.rs src-tauri/src/storage/schema.rs src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/providers/mod.rs
git commit -m "feat(metadata): 建立结构化元数据缓存与版本语义"
```

### Task 4: 建立 workspace 域与 Query/Console/Tool/Terminal 结构化恢复模型

**Files:**
- Create: `src-tauri/src/storage/workspace_repo.rs`
- Create: `src-tauri/src/services/workspace_service.rs`
- Modify: `src-tauri/src/storage/schema.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 写失败测试，覆盖 `fresh / stale / invalid` 与 tab 分层恢复**

```rust
#[test]
fn load_workspace_snapshot_marks_result_sets_with_restore_status() {
    let storage = test_storage();
    let service = WorkspaceService::new(&storage);

    service.save_workspace_snapshot(WorkspaceSnapshotDto {
        tabs: vec![WorkspaceTabDto::query("tab-1", "Account", "sf-1")],
        query_tabs: vec![QueryTabStateDto::seed("tab-1", "sf-1", "Account")],
        query_results: vec![QueryResultSetDto::stale_seed("result-1", "tab-1", "sf-1", "Account")],
        query_row_drafts: vec![],
        console_tabs: vec![],
        tool_tabs: vec![],
        terminal_tabs: vec![],
    }).unwrap();

    let snapshot = service.load_workspace_snapshot().unwrap();
    assert_eq!(snapshot.query_results[0].result_status, "stale");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::workspace_service::tests::load_workspace_snapshot_marks_result_sets_with_restore_status -- --exact`
Expected: FAIL with `workspace_tabs: no such table`

- [ ] **Step 3: 实现 workspace repo、结果集状态与草稿恢复语义**

```rust
pub struct WorkspaceSnapshotDto {
    pub tabs: Vec<WorkspaceTabDto>,
    pub query_tabs: Vec<QueryTabStateDto>,
    pub query_results: Vec<QueryResultSetDto>,
    pub query_row_drafts: Vec<QueryRowDraftDto>,
    pub console_tabs: Vec<ConsoleTabStateDto>,
    pub tool_tabs: Vec<ToolTabStateDto>,
    pub terminal_tabs: Vec<TerminalTabStateDto>,
}

pub fn save_workspace_snapshot(
    tx: &rusqlite::Transaction<'_>,
    snapshot: &WorkspaceSnapshotDto,
) -> Result<(), AppError> {
    replace_workspace_tabs(tx, &snapshot.tabs)?;
    replace_query_tab_state(tx, &snapshot.query_tabs)?;
    replace_query_result_sets(tx, &snapshot.query_results)?;
    replace_query_row_drafts(tx, &snapshot.query_row_drafts)?;
    replace_console_tab_state(tx, &snapshot.console_tabs)?;
    replace_tool_tab_state(tx, &snapshot.tool_tabs)?;
    replace_terminal_tab_state(tx, &snapshot.terminal_tabs)?;
    Ok(())
}
```

- [ ] **Step 4: 新增结构化 workspace commands，替代黑盒 `save_ui_state/get_ui_state` 的主要职责**

```rust
#[tauri::command]
pub fn load_workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshotDto, String> {
    let service = WorkspaceService::new(&state.storage);
    service.load_workspace_snapshot().map_err(AppError::to_string_error)
}

#[tauri::command]
pub fn save_workspace_snapshot(
    state: State<'_, AppState>,
    payload: WorkspaceSnapshotDto,
) -> Result<(), String> {
    let service = WorkspaceService::new(&state.storage);
    service.save_workspace_snapshot(payload).map_err(AppError::to_string_error)
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::workspace_service::tests::load_workspace_snapshot_marks_result_sets_with_restore_status -- --exact`
Expected: PASS

- [ ] **Step 6: 提交 workspace 域**

```bash
git add src-tauri/src/storage/workspace_repo.rs src-tauri/src/services/workspace_service.rs src-tauri/src/storage/schema.rs src-tauri/src/models.rs src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat(workspace): 建立结构化工作区恢复模型"
```

### Task 5: 补齐 diagnostics 与 automation 域

**Files:**
- Create: `src-tauri/src/storage/log_repo.rs`
- Create: `src-tauri/src/storage/automation_repo.rs`
- Create: `src-tauri/src/services/diagnostic_service.rs`
- Modify: `src-tauri/src/storage/schema.rs`
- Modify: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/commands.rs`

- [ ] **Step 1: 写失败测试，覆盖 secret 明文读取审计与系统日志结构化 detail**

```rust
#[test]
fn reading_secret_for_edit_writes_secret_access_audit_and_redacts_system_log() {
    let storage = test_storage();
    let diagnostic = DiagnosticService::new(&storage);

    diagnostic.record_secret_read(SecretAuditRecord {
        bundle_id: "bundle-1".into(),
        secret_item_id: Some("item-1".into()),
        action: "read_plaintext_for_edit".into(),
        trigger_source: "settings.edit-source".into(),
        success: true,
        message: "允许设置页显式读取 secret 明文".into(),
    }).unwrap();

    let audits = diagnostic.list_secret_audits("bundle-1").unwrap();
    assert_eq!(audits.len(), 1);
    assert!(!audits[0].message.contains("secret-token"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::diagnostic_service::tests::reading_secret_for_edit_writes_secret_access_audit_and_redacts_system_log -- --exact`
Expected: FAIL with `secret_access_audit: no such table`

- [ ] **Step 3: 实现日志仓储、迁移日志、终端命令组与 saved queries**

```rust
pub fn insert_system_log(
    tx: &rusqlite::Transaction<'_>,
    log: &SystemLogRecord,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO system_logs (
            created_at, level, category, action, source_id, workspace_tab_id, target,
            success, message, detail_text, detail_json, correlation_id, retention_policy, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            log.created_at,
            log.level,
            log.category,
            log.action,
            log.source_id,
            log.workspace_tab_id,
            log.target,
            log.success,
            log.message,
            log.detail_text,
            log.detail_json,
            log.correlation_id,
            log.retention_policy,
            log.expires_at,
        ],
    )?;
    Ok(())
}
```

- [ ] **Step 4: 把 `list_system_logs`、终端命令组 CRUD、secret audit 写入接到新 repo/service**

```rust
#[tauri::command]
pub fn list_terminal_command_groups(state: State<'_, AppState>) -> Result<Vec<TerminalCommandGroup>, String> {
    state
        .storage
        .read(|conn| automation_repo::list_terminal_command_groups(conn))
        .map_err(AppError::to_string_error)
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml services::diagnostic_service::tests::reading_secret_for_edit_writes_secret_access_audit_and_redacts_system_log -- --exact`
Expected: PASS

- [ ] **Step 6: 提交 diagnostics / automation**

```bash
git add src-tauri/src/storage/log_repo.rs src-tauri/src/storage/automation_repo.rs src-tauri/src/services/diagnostic_service.rs src-tauri/src/storage/schema.rs src-tauri/src/models.rs src-tauri/src/commands.rs
git commit -m "feat(storage): 增加诊断日志与自动化领域"
```

### Task 6: 前端 API、类型与 store 持久化切到结构化 workspace DTO

**Files:**
- Create: `src/store/workspaceSnapshot.ts`
- Modify: `src/types/index.ts`
- Modify: `src/api/index.ts`
- Modify: `src/store/tauriStorage.ts`
- Modify: `src/store/queryTabHydration.ts`
- Modify: `src/store/queryTabPersistence.ts`
- Modify: `src/store/useAppStore.ts`
- Modify: `src/store/useSoqlExecutorStore.ts`
- Modify: `src/store/useTerminalStore.ts`
- Modify: `src/store/useJsonFormatterStore.ts`
- Modify: `src/store/useJsonDiffStore.ts`
- Modify: `src/store/useTextDiffStore.ts`
- Modify: `src/pages/mainPageStartup.ts`
- Create: `tests/query-panel/workspaceSnapshot.test.ts`

- [x] **Step 1: 写失败测试，锁定“后端 snapshot -> 多 store 恢复”的映射**

```ts
test("restoreWorkspaceSnapshot: 应按 query/console/tool/terminal 分层恢复，并重置运行态标记", () => {
  const restored = restoreWorkspaceSnapshot({
    tabs: [{ tabId: "tab-1", tabKind: "query", title: "Account", sourceId: "sf-1", sortOrder: 1, isActive: 1 }],
    queryTabs: [{ tabId: "tab-1", sourceId: "sf-1", objectName: "Account", queryDraft: "SELECT Id FROM Account", activeResultSetId: "rs-1" }],
    queryResults: [{ resultSetId: "rs-1", tabId: "tab-1", resultStatus: "fresh", recordsJson: [{ Id: "001" }] }],
    queryRowDrafts: [],
    consoleTabs: [],
    toolTabs: [],
    terminalTabs: []
  });

  assert.equal(restored.queryTabs[0].loading, false);
  assert.equal(restored.queryTabs[0].objectName, "Account");
  assert.equal(restored.queryTabs[0].result.totalSize, 1);
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/workspaceSnapshot.test.ts`
Expected: FAIL with `restoreWorkspaceSnapshot is not defined`

- [x] **Step 3: 增加前后端 DTO 类型与 snapshot 映射器**

```ts
// src/store/workspaceSnapshot.ts
export type WorkspaceSnapshotDto = {
  tabs: WorkspaceTabDto[];
  queryTabs: QueryTabStateDto[];
  queryResults: QueryResultSetDto[];
  queryRowDrafts: QueryRowDraftDto[];
  consoleTabs: ConsoleTabStateDto[];
  toolTabs: ToolTabStateDto[];
  terminalTabs: TerminalTabStateDto[];
};

export function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshotDto) {
  return {
    queryTabs: snapshot.queryTabs.map((tab) => hydrateTab({
      sourceId: tab.sourceId,
      objectName: tab.objectName,
      soqlDraft: tab.queryDraft,
      currentSoql: tab.queryText,
      loading: false,
    })),
  };
}
```

- [x] **Step 4: 把 `tauriStorage` 与各 store 从黑盒 key/value 迁到结构化 snapshot**

```ts
// src/api/index.ts
loadWorkspaceSnapshot: () => invokeApi<WorkspaceSnapshotDto>("load_workspace_snapshot"),
saveWorkspaceSnapshot: (payload: WorkspaceSnapshotDto) =>
  invokeApi<void>("save_workspace_snapshot", { payload }),

// src/store/tauriStorage.ts
export async function loadWorkspaceSnapshotFromBackend(): Promise<WorkspaceSnapshotDto | null> {
  try {
    return await api.loadWorkspaceSnapshot();
  } catch {
    return null;
  }
}
```

- [x] **Step 5: 运行测试确认通过**

Run: `node --test --experimental-strip-types tests/query-panel/workspaceSnapshot.test.ts tests/query-panel/startupPersistence.test.ts`
Expected: PASS

- [ ] **Step 6: 提交前端持久化切换**

```bash
git add src/store/workspaceSnapshot.ts src/types/index.ts src/api/index.ts src/store/tauriStorage.ts src/store/queryTabHydration.ts src/store/queryTabPersistence.ts src/store/useAppStore.ts src/store/useSoqlExecutorStore.ts src/store/useTerminalStore.ts src/store/useJsonFormatterStore.ts src/store/useJsonDiffStore.ts src/store/useTextDiffStore.ts src/pages/mainPageStartup.ts tests/query-panel/workspaceSnapshot.test.ts
git commit -m "feat(workspace): 前端切换到结构化恢复快照"
```

### Task 7: 接前端功能层，保持设置页 secret 明文编辑与工作区体验等效

**Files:**
- Modify: `src/features/main/SettingsPanel/index.tsx`
- Modify: `src/pages/MainPage.tsx`
- Modify: `src/features/main/QueryPanel/hooks/useMainPageQueryPanel.ts`
- Modify: `src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx`
- Modify: `src/features/main/TerminalPanel/index.tsx`
- Modify: `src/features/main/ToolsPanel/components/JsonFormatterTool.tsx`
- Modify: `src/features/main/ToolsPanel/components/JsonDiffTool.tsx`
- Modify: `src/features/main/ToolsPanel/components/TextDiffTool.tsx`
- Modify: `tests/query-panel/startupPersistence.test.ts`
- Modify: `tests/query-panel/terminalStoreIsolation.test.ts`

- [ ] **Step 1: 写失败测试，锁定“编辑数据源时可回填完整 secret，启动恢复不带回运行中态”**

```ts
test("startup hydration: 应恢复草稿与结果，但不恢复 loading/streaming/pty 运行态", () => {
  const restored = applyWorkspaceSnapshotToStores(seedSnapshot());
  assert.equal(restored.query.loading, false);
  assert.equal(restored.console.aiLoading, false);
  assert.equal(restored.terminal.runtimeSessions.length, 0);
});

test("settings source editor: 应回填完整 accessToken 明文到编辑表单", async () => {
  const form = buildSourceEditForm(await api.getSourceSecretView("sf-1"));
  assert.equal(form.accessToken, "secret-token");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test --experimental-strip-types tests/query-panel/startupPersistence.test.ts tests/query-panel/terminalStoreIsolation.test.ts`
Expected: FAIL with payload mismatch or missing API

- [ ] **Step 3: 接入新的 source secret view 与 workspace 启动恢复流程**

```ts
// src/features/main/SettingsPanel/index.tsx
async function beginEditSource(sourceId: string) {
  const [source, secretView] = await Promise.all([
    api.getSource(sourceId),
    api.getSourceSecretView(sourceId),
  ]);

  setSalesforceEditForm({
    name: source.name,
    instanceUrl: String(source.configJson.instanceUrl || ""),
    accessToken: secretView.accessToken,
    apiVersion: String(source.configJson.apiVersion || ""),
    color: source.color || "",
  });
}
```

- [ ] **Step 4: 让 MainPage 启动流程只恢复允许持久化的状态层**

```ts
const snapshot = await loadWorkspaceSnapshotFromBackend();
if (snapshot) {
  const restored = restoreWorkspaceSnapshot(snapshot);
  useAppStore.getState().setTabs(restored.queryTabs);
  useSoqlExecutorStore.getState().setTabs(restored.consoleTabs);
  useTerminalStore.getState().replacePersistedTabs(restored.terminalTabs);
  // 行内注释：PTY 会话、AI streaming、toast 等运行态统一从默认值开始。
}
```

- [x] **Step 5: 运行 QueryPanel 回归测试**

Run: `npm run test:query-panel`
Expected: PASS

- [ ] **Step 6: 提交前端功能接线**

```bash
git add src/features/main/SettingsPanel/index.tsx src/pages/MainPage.tsx src/features/main/QueryPanel/hooks/useMainPageQueryPanel.ts src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx src/features/main/TerminalPanel/index.tsx src/features/main/ToolsPanel/components/JsonFormatterTool.tsx src/features/main/ToolsPanel/components/JsonDiffTool.tsx src/features/main/ToolsPanel/components/TextDiffTool.tsx tests/query-panel/startupPersistence.test.ts tests/query-panel/terminalStoreIsolation.test.ts
git commit -m "feat(frontend): 接入 sqlite v2 恢复与密钥编辑链路"
```

### Task 8: 清理 legacy 入口并完成全量验证

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/src/commands.rs`
- Delete: `src-tauri/src/db.rs`
- Modify: `src/api/index.ts`
- Modify: `src/store/tauriStorage.ts`
- Modify: `src/pages/mainPageStartup.ts`
- Modify: `docs/sqlite-v2-design-2026-04-22.md`

- [ ] **Step 1: 写失败测试，确认 v2 初始化后不再存在 legacy 表与黑盒 UI state command**

```rust
#[test]
fn v2_schema_contains_no_legacy_tables() {
    let storage = test_storage();
    let tables = storage.read(|conn| {
        let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()
    }).unwrap();

    assert!(!tables.iter().any(|name| name == "salesforce_sources"));
    assert!(!tables.iter().any(|name| name == "object_metadata_cache"));
    assert!(!tables.iter().any(|name| name == "source_metadata_cache"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml v2_schema_contains_no_legacy_tables -- --exact`
Expected: FAIL while legacy schema or `db.rs` 仍被引用

- [ ] **Step 3: 删除 legacy `db.rs` 与 `get_ui_state/save_ui_state` 主路径，补最终文档说明**

```rust
// src-tauri/src/main.rs
tauri::generate_handler![
    commands::list_sources,
    commands::get_source_secret_view,
    commands::load_workspace_snapshot,
    commands::save_workspace_snapshot,
    commands::list_system_logs,
    commands::list_terminal_command_groups,
]
```

- [ ] **Step 4: 运行完整验证**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS

Run: `npm run test:query-panel`
Expected: PASS

Run: `npm run test:datagrid-utils`
Expected: PASS

Run: `npm run build`
Expected: PASS

- [ ] **Step 5: 提交最终清理**

```bash
git add src-tauri/src/main.rs src-tauri/src/commands.rs src/api/index.ts src/store/tauriStorage.ts src/pages/mainPageStartup.ts docs/sqlite-v2-design-2026-04-22.md
git rm src-tauri/src/db.rs
git commit -m "refactor(storage): 移除 sqlite v1 兼容层并完成切换"
```

## Self-Review

### Spec Coverage

- [ ] `第 3 / 11 / 12 / 13 / 14 章`：由 Task 1 落地 `Storage`、PRAGMA、schema bootstrap、切库与模块拆分入口。
- [ ] `第 6.1 / 6.2 / 9.1 / 9.3 / 15 章`：由 Task 2 落地 `config + secrets + source` 分域、secret 明文编辑读取策略。
- [ ] `第 6.3 / 8 / 16.6 / 16.10 章`：由 Task 3 落地结构化 metadata、版本语义、TTL 与读路径无副作用。
- [ ] `第 6.4 / 7 / 15 / 16.4 / 16.5 章`：由 Task 4、Task 6、Task 7 共同落地 workspace 恢复、Query 结果状态与草稿恢复。
- [ ] `第 6.5 / 6.6 / 9.4 / 10 / 16.7 章`：由 Task 5 落地 diagnostics、automation、日志分层与清理基础。
- [ ] `第 4.2 / 5 / 16.1 / 16.2 / 16.9 章`：由 Task 8 清掉 legacy 表、`db.rs` 与黑盒 UI state 入口。

### Placeholder Scan

- [ ] 已检查全文，没有 `TODO`、`TBD`、`适当处理`、`类似 Task N` 这类占位描述。

### Type Consistency

- [ ] 后端统一使用 `Storage`、`SourceService`、`MetadataService`、`WorkspaceService`、`DiagnosticService`。
- [ ] 结构化恢复统一使用 `WorkspaceSnapshotDto`、`QueryTabStateDto`、`QueryResultSetDto`、`ConsoleTabStateDto`、`ToolTabStateDto`、`TerminalTabStateDto`。
- [ ] 数据源密钥读取统一使用 `SourceSecretView`，避免后续任务又回退到 `SalesforceSource.access_token` 直出。
