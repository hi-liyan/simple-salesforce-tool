#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod app_state;
mod command_storage;
mod commands;
mod drivers;
mod error;
mod llm;
mod lan_file_receiver;
mod models;
mod modules;
mod providers;
mod salesforce;
mod services;
mod sf_cli;
mod storage;
mod terminal;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use app_state::{ensure_data_dir, AppState};
use drivers::connection_manager::ConnectionManager;
use drivers::DriverRegistry;
use salesforce::SalesforceClient;
use storage::Storage;
use tauri::Manager;

fn main() {
    let app = tauri::Builder::default()
        // 注册 opener 插件：统一使用官方跨平台打开 URL/文件能力。
        // 关闭链接点击注入脚本，避免对现有前端点击行为产生额外影响。
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 注册 `plugin://` 自定义协议：安全映射 `{app_data_dir}/plugins/<plugin-id>/` 下的静态资源供 iframe 沙箱加载。
        .register_uri_scheme_protocol("plugin", |ctx, request| {
            let app = ctx.app_handle();
            let uri = request.uri();
            let host = uri.host().unwrap_or_default();
            let raw_path = uri.path().trim_start_matches('/');
            // Windows WebView2 会将 http://plugin.localhost/<id>/<path> 映射为 host="localhost" 或 "plugin.localhost"。
            let (raw_plugin_id, raw_asset_path) = if host.eq_ignore_ascii_case("plugin.localhost")
                || host.eq_ignore_ascii_case("localhost")
                || host.is_empty()
            {
                let mut parts = raw_path.splitn(2, '/');
                (
                    parts.next().unwrap_or_default(),
                    parts
                        .next()
                        .filter(|p| !p.is_empty())
                        .unwrap_or("dist/index.html"),
                )
            } else {
                (
                    host,
                    if raw_path.is_empty() {
                        "dist/index.html"
                    } else {
                        raw_path
                    },
                )
            };
            let decoded_plugin_id = urlencoding::decode(raw_plugin_id)
                .map(|value| value.into_owned())
                .unwrap_or_else(|_| raw_plugin_id.to_string());
            let decoded_asset_path = urlencoding::decode(raw_asset_path)
                .map(|value| value.into_owned())
                .unwrap_or_else(|_| raw_asset_path.to_string());

            let result = (|| -> Result<(Vec<u8>, String), String> {
                let state = app
                    .try_state::<AppState>()
                    .ok_or_else(|| "应用状态尚未初始化".to_string())?;
                let data_dir = ensure_data_dir(app)?;
                let service = services::plugin_package_service::PluginPackageService::new(
                    &state.storage,
                    data_dir.join("plugins"),
                );
                service
                    .read_plugin_asset(&decoded_plugin_id, &decoded_asset_path)
                    .map_err(|e| e.to_string())
            })();

            match result {
                Ok((bytes, mime)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .body(bytes)
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
                Err(err) => tauri::http::Response::builder()
                    .status(404)
                    .header("Content-Type", "text/plain; charset=utf-8")
                    .body(err.into_bytes())
                    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new())),
            }
        })
        .setup(|app| {
            // 启动阶段初始化 SQLite v2 存储和共享客户端，避免运行时重复构建。
            let data_dir = ensure_data_dir(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let storage = Storage::open_or_bootstrap(&data_dir).map_err(|error| {
                std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
            })?;

            let sf_client = Arc::new(SalesforceClient::new());
            let connection_manager = Arc::new(ConnectionManager::new());
            let driver_registry =
                DriverRegistry::with_builtin_drivers(Arc::clone(&sf_client), Arc::clone(&connection_manager));

            app.manage(AppState {
                storage,
                driver_registry,
                connection_manager,
                mutation_plan_cache: services::mutation_plan_service::MutationPlanCache::new(),
                sf_client,
                cli_login_cancel: Mutex::new(None),
                llm_conversations: Mutex::new(HashMap::new()),
                llm_stream_cancels: Mutex::new(HashMap::new()),
                query_cancels: Mutex::new(HashMap::new()),
                export_cancels: Mutex::new(HashMap::new()),
                backup_cancels: Mutex::new(HashMap::new()),
                terminal_sessions: Mutex::new(HashMap::new()),
                lan_file_receiver: Mutex::new(None),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::get_cli_path_settings,
            commands::save_cli_path_settings,
            commands::check_cli_path_status,
            commands::detect_local_cli_paths,
            commands::sync_cli_sources,
            commands::login_cli_org,
            commands::open_auth_window,
            commands::close_auth_window,
            commands::open_field_meta_window,
            commands::open_external_url,
            commands::list_system_logs,
            commands::create_source,
            commands::get_source,
            commands::get_source_secret_view,
            commands::reorder_sources,
            commands::test_source_connection,
            commands::update_source,
            commands::delete_source,
            commands::load_workspace_snapshot,
            commands::save_workspace_snapshot,
            commands::get_column_visibility,
            commands::save_column_visibility,
            commands::list_objects,
            commands::refresh_objects,
            commands::list_views,
            commands::list_collations,
            commands::list_users,
            commands::list_routines,
            commands::list_triggers,
            commands::list_events,
            commands::get_schema_object_ddl,
            commands::list_virtual_views,
            commands::upsert_virtual_view,
            commands::delete_virtual_view,
            commands::list_saved_sql,
            commands::upsert_saved_sql,
            commands::toggle_saved_sql_pin,
            commands::mark_saved_sql_used,
            commands::delete_saved_sql,
            commands::open_object_list_page,
            commands::open_object_edit_page,
            commands::open_record_page,
            commands::describe_object,
            commands::get_object_ddl,
            commands::resolve_field_child_relationship_name,
            commands::query_records,
            commands::read_cell_full_value,
            commands::get_table_structure_spec,
            commands::preview_create_table_sql,
            commands::preview_alter_table_sql,
            commands::export_data_to_file,
            commands::cancel_data_export,
            commands::backup_database_to_file,
            commands::cancel_database_backup,
            commands::get_current_user_context,
            commands::create_record,
            commands::save_records,
            commands::preview_save_records_with_deletes,
            commands::save_records_with_deletes,
            commands::update_record,
            commands::delete_record,
            commands::get_llm_settings,
            commands::save_llm_settings,
            commands::ai_get_capabilities,
            commands::ai_chat_turn_v2,
            commands::ai_stop_turn,
            commands::stop_llm_stream_generation,
            commands::ai_cancel_stream,
            commands::ai_list_configs,
            commands::ai_save_config,
            commands::ai_delete_config,
            commands::ai_set_default_config,
            commands::ai_test_config_connection,
            commands::ai_list_config_models,
            commands::ai_agent_stream,
            commands::ai_list_conversations,
            commands::ai_save_conversation,
            commands::ai_delete_conversation,
            commands::ai_list_prompt_templates,
            commands::ai_save_prompt_template,
            commands::ai_delete_prompt_template,
            commands::list_terminal_command_groups,
            commands::create_terminal_command_group,
            commands::update_terminal_command_group,
            commands::create_terminal_command,
            commands::update_terminal_command,
            commands::delete_terminal_command_group,
            commands::delete_terminal_command,
            commands::reorder_terminal_commands,
            commands::open_terminal_session,
            commands::list_available_terminal_shells,
            commands::get_terminal_shell_settings,
            commands::save_terminal_shell_command,
            commands::write_terminal_input,
            commands::resize_terminal_session,
            commands::close_terminal_session,
            commands::open_elevated_terminal,
            lan_file_receiver::get_lan_file_receiver_status,
            lan_file_receiver::start_lan_file_receiver,
            lan_file_receiver::stop_lan_file_receiver,
            lan_file_receiver::list_lan_file_receiver_files,
            lan_file_receiver::read_lan_file_receiver_preview,
            lan_file_receiver::delete_lan_file_receiver_file,
            lan_file_receiver::clear_lan_file_receiver_files,
            commands::get_plugin_kv,
            commands::set_plugin_kv,
            commands::delete_plugin_kv,
            commands::inspect_plugin_package_bytes,
            commands::install_plugin_package_bytes,
            commands::install_plugin_package,
            commands::list_installed_plugins,
            commands::set_installed_plugin_enabled,
            commands::uninstall_plugin,
            commands::list_driver_capabilities,
            commands::check_sql_safety,
            commands::list_sql_execution_audits,
            commands::execute_guarded_query,
            commands::execute_multi_statement_query,
            commands::cancel_query,
            commands::get_console_transaction_status,
            commands::set_console_transaction_mode,
            commands::commit_console_transaction,
            commands::rollback_console_transaction,
            commands::close_console_session,
            commands::diagnose_sql,
            commands::prepare_mutation_plan,
            commands::commit_mutation_plan,
            commands::get_app_setting,
            commands::set_app_setting,
            commands::delete_app_setting
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // 统一接管应用退出事件：主进程退出前主动清理全部终端子进程。
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(state) = app_handle.try_state::<AppState>() {
                let _ = terminal::close_all_terminal_sessions(&state.terminal_sessions);
                let _ = lan_file_receiver::close_lan_file_receiver_runtime(&state.lan_file_receiver);
                tauri::async_runtime::block_on(state.connection_manager.close_all());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn sqlite_v2_has_no_command_store_compatibility_module() {
        let manifest_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let main_source = std::fs::read_to_string(manifest_dir.join("src/main.rs")).unwrap();
        let mut commands_source = String::new();
        for entry in std::fs::read_dir(manifest_dir.join("src/commands")).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
                commands_source.push_str(&std::fs::read_to_string(path).unwrap());
            }
        }
        let runtime_main_source = main_source
            .lines()
            .take_while(|line| !line.contains("#[cfg(test)]"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            !runtime_main_source.contains("mod command_store"),
            "SQLite v2 主入口不应再注册 command_store 迁移壳"
        );
        assert!(
            !commands_source.contains("command_store"),
            "commands.rs 不应再依赖 command_store 迁移壳"
        );
        assert!(
            !manifest_dir.join("src/command_store.rs").exists(),
            "SQLite v2 完全切换后应删除 command_store.rs"
        );
    }
}
