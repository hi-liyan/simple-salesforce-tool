use tauri::State;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::services::plugin_service::PluginService;

/// 读取插件隔离键值存储。
#[tauri::command]
pub fn get_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    PluginService::new(&state.storage)
        .get_kv(&plugin_id, &key)
        .map_err(AppError::to_string_error)
}

/// 写入插件隔离键值存储。
#[tauri::command]
pub fn set_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
    value_json: String,
) -> Result<(), String> {
    PluginService::new(&state.storage)
        .set_kv(&plugin_id, &key, &value_json)
        .map_err(AppError::to_string_error)
}

/// 删除插件隔离键值存储。
#[tauri::command]
pub fn delete_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    PluginService::new(&state.storage)
        .delete_kv(&plugin_id, &key)
        .map_err(AppError::to_string_error)
}
