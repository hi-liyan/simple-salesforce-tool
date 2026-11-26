use tauri::State;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::storage::config_repo;

/// 按 key 独立读取应用设置（外壳/布局偏好增量通道）。
#[tauri::command]
pub fn get_app_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state
        .storage
        .read(|conn| config_repo::read_app_setting(conn, &key))
        .map_err(AppError::to_string_error)
}

/// 按 key 独立写入应用设置（外壳/布局偏好增量通道）。
#[tauri::command]
pub fn set_app_setting(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    state
        .storage
        .write(|conn| config_repo::write_app_setting(conn, &key, &value))
        .map_err(AppError::to_string_error)
}

/// 按 key 删除应用设置。
#[tauri::command]
pub fn delete_app_setting(state: State<'_, AppState>, key: String) -> Result<(), String> {
    state
        .storage
        .write(|conn| config_repo::delete_app_setting(conn, &key))
        .map_err(AppError::to_string_error)
}
