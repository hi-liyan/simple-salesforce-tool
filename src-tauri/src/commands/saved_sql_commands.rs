use tauri::{AppHandle, Manager};

use crate::app_state::AppState;
use crate::error::AppError;
use crate::models::{SavedSqlListParams, SavedSqlQuery, SavedSqlUpsertPayload};

/// 查询已保存常用 SQL 列表（支持按名称、SQL 说明、SQL 正文及语言/数据源过滤）。
#[tauri::command]
pub async fn list_saved_sql(
    app: AppHandle,
    filter: Option<SavedSqlListParams>,
) -> Result<Vec<SavedSqlQuery>, String> {
    let params = filter.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .read(|conn| crate::storage::saved_sql_repo::list_saved_sql(conn, &params))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("查询已保存 SQL 任务失败: {error}"))?
}

/// 新建或更新已保存常用 SQL。
#[tauri::command]
pub async fn upsert_saved_sql(
    app: AppHandle,
    payload: SavedSqlUpsertPayload,
) -> Result<SavedSqlQuery, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::saved_sql_repo::upsert_saved_sql(conn, &payload))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("保存 SQL 任务失败: {error}"))?
}

/// 切换已保存 SQL 置顶状态。
#[tauri::command]
pub async fn toggle_saved_sql_pin(
    app: AppHandle,
    id: String,
    is_pinned: bool,
) -> Result<SavedSqlQuery, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::saved_sql_repo::toggle_saved_sql_pin(conn, &id, is_pinned))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("切换置顶状态任务失败: {error}"))?
}

/// 标记已保存 SQL 被使用一次（递增计数并更新最近使用时间）。
#[tauri::command]
pub async fn mark_saved_sql_used(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::saved_sql_repo::mark_saved_sql_used(conn, &id))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("更新 SQL 使用记录失败: {error}"))?
}

/// 删除指定的已保存 SQL。
#[tauri::command]
pub async fn delete_saved_sql(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::saved_sql_repo::delete_saved_sql(conn, &id))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("删除已保存 SQL 失败: {error}"))?
}
