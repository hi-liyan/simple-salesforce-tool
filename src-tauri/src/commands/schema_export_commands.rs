use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{Emitter, Manager, State};

use crate::app_state::AppState;
use crate::drivers::mysql::provider::{MySqlProvider, MySqlSourceConfig};
use crate::drivers::mysql::table_ddl::{self, TableStructureSpec};
use crate::error::AppError;
use crate::services::backup_service::{
    BackupProgressPayload, BackupRequest, BackupResult, BackupService,
};
use crate::services::export_service::{
    ExportDataRequest, ExportProgressPayload, ExportResult, ExportService,
};
use crate::services::source_service::SourceService;

/// 从 SQLite 异步加载完整数据源配置（含解密凭证），避免阻塞 Tauri 主线程。
async fn load_source_async(
    app: &tauri::AppHandle,
    source_id: String,
) -> Result<crate::models::SalesforceSource, AppError> {
    let app_cloned = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_cloned.state::<AppState>();
        let service = SourceService::new(&state.storage);
        service.get_runtime_source(&source_id)
    })
    .await
    .map_err(|err| AppError::Biz(format!("后台加载数据源任务失败: {err}")))?
}

/// 读取指定表的完整结构定义（列、索引、外键、表注释与引擎），用于表结构设计器回填。
#[tauri::command]
pub async fn get_table_structure_spec(
    app: tauri::AppHandle,
    source_id: String,
    table_name: String,
) -> Result<TableStructureSpec, String> {
    let source = load_source_async(&app, source_id)
        .await
        .map_err(|err| err.to_string())?;
    let state = app.state::<AppState>();
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(|err| err.to_string())?;
    if !driver.capabilities().supports_table_designer {
        return Err(format!(
            "数据源类型 [{}] 暂不支持表结构设计器",
            source.source_type
        ));
    }

    let config = MySqlSourceConfig::from_source(&source).map_err(|err| err.to_string())?;
    let provider = MySqlProvider::with_connection_manager(Arc::clone(&state.connection_manager));
    let pool = provider
        .acquire_pool(&source, &config)
        .await
        .map_err(|err| err.to_string())?;
    table_ddl::get_mysql_table_structure_spec(&pool, &config.database, &table_name)
        .await
        .map_err(|err| err.to_string())
}

/// 根据表结构定义实时生成 `CREATE TABLE` 预览 SQL 列表。
#[tauri::command]
pub async fn preview_create_table_sql(spec: TableStructureSpec) -> Result<Vec<String>, String> {
    table_ddl::preview_create_table_sql(&spec).map_err(|err| err.to_string())
}

/// 对比原始与编辑后的表结构定义，实时生成 `ALTER TABLE` 预览 SQL 列表。
#[tauri::command]
pub async fn preview_alter_table_sql(
    original: TableStructureSpec,
    updated: TableStructureSpec,
) -> Result<Vec<String>, String> {
    table_ddl::preview_alter_table_sql(&original, &updated).map_err(|err| err.to_string())
}

/// 执行异步流式多格式数据导出（支持 CSV / TSV / JSON / Markdown / SQL INSERT / XLSX）。
#[tauri::command]
pub async fn export_data_to_file(
    app: tauri::AppHandle,
    request: ExportDataRequest,
) -> Result<ExportResult, String> {
    let source = load_source_async(&app, request.source_id.clone())
        .await
        .map_err(|err| err.to_string())?;
    let state = app.state::<AppState>();
    let task_id = request.task_id.clone();

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state
            .export_cancels
            .lock()
            .map_err(|_| "获取导出取消锁失败".to_string())?;
        guard.insert(task_id.clone(), Arc::clone(&cancel_flag));
    }

    let app_for_emit = app.clone();
    let result = ExportService::export_to_file(
        &state.driver_registry,
        &state.connection_manager,
        &source,
        request,
        cancel_flag,
        move |payload: ExportProgressPayload| {
            let _ = app_for_emit.emit("data-export-progress", payload);
        },
    )
    .await;

    if let Ok(mut guard) = state.export_cancels.lock() {
        guard.remove(&task_id);
    }

    if let Err(ref err) = result {
        let phase = if err.to_string().contains("EXPORT_CANCELLED") {
            "cancelled"
        } else {
            "failed"
        };
        let _ = app.emit(
            "data-export-progress",
            ExportProgressPayload {
                task_id,
                exported_rows: 0,
                total_rows: None,
                phase: phase.to_string(),
                message: err.to_string(),
            },
        );
    }

    result.map_err(|err| err.to_string())
}

/// 取消正在进行的后台数据导出任务。
#[tauri::command]
pub async fn cancel_data_export(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<bool, String> {
    let guard = state
        .export_cancels
        .lock()
        .map_err(|_| "获取导出取消锁失败".to_string())?;
    if let Some(flag) = guard.get(&task_id) {
        flag.store(true, Ordering::Relaxed);
        return Ok(true);
    }
    Ok(false)
}

/// 执行纯 Rust 逻辑 SQL 数据库备份（支持整库或单表）。
#[tauri::command]
pub async fn backup_database_to_file(
    app: tauri::AppHandle,
    request: BackupRequest,
) -> Result<BackupResult, String> {
    let source = load_source_async(&app, request.source_id.clone())
        .await
        .map_err(|err| err.to_string())?;
    let state = app.state::<AppState>();
    let task_id = request.task_id.clone();

    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state
            .backup_cancels
            .lock()
            .map_err(|_| "获取备份取消锁失败".to_string())?;
        guard.insert(task_id.clone(), Arc::clone(&cancel_flag));
    }

    let app_for_emit = app.clone();
    let result = BackupService::backup_to_file(
        &state.storage,
        &state.driver_registry,
        &state.connection_manager,
        &source,
        request,
        cancel_flag,
        move |payload: BackupProgressPayload| {
            let _ = app_for_emit.emit("database-backup-progress", payload);
        },
    )
    .await;

    if let Ok(mut guard) = state.backup_cancels.lock() {
        guard.remove(&task_id);
    }

    if let Err(ref err) = result {
        let phase = if err.to_string().contains("BACKUP_CANCELLED") {
            "cancelled"
        } else {
            "failed"
        };
        let _ = app.emit(
            "database-backup-progress",
            BackupProgressPayload {
                task_id,
                current_table: String::new(),
                completed_tables: 0,
                total_tables: 0,
                exported_rows: 0,
                phase: phase.to_string(),
                message: err.to_string(),
            },
        );
    }

    result.map_err(|err| err.to_string())
}

/// 取消正在进行的数据库备份任务。
#[tauri::command]
pub async fn cancel_database_backup(
    state: State<'_, AppState>,
    task_id: String,
) -> Result<bool, String> {
    let guard = state
        .backup_cancels
        .lock()
        .map_err(|_| "获取备份取消锁失败".to_string())?;
    if let Some(flag) = guard.get(&task_id) {
        flag.store(true, Ordering::Relaxed);
        return Ok(true);
    }
    Ok(false)
}
