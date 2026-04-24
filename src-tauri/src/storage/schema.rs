use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::AppError;

/// 初始化 SQLite v2 schema。
pub fn init_v2_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_meta (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'global',
            schema_version INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS data_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            environment TEXT NOT NULL DEFAULT 'default',
            color TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            config_json TEXT NOT NULL,
            secret_bundle_id TEXT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            archived_at TEXT NULL
        );

        CREATE TABLE IF NOT EXISTS source_tags (
            source_id TEXT NOT NULL,
            tag_key TEXT NOT NULL,
            tag_value TEXT NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY(source_id, tag_key, tag_value),
            FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS secret_bundles (
            id TEXT PRIMARY KEY,
            owner_type TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS secret_items (
            id TEXT PRIMARY KEY,
            bundle_id TEXT NOT NULL,
            secret_key TEXT NOT NULL,
            cipher_text TEXT NOT NULL,
            algorithm TEXT NOT NULL,
            key_version INTEGER NOT NULL,
            nonce TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            last_verified_at TEXT NULL,
            rotated_at TEXT NULL,
            expires_at TEXT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(bundle_id, secret_key),
            FOREIGN KEY(bundle_id) REFERENCES secret_bundles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS secret_access_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bundle_id TEXT NOT NULL,
            secret_item_id TEXT NULL,
            action TEXT NOT NULL,
            trigger_source TEXT NOT NULL,
            success INTEGER NOT NULL,
            message TEXT NOT NULL,
            correlation_id TEXT NOT NULL DEFAULT '',
            detail_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS source_objects (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            label TEXT NOT NULL,
            comment TEXT NULL,
            queryable INTEGER NOT NULL,
            createable INTEGER NOT NULL,
            updateable INTEGER NOT NULL,
            deletable INTEGER NOT NULL,
            schema_version INTEGER NOT NULL DEFAULT 1,
            snapshot_version INTEGER NOT NULL DEFAULT 1,
            identity_hash TEXT NOT NULL DEFAULT '',
            refresh_reason TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY(source_id, object_name),
            FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS source_object_fields (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            field_name TEXT NOT NULL,
            label TEXT NOT NULL,
            data_type TEXT NOT NULL,
            nillable INTEGER NOT NULL,
            updateable INTEGER NOT NULL,
            createable INTEGER NOT NULL,
            metadata_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, field_name),
            FOREIGN KEY(source_id, object_name) REFERENCES source_objects(source_id, object_name) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS source_object_relations (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            relation_name TEXT NOT NULL,
            child_sobject TEXT NOT NULL,
            field_name TEXT NOT NULL,
            relationship_name TEXT NOT NULL,
            deprecated_and_hidden INTEGER NOT NULL,
            relation_type TEXT NOT NULL DEFAULT 'child_relationship',
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, relation_name),
            FOREIGN KEY(source_id, object_name) REFERENCES source_objects(source_id, object_name) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS source_object_indexes (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            index_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, index_name)
        );

        CREATE TABLE IF NOT EXISTS source_object_constraints (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            constraint_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, constraint_name)
        );

        CREATE TABLE IF NOT EXISTS source_metadata_blobs (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            blob_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            schema_version INTEGER NOT NULL,
            snapshot_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS source_object_ddls (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            create_table_ddl TEXT NOT NULL,
            index_ddls_json TEXT NOT NULL,
            constraint_ddls_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(source_id, object_name),
            FOREIGN KEY(source_id, object_name) REFERENCES source_objects(source_id, object_name) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS query_column_visibility (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(source_id, object_name),
            FOREIGN KEY(source_id) REFERENCES data_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS workspace_tabs (
            tab_id TEXT PRIMARY KEY,
            tab_kind TEXT NOT NULL,
            title TEXT NOT NULL,
            source_id TEXT NULL,
            sort_order INTEGER NOT NULL,
            is_active INTEGER NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_ui_state (
            state_key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS query_tab_state (
            tab_id TEXT PRIMARY KEY,
            binding_key TEXT NOT NULL,
            source_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_name TEXT NOT NULL,
            source_color TEXT NOT NULL,
            object_name TEXT NOT NULL,
            label TEXT NOT NULL,
            describe_json TEXT NULL,
            where_clause TEXT NOT NULL,
            limit_value INTEGER NOT NULL,
            sort_field TEXT NOT NULL,
            sort_direction TEXT NOT NULL,
            sort_clause TEXT NOT NULL,
            current_soql TEXT NOT NULL,
            soql_draft TEXT NOT NULL,
            show_query_bar INTEGER NOT NULL,
            show_drawer INTEGER NOT NULL,
            drawer_view TEXT NOT NULL,
            show_logs INTEGER NOT NULL,
            column_visibility_json TEXT NOT NULL,
            notice_json TEXT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS query_result_sets (
            result_set_id TEXT PRIMARY KEY,
            tab_id TEXT NOT NULL,
            result_status TEXT NOT NULL,
            total_size INTEGER NOT NULL,
            records_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS query_row_drafts (
            tab_id TEXT PRIMARY KEY,
            selected_record_ids_json TEXT NOT NULL,
            pending_delete_record_ids_json TEXT NOT NULL,
            dirty_cell_keys_json TEXT NOT NULL,
            baseline_records_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS console_tab_state (
            tab_id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            source_name TEXT NOT NULL,
            source_color TEXT NOT NULL,
            name TEXT NOT NULL,
            soql_draft TEXT NOT NULL,
            selected_soql_text TEXT NOT NULL,
            result_json TEXT NOT NULL,
            notice_json TEXT NULL,
            logs_json TEXT NOT NULL,
            selected_record_ids_json TEXT NOT NULL,
            show_bottom_panel INTEGER NOT NULL,
            ai_conversation_id TEXT NOT NULL,
            ai_prompt_draft TEXT NOT NULL,
            ai_messages_json TEXT NOT NULL,
            ai_mode INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tool_tab_state (
            tab_id TEXT PRIMARY KEY,
            tool_kind TEXT NOT NULL,
            name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS terminal_tab_state (
            tab_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            input_draft TEXT NOT NULL,
            outputs_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(tab_id) REFERENCES workspace_tabs(tab_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            level TEXT NOT NULL,
            category TEXT NOT NULL,
            action TEXT NOT NULL,
            source_id TEXT NULL,
            workspace_tab_id TEXT NULL,
            target TEXT NULL,
            success INTEGER NOT NULL,
            message TEXT NOT NULL,
            detail_text TEXT NOT NULL DEFAULT '',
            detail_json TEXT NOT NULL DEFAULT '{}',
            correlation_id TEXT NOT NULL DEFAULT '',
            retention_policy TEXT NOT NULL DEFAULT 'standard',
            expires_at TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_system_logs_created_at
            ON system_logs(created_at DESC, id DESC);

        CREATE TABLE IF NOT EXISTS migration_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            migration_id TEXT NOT NULL,
            status TEXT NOT NULL,
            detail_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminal_command_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminal_commands (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            name TEXT NOT NULL,
            command_text TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES terminal_command_groups(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_terminal_command_groups_sort
            ON terminal_command_groups(sort_order, id);
        CREATE INDEX IF NOT EXISTS idx_terminal_commands_group
            ON terminal_commands(group_id, sort_order, id);
        "#,
    )?;

    write_schema_meta(connection, "schema_version", "\"2\"")?;
    write_schema_meta(connection, "min_reader_version", "\"2\"")?;
    write_schema_meta(
        connection,
        "last_migration_id",
        "\"bootstrap-sqlite-v2-2026-04-24\"",
    )?;
    write_schema_meta(
        connection,
        "bootstrap_version",
        "\"sqlite-v2-bootstrap-2026-04-24\"",
    )?;
    write_schema_meta(
        connection,
        "migrated_at",
        &serde_json::to_string(&Utc::now().to_rfc3339())?,
    )?;
    Ok(())
}

/// 写入 schema 元信息。
fn write_schema_meta(connection: &Connection, key: &str, value_json: &str) -> Result<(), AppError> {
    connection.execute(
        "INSERT INTO schema_meta (key, value_json, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
        params![key, value_json, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}
