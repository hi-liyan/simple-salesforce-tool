use tauri::State;

use crate::app_state::{ensure_data_dir, AppState};
use crate::error::AppError;
use crate::services::plugin_package_service::{PluginPackageInspection, PluginPackageService};
use crate::services::plugin_service::PluginService;
use crate::storage::plugin_repo::InstalledPluginRecord;

/// 获取外部插件安装根目录 `{app_data_dir}/plugins`。
fn resolve_plugins_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let data_dir = ensure_data_dir(app)?;
    Ok(data_dir.join("plugins"))
}

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

/// 预览解析本地 `.sstplugin` 插件包（支持前端传入二进制字节流），返回 `manifest.json` 供用户审批权限。
#[tauri::command]
pub fn inspect_plugin_package_bytes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<PluginPackageInspection, String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .inspect_package_bytes(&bytes)
        .map_err(AppError::to_string_error)
}

/// 安装或升级 `.sstplugin` 插件包（字节流）。
#[tauri::command]
pub fn install_plugin_package_bytes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    bytes: Vec<u8>,
) -> Result<InstalledPluginRecord, String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .install_package_bytes(&bytes)
        .map_err(AppError::to_string_error)
}

/// 从本地文件路径安装 `.sstplugin` 插件包。
#[tauri::command]
pub fn install_plugin_package(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    package_path: String,
) -> Result<InstalledPluginRecord, String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .install_package_file(&package_path)
        .map_err(AppError::to_string_error)
}

/// 列出全部已安装的外部插件。
#[tauri::command]
pub fn list_installed_plugins(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<InstalledPluginRecord>, String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .list_installed()
        .map_err(AppError::to_string_error)
}

/// 切换已安装外部插件的启用/禁用状态。
#[tauri::command]
pub fn set_installed_plugin_enabled(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .set_enabled(&plugin_id, enabled)
        .map_err(AppError::to_string_error)
}

/// 卸载外部插件并清理安装目录与隔离 KV 数据。
#[tauri::command]
pub fn uninstall_plugin(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), String> {
    let plugins_root = resolve_plugins_root(&app)?;
    PluginPackageService::new(&state.storage, plugins_root)
        .uninstall(&plugin_id)
        .map_err(AppError::to_string_error)
}
