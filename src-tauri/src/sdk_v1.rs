// SDK v1 — versioned adapter that exposes kernel functionality to modules.
//
// FROZEN CONTRACT (Fix #1): Once released, the signatures in this file must
// not change. New methods may be ADDED. Optional parameters may be ADDED.
// Breaking changes require a brand-new sdk_v2.rs adapter and bumping the
// `sdk_version` field in module manifests.
//
// Every method takes `module_id` as the first parameter. Permission checks
// against the module's granted scopes are added in Phase 41.

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::DbState;
use crate::commands;

pub const SDK_VERSION: &str = "1";

#[tauri::command]
pub async fn get_sdk_version() -> Result<String, String> {
    Ok(SDK_VERSION.to_string())
}

// ── LEDGER API ──────────────────────────────────────────

#[tauri::command]
pub async fn sdk_create_transaction(
    db: State<'_, DbState>,
    module_id: String,
    date: String,
    description: String,
    reference: Option<String>,
    journal_type: Option<String>,
    entries: Vec<commands::JournalEntryInput>,
) -> Result<String, String> {
    let _ = module_id; // Phase 41 will check ledger:write here
    commands::create_transaction(db, date, description, reference, journal_type, entries, None).await
}

#[tauri::command]
pub async fn sdk_void_transaction(
    db: State<'_, DbState>,
    module_id: String,
    tx_id: String,
    reason: Option<String>,
) -> Result<String, String> {
    let _ = (module_id, reason); // engine void_transaction does not currently take a reason
    commands::void_transaction(db, tx_id).await
}

#[tauri::command]
pub async fn sdk_get_account_balance(
    db: State<'_, DbState>,
    module_id: String,
    account_id: String,
    as_of: Option<String>,
) -> Result<i64, String> {
    let _ = module_id;
    commands::get_account_balance(db, account_id, as_of).await
}

