#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_state;
mod commands;
mod db;
mod error;
mod models;
mod salesforce;

use std::sync::Mutex;

use app_state::{ensure_data_dir, AppState};
use rusqlite::Connection;
use salesforce::SalesforceClient;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 启动阶段初始化数据库和共享客户端，避免运行时重复构建。
            let data_dir = ensure_data_dir(&app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            let db_path = data_dir.join("app.db");
            let connection = Connection::open(db_path)?;
            db::init_schema(&connection)
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error.to_string()))?;

            app.manage(AppState {
                db: Mutex::new(connection),
                sf_client: SalesforceClient::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sources,
            commands::create_source,
            commands::update_source,
            commands::delete_source,
            commands::list_objects,
            commands::describe_object,
            commands::query_records,
            commands::create_record,
            commands::update_record,
            commands::delete_record
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
