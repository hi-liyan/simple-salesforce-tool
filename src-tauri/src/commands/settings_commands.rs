use tauri::Manager;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::storage::config_repo;

/// 按 key 独立读取应用设置（异步线程池执行，避免阻塞窗口主线程）。
#[tauri::command]
pub async fn get_app_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .read(|conn| config_repo::read_app_setting(conn, &key))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("读取设置线程失败: {e}"))?
}

/// 按 key 独立写入应用设置（异步线程池执行）。
#[tauri::command]
pub async fn set_app_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| config_repo::write_app_setting(conn, &key, &value))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("写入设置线程失败: {e}"))?
}

/// 按 key 删除应用设置（异步线程池执行）。
#[tauri::command]
pub async fn delete_app_setting(app: tauri::AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| config_repo::delete_app_setting(conn, &key))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("删除设置线程失败: {e}"))?
}