#[tauri::command]
pub async fn sdk_get_trial_balance(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<commands::TrialBalanceResult, String> {
    let _ = module_id;
    commands::get_trial_balance(db, None, None).await
}

#[tauri::command]
pub async fn sdk_get_journal_entries(
    db: State<'_, DbState>,
    module_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
    start_date: Option<String>,
    end_date: Option<String>,
    account_id: Option<String>,
    memo_search: Option<String>,
) -> Result<commands::ListTransactionsResult, String> {
    let _ = module_id;
    commands::list_transactions(db, offset, limit, start_date, end_date, account_id, memo_search).await
}

// ── ACCOUNT API ─────────────────────────────────────────

#[tauri::command]
pub async fn sdk_create_account(
    db: State<'_, DbState>,
    module_id: String,
    code: String,
    name: String,
    acct_type: String,
    parent_id: Option<String>,
) -> Result<String, String> {
    let _ = module_id;
    commands::create_account(db, code, name, acct_type, parent_id).await
}

#[tauri::command]
pub async fn sdk_update_account(
    db: State<'_, DbState>,
    module_id: String,
    id: String,
    name: Option<String>,
    code: Option<String>,
) -> Result<(), String> {
    let _ = module_id;
    commands::update_account(db, id, name, code).await
}

#[tauri::command]
pub async fn sdk_deactivate_account(
    db: State<'_, DbState>,
    module_id: String,
    id: String,
) -> Result<(), String> {
    let _ = module_id;
    commands::deactivate_account(db, id).await
}

#[tauri::command]
pub async fn sdk_get_chart_of_accounts(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<Vec<commands::Account>, String> {
    let _ = module_id;
    commands::get_accounts(db).await
}

// ── CONTACT API ─────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct SdkContactInput {
    pub contact_type: String,
    pub name: String,
    pub company_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

#[tauri::command]
pub async fn sdk_create_contact(
    db: State<'_, DbState>,
    module_id: String,
    data: SdkContactInput,
) -> Result<String, String> {
    let _ = module_id;
    commands::create_contact(
        db,
        data.contact_type,
        data.name,
        data.company_name,
        data.email,
        data.phone,
        None, None, None, None, None, None, None, None,
    ).await
}

#[tauri::command]
pub async fn sdk_get_contact(
    db: State<'_, DbState>,
    module_id: String,
    id: String,
) -> Result<commands::Contact, String> {
    let _ = module_id;
    commands::get_contact(db, id).await
}

#[tauri::command]
pub async fn sdk_list_contacts(
    db: State<'_, DbState>,
    module_id: String,
    contact_type: Option<String>,
    search: Option<String>,
    is_active: Option<i64>,
) -> Result<Vec<commands::Contact>, String> {
    let _ = module_id;
    commands::list_contacts(db, contact_type, search, is_active).await
}

#[tauri::command]
pub async fn sdk_get_contact_ledger(
    db: State<'_, DbState>,
    module_id: String,
    contact_id: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<commands::ContactLedgerResult, String> {
    let _ = module_id;
    commands::get_contact_ledger(db, contact_id, start_date, end_date).await
}

// ── DOCUMENT API ────────────────────────────────────────

#[tauri::command]
pub async fn sdk_attach_document(
    db: State<'_, DbState>,
    module_id: String,
    entity_type: String,
    entity_id: String,
    file_path: String,
    filename: String,
    description: Option<String>,
) -> Result<String, String> {
    let _ = module_id;
    commands::attach_document(db, entity_type, entity_id, file_path, filename, description).await
}

#[tauri::command]
pub async fn sdk_get_documents(
    db: State<'_, DbState>,
    module_id: String,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<commands::DocumentMeta>, String> {
    let _ = module_id;
    commands::list_documents(db, entity_type, entity_id).await
}

#[tauri::command]
pub async fn sdk_delete_document(
    db: State<'_, DbState>,
    module_id: String,
    document_id: String,
) -> Result<(), String> {
    let _ = module_id;
    commands::delete_document(db, document_id).await
}

// ── REPORT API ──────────────────────────────────────────

#[tauri::command]
pub async fn sdk_get_income_statement(
    db: State<'_, DbState>,
    module_id: String,
    start_date: String,
    end_date: String,
) -> Result<commands::IncomeStatementResult, String> {
    let _ = module_id;
    commands::get_income_statement(db, start_date, end_date, None, None).await
}

#[tauri::command]
pub async fn sdk_get_balance_sheet(
    db: State<'_, DbState>,
    module_id: String,
    as_of: String,
) -> Result<commands::BalanceSheetResult, String> {
    let _ = module_id;
    commands::get_balance_sheet(db, as_of).await
}

#[tauri::command]
pub async fn sdk_get_cash_flow(
    db: State<'_, DbState>,
    module_id: String,
    start_date: String,
    end_date: String,
) -> Result<commands::CashFlowStatement, String> {
    let _ = module_id;
    commands::get_cash_flow_statement(db, start_date, end_date).await
}

// ── STORAGE API (delegates to Phase 38 module storage) ──

#[tauri::command]
pub async fn sdk_storage_create_table(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    columns_sql: String,
) -> Result<(), String> {
    commands::module_create_table(db, module_id, table_name, columns_sql).await
}

#[tauri::command]
pub async fn sdk_storage_insert(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    row: serde_json::Value,
) -> Result<i64, String> {
    commands::module_insert(db, module_id, table_name, row).await
}

#[tauri::command]
pub async fn sdk_storage_query(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    filters: Option<Vec<commands::ModuleQueryFilter>>,
) -> Result<Vec<serde_json::Value>, String> {
    commands::module_query(db, module_id, table_name, filters).await
}

#[tauri::command]
pub async fn sdk_storage_update(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    id: serde_json::Value,
    fields: serde_json::Value,
) -> Result<usize, String> {
    commands::module_update(db, module_id, table_name, id, fields).await
}

#[tauri::command]
pub async fn sdk_storage_delete(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    id: serde_json::Value,
) -> Result<usize, String> {
    commands::module_delete(db, module_id, table_name, id).await
}

// ── SERVICE REGISTRY (Fix #6) ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceHandlerInfo {
    pub description: Option<String>,
    pub params_schema: Option<serde_json::Value>,
    pub returns_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegisteredService {
    pub module_id: String,
    pub service_name: String,
    pub info: ServiceHandlerInfo,
}

/// Register a callable service exposed by a module. Stored in-memory only —
/// modules re-register on init.
#[tauri::command]
pub async fn sdk_register_service(
    db: State<'_, DbState>,
    module_id: String,
    service_name: String,
    info: ServiceHandlerInfo,
) -> Result<(), String> {
    crate::commands::validate_ident_pub(&module_id)?;
    if service_name.is_empty() {
        return Err("service_name cannot be empty".to_string());
    }
    let mut reg = db.service_registry.lock().map_err(|e| e.to_string())?;
    reg.insert((module_id.clone(), service_name.clone()), RegisteredService {
        module_id, service_name, info,
    });
    Ok(())
}

/// Call a service registered by another module. The kernel brokers — modules
/// never communicate directly. The actual handler dispatch happens at the
/// frontend SDK bridge layer (Phase 43); this command's job is to validate that
/// the call is permitted and the target service exists.
#[tauri::command]
pub async fn sdk_call_service(
    db: State<'_, DbState>,
    caller_module_id: String,
    target_module_id: String,
    service_name: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let _ = caller_module_id; // Phase 41 will check services:call
    let reg = db.service_registry.lock().map_err(|e| e.to_string())?;
    let svc = reg.get(&(target_module_id.clone(), service_name.clone()))
        .ok_or_else(|| format!("Service not found: {}::{}", target_module_id, service_name))?;
    // Phase 40 returns a stub response so tests can verify routing. Phase 43
    // will replace this with a real iframe postMessage round-trip.
    Ok(serde_json::json!({
        "ok": true,
        "module_id": svc.module_id,
        "service_name": svc.service_name,
        "params": params,
    }))
}

#[tauri::command]
pub async fn sdk_list_services(
    db: State<'_, DbState>,
) -> Result<Vec<RegisteredService>, String> {
    let reg = db.service_registry.lock().map_err(|e| e.to_string())?;
    let mut out: Vec<RegisteredService> = reg.values().cloned().collect();
    out.sort_by(|a, b| a.module_id.cmp(&b.module_id).then(a.service_name.cmp(&b.service_name)));
    Ok(out)
}

/// Clear all services for a module — used by uninstall and disable.
pub fn unregister_module_services(db: &DbState, module_id: &str) {
    if let Ok(mut reg) = db.service_registry.lock() {
        reg.retain(|(m, _), _| m != module_id);
    }
}
