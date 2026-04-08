use std::sync::Mutex;
use tauri::Manager;

mod db;
mod commands;

pub struct DbState {
    pub conn: Mutex<Option<rusqlite::Connection>>,
    pub current_path: Mutex<Option<String>>,
    pub app_data_dir: String,
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

            std::fs::create_dir_all(&app_data_dir).ok();

            app.manage(DbState {
                conn: Mutex::new(None),
                current_path: Mutex::new(None),
                app_data_dir: app_data_dir.to_string_lossy().to_string(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Phase 18: file management
            commands::create_new_file,
            commands::open_file,
            commands::close_file,
            commands::get_recent_files,
            commands::open_recent_file,
            commands::remove_recent_file,
            commands::is_file_open,
            // Core accounting
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
            commands::create_account,
            commands::update_account,
            commands::deactivate_account,
            commands::reactivate_account,
            commands::list_transactions,
            commands::get_transaction_detail,
            commands::count_transactions,
            commands::update_transaction,
            commands::update_transaction_lines,
            commands::void_transaction,
            commands::get_audit_log,
            commands::export_database,
            commands::import_database,
            commands::auto_backup,
            commands::list_backups,
            commands::export_csv,
            commands::get_setting,
            commands::set_setting,
            commands::get_all_settings,
            commands::lock_period_global,
            commands::unlock_period_global,
            commands::list_locked_periods_global,
            commands::get_account_ledger,
            // Phase 32: Dimensions
            commands::create_dimension,
            commands::update_dimension,
            commands::list_dimensions,
            commands::list_dimension_types,
            commands::delete_dimension,
            commands::get_transaction_dimensions,
            // Phase 33: Contacts
            commands::create_contact,
            commands::update_contact,
            commands::get_contact,
            commands::list_contacts,
            commands::deactivate_contact,
            commands::reactivate_contact,
            commands::delete_contact,
            commands::link_transaction_contact,
            commands::unlink_transaction_contact,
            commands::get_contact_ledger,
            commands::get_contact_balance,
            // Phase 34: General Ledger
            commands::get_general_ledger,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
