use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

mod db;
mod commands;
mod sdk_v1;
mod permissions;
mod hooks;
mod events;
mod ui_extensions;
mod health;

pub struct DbState {
    pub conn: Mutex<Option<rusqlite::Connection>>,
    pub current_path: Mutex<Option<String>>,
    pub company_dir: Mutex<Option<String>>,
    pub attached_modules: Mutex<Vec<String>>,
    /// Phase 40: in-memory service registry. Key is (module_id, service_name).
    pub service_registry: Mutex<HashMap<(String, String), sdk_v1::RegisteredService>>,
    /// Phase 42: hook registry (sync, can reject) and async event bus.
    pub hook_registry: hooks::HookRegistry,
    pub event_bus: events::EventBus,
    /// Phase 43: in-memory UI extension registry (nav items, settings panes,
    /// transaction actions). Modules re-register on init.
    pub ui_extensions: ui_extensions::UiExtensionRegistry,
    /// Phase 44: per-module health monitor (in-memory error counters).
    pub health_monitor: health::HealthMonitor,
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
                company_dir: Mutex::new(None),
                attached_modules: Mutex::new(Vec::new()),
                service_registry: Mutex::new(HashMap::new()),
                hook_registry: hooks::new_registry(),
                event_bus: events::new_bus(),
                ui_extensions: ui_extensions::new_registry(),
                health_monitor: health::new_monitor(),
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
            // Phase 35: Document Attachments
            commands::attach_document,
            commands::list_documents,
            commands::get_document_path,
            commands::delete_document,
            commands::get_document_count,
            // Phase 38: Module Storage Sandbox
            commands::attach_module_db,
            commands::detach_module_db,
            commands::list_attached_modules,
            commands::module_create_table,
            commands::module_insert,
            commands::module_query,
            commands::module_update,
            commands::module_delete,
            commands::module_execute_migration,
            // Phase 39: Migration Coordinator
            commands::register_module_migrations,
            commands::run_module_migrations,
            commands::get_migration_status,
            commands::register_module_dependency,
            commands::check_dependency_graph,
            // Phase 40: Module Lifecycle
            commands::install_module,
            commands::uninstall_module,
            commands::enable_module,
            commands::disable_module,
            commands::get_module_info,
            commands::list_installed_modules,
            // Phase 40: SDK v1
            sdk_v1::get_sdk_version,
            sdk_v1::sdk_create_transaction,
            sdk_v1::sdk_void_transaction,
            sdk_v1::sdk_get_account_balance,
            sdk_v1::sdk_get_trial_balance,
            sdk_v1::sdk_get_journal_entries,
            sdk_v1::sdk_create_account,
            sdk_v1::sdk_update_account,
            sdk_v1::sdk_deactivate_account,
            sdk_v1::sdk_get_chart_of_accounts,
            sdk_v1::sdk_create_contact,
            sdk_v1::sdk_get_contact,
            sdk_v1::sdk_list_contacts,
            sdk_v1::sdk_get_contact_ledger,
            sdk_v1::sdk_attach_document,
            sdk_v1::sdk_get_documents,
            sdk_v1::sdk_delete_document,
            sdk_v1::sdk_get_income_statement,
            sdk_v1::sdk_get_balance_sheet,
            sdk_v1::sdk_get_cash_flow,
            sdk_v1::sdk_storage_create_table,
            sdk_v1::sdk_storage_insert,
            sdk_v1::sdk_storage_query,
            sdk_v1::sdk_storage_update,
            sdk_v1::sdk_storage_delete,
            sdk_v1::sdk_register_service,
            sdk_v1::sdk_call_service,
            sdk_v1::sdk_list_services,
            // Phase 41: Permission Enforcer
            permissions::grant_module_permission,
            permissions::revoke_module_permission,
            permissions::get_module_permissions,
            // Phase 42: Hooks & Events
            hooks::sdk_register_hook,
            hooks::sdk_unregister_hook,
            hooks::list_hooks,
            events::sdk_subscribe_event,
            events::sdk_unsubscribe_event,
            events::sdk_emit_event,
            events::list_subscriptions,
            events::get_recent_events,
            // Phase 43: UI Isolation & Module Frame
            ui_extensions::sdk_register_nav_item,
            ui_extensions::sdk_register_settings_pane,
            ui_extensions::sdk_register_transaction_action,
            ui_extensions::get_nav_items,
            ui_extensions::get_settings_panes,
            ui_extensions::get_transaction_actions,
            ui_extensions::get_module_file,
            // Phase 44: Health Monitor
            health::get_health_status,
            health::get_all_health_statuses,
            health::get_health_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
