use std::sync::Mutex;
use tauri::Manager;

mod db;
mod commands;

pub struct DbState(pub Mutex<rusqlite::Connection>);

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

            let conn = db::init_db(app_data_dir)
                .expect("failed to initialize database");

            app.manage(DbState(Mutex::new(conn)));

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
