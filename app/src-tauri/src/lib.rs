// 应用入口：初始化数据库并注册 Tauri 命令

mod ai;
mod commands;
mod db;
mod models;

use std::sync::Mutex;
use tauri::Manager;

use db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // 数据存放于系统应用数据目录（%APPDATA%/com.kd89.app）
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("bikeng.db");
            let conn = db::open(db_path.to_str().unwrap())?;
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_companies,
            commands::get_company_detail,
            commands::create_company,
            commands::update_company,
            commands::delete_company,
            commands::list_tags,
            commands::add_company_tag,
            commands::remove_company_tag,
            commands::add_position,
            commands::update_position,
            commands::delete_position,
            commands::add_chat,
            commands::delete_chat,
            commands::add_application,
            commands::delete_application,
            commands::get_settings,
            commands::save_settings,
            commands::get_stats,
            commands::export_data,
            commands::import_data,
            commands::fetch_url_text,
            commands::render_url_text,
            commands::ai_parse_job,
            commands::fetch_aiqicha,
            commands::fetch_biz_url,
            commands::query_biz,
            commands::score_company,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}