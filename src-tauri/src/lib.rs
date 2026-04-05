use std::sync::Mutex;
use tauri::Manager;

mod db;
mod commands;

pub struct DbState {
    pub conn: Mutex<rusqlite::Connection>,
    pub db_path: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");

            let db_path = app_data_dir.join("bookkeeping.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            let conn = db::init_db(app_data_dir)
                .expect("failed to initialize database");

            app.manage(DbState {
                conn: Mutex::new(conn),
                db_path: db_path_str,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_accounts,
            commands::create_transaction,
            commands::get_account_balance,
            commands::get_trial_balance,
            commands::get_income_statement,
            commands::get_balance_sheet,
            commands::get_transactions,
            commands::update_journal_entry,
            commands::lock_period,
            commands::check_period_locked,
            commands::get_app_metadata,
            commands::get_dashboard_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
