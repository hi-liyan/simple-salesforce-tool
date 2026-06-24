#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod app_state;
mod command_storage;
mod commands;
mod error;
mod llm;
mod lan_file_receiver;
mod models;
mod providers;
mod salesforce;
mod services;
mod sf_cli;
mod storage;
mod terminal;

use std::collections::HashMap;
use std::sync::Mutex;

use app_state::{ensure_data_dir, AppState};
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
        .setup(|app| {
            // 启动阶段初始化 SQLite v2 存储和共享客户端，避免运行时重复构建。
            let data_dir = ensure_data_dir(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let storage = Storage::open_or_bootstrap(&data_dir).map_err(|error| {
                std::io::Error::new(std::io::ErrorKind::Other, error.to_string())
            })?;

            app.manage(AppState {
                storage,
                sf_client: SalesforceClient::new(),
                cli_login_cancel: Mutex::new(None),
                llm_conversations: Mutex::new(HashMap::new()),
                llm_stream_cancels: Mutex::new(HashMap::new()),
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
            commands::open_object_list_page,
            commands::open_object_edit_page,
            commands::open_record_page,
            commands::describe_object,
            commands::get_object_ddl,
            commands::resolve_field_child_relationship_name,
            commands::query_records,
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
            lan_file_receiver::clear_lan_file_receiver_files
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
        let commands_source =
            std::fs::read_to_string(manifest_dir.join("src/commands.rs")).unwrap();
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
