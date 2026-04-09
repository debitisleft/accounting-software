use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;
use std::sync::MutexGuard;

use crate::DbState;

/// Lock the connection mutex and return the guard. Errors if no file is open.
fn get_conn(db: &DbState) -> Result<MutexGuard<'_, Option<rusqlite::Connection>>, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        return Err("No file is open".to_string());
    }
    Ok(guard)
}

/// Recent files JSON management
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentFile {
    pub path: String,
    pub company_name: String,
    pub last_opened: String,
}

fn recent_files_path(app_data_dir: &str) -> String {
    format!("{}/recent-files.json", app_data_dir)
}

fn load_recent_files(app_data_dir: &str) -> Vec<RecentFile> {
    let path = recent_files_path(app_data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_recent_files(app_data_dir: &str, files: &[RecentFile]) {
    let path = recent_files_path(app_data_dir);
    if let Ok(json) = serde_json::to_string_pretty(files) {
        std::fs::write(path, json).ok();
    }
}

fn add_to_recent(app_data_dir: &str, file_path: &str, company_name: &str) {
    let mut recent = load_recent_files(app_data_dir);
    recent.retain(|f| f.path != file_path);
    recent.insert(0, RecentFile {
        path: file_path.to_string(),
        company_name: company_name.to_string(),
        last_opened: Utc::now().to_rfc3339(),
    });
    if recent.len() > 10 {
        recent.truncate(10);
    }
    save_recent_files(app_data_dir, &recent);
}

// ── Phase 18: File Management Commands ───────────────────

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub company_name: String,
}

/// Detach all attached module databases. Used before closing/reopening a company file.
fn detach_all_modules(db: &DbState) {
    let module_ids: Vec<String> = {
        match db.attached_modules.lock() {
            Ok(mut g) => g.drain(..).collect(),
            Err(_) => Vec::new(),
        }
    };
    if module_ids.is_empty() {
        return;
    }
    if let Ok(conn_guard) = db.conn.lock() {
        if let Some(ref c) = *conn_guard {
            for mid in &module_ids {
                let _ = c.execute_batch(&format!("DETACH DATABASE module_{};", sanitize_ident(mid)));
            }
        }
    }
}

/// Public re-export so other modules (sdk_v1) can validate identifiers.
pub fn validate_ident_pub(s: &str) -> Result<(), String> {
    validate_ident(s)
}

/// Validate that a string is safe to use as a SQL identifier (alphanumeric + underscore).
fn validate_ident(s: &str) -> Result<(), String> {
    if s.is_empty() {
        return Err("Identifier cannot be empty".to_string());
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("Invalid identifier '{}': only alphanumeric and underscore allowed", s));
    }
    if s.chars().next().unwrap().is_ascii_digit() {
        return Err(format!("Identifier '{}' cannot start with a digit", s));
    }
    Ok(())
}

/// Sanitize an identifier (drops invalid chars). Use only after validate_ident has been called.
fn sanitize_ident(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect()
}

#[tauri::command]
pub async fn create_new_file(
    db: State<'_, DbState>,
    path: String,
    company_name: String,
) -> Result<FileInfo, String> {
    // Close any currently open file
    detach_all_modules(&db);
    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *conn_guard {
            crate::db::close_book_file(c).ok();
        }
        *conn_guard = None;
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = None;
        let mut dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        *dir_guard = None;
    }

    let (conn, company_dir) = crate::db::create_book_file(&path, &company_name)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let company_dir_str = company_dir.to_string_lossy().to_string();

    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        *conn_guard = Some(conn);
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = Some(company_dir_str.clone());
        let mut dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        *dir_guard = Some(company_dir_str.clone());
    }

    add_to_recent(&db.app_data_dir, &company_dir_str, &company_name);

    Ok(FileInfo { path: company_dir_str, company_name })
}

#[tauri::command]
pub async fn open_file(
    db: State<'_, DbState>,
    path: String,
) -> Result<FileInfo, String> {
    // Close any currently open file
    detach_all_modules(&db);
    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *conn_guard {
            crate::db::close_book_file(c).ok();
        }
        *conn_guard = None;
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = None;
        let mut dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        *dir_guard = None;
    }

    let (conn, company_dir) = crate::db::open_book_file(&path)?;
    let company_dir_str = company_dir.to_string_lossy().to_string();

    // Read company name from the file's settings
    let company_name: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'company_name'",
        [],
        |row| row.get(0),
    ).unwrap_or_else(|_| "Unknown".to_string());

    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        *conn_guard = Some(conn);
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = Some(company_dir_str.clone());
        let mut dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        *dir_guard = Some(company_dir_str.clone());
    }

    add_to_recent(&db.app_data_dir, &company_dir_str, &company_name);

    Ok(FileInfo { path: company_dir_str, company_name })
}

#[tauri::command]
pub async fn close_file(db: State<'_, DbState>) -> Result<(), String> {
    detach_all_modules(&db);
    let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
    if let Some(ref c) = *conn_guard {
        crate::db::close_book_file(c)?;
    }
    *conn_guard = None;
    let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
    *path_guard = None;
    let mut dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
    *dir_guard = None;
    Ok(())
}

#[tauri::command]
pub async fn get_recent_files(db: State<'_, DbState>) -> Result<Vec<RecentFile>, String> {
    Ok(load_recent_files(&db.app_data_dir))
}

#[tauri::command]
pub async fn open_recent_file(
    db: State<'_, DbState>,
    path: String,
) -> Result<FileInfo, String> {
    // Delegate to open_file — if it fails (missing file), return error
    // The caller can then offer to remove it from recent list
    open_file(db, path).await
}

#[tauri::command]
pub async fn remove_recent_file(
    db: State<'_, DbState>,
    path: String,
) -> Result<(), String> {
    let mut recent = load_recent_files(&db.app_data_dir);
    recent.retain(|f| f.path != path);
    save_recent_files(&db.app_data_dir, &recent);
    Ok(())
}

#[tauri::command]
pub async fn is_file_open(db: State<'_, DbState>) -> Result<bool, String> {
    let guard = db.conn.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}

// ── Structs ──────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Account {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub acct_type: String,
    pub normal_balance: String,
    pub parent_id: Option<String>,
    pub is_active: i64,
    pub is_system: i64,
    pub is_cash_account: i64,
    pub cash_flow_category: Option<String>,
    pub depth: i64,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct JournalEntryInput {
    pub account_id: String,
    pub debit: i64,
    pub credit: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct JournalEntryOutput {
    pub id: String,
    pub transaction_id: String,
    pub account_id: String,
    pub debit: i64,
    pub credit: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct TransactionWithEntries {
    pub id: String,
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    pub journal_type: String,
    pub is_locked: i64,
    pub is_void: i64,
    pub void_of: Option<String>,
    pub created_at: i64,
    pub entries: Vec<JournalEntryOutput>,
}

#[derive(Debug, Serialize)]
pub struct AccountBalanceRow {
    pub account_id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub acct_type: String,
    pub debit: i64,
    pub credit: i64,
    pub depth: i64,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TrialBalanceResult {
    pub rows: Vec<AccountBalanceRow>,
    pub total_debits: i64,
    pub total_credits: i64,
    pub is_balanced: bool,
}

#[derive(Debug, Serialize)]
pub struct AccountBalanceItem {
    pub account_id: String,
    pub code: String,
    pub name: String,
    pub balance: i64,
    pub depth: i64,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct IncomeStatementResult {
    pub revenue: Vec<AccountBalanceItem>,
    pub expenses: Vec<AccountBalanceItem>,
    pub total_revenue: i64,
    pub total_expenses: i64,
    pub net_income: i64,
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Serialize)]
pub struct BalanceSheetResult {
    pub assets: Vec<AccountBalanceItem>,
    pub liabilities: Vec<AccountBalanceItem>,
    pub equity: Vec<AccountBalanceItem>,
    pub total_assets: i64,
    pub total_liabilities: i64,
    pub total_equity: i64,
    pub is_balanced: bool,
    pub as_of_date: String,
}

// ── Helper ───────────────────────────────────────────────

fn is_debit_normal(acct_type: &str) -> bool {
    acct_type == "ASSET" || acct_type == "EXPENSE"
}

// ── Commands ─────────────────────────────────────────────

#[tauri::command]
pub async fn get_accounts(db: State<'_, DbState>) -> Result<Vec<Account>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, code, name, type, normal_balance, parent_id, is_active, created_at, COALESCE(is_system, 0), COALESCE(is_cash_account, 0), cash_flow_category FROM accounts WHERE is_active = 1 ORDER BY code")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                acct_type: row.get(3)?,
                normal_balance: row.get(4)?,
                parent_id: row.get(5)?,
                is_active: row.get(6)?,
                is_system: row.get(8)?,
                is_cash_account: row.get(9)?,
                cash_flow_category: row.get(10)?,
                depth: 0,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(|e| e.to_string())?);
    }

    // Compute depth for each account based on parent chain
    let id_to_parent: std::collections::HashMap<String, Option<String>> = accounts
        .iter()
        .map(|a| (a.id.clone(), a.parent_id.clone()))
        .collect();
    for acct in &mut accounts {
        let mut depth = 0i64;
        let mut current = acct.parent_id.clone();
        while let Some(ref pid) = current {
            depth += 1;
            current = id_to_parent.get(pid).and_then(|p| p.clone());
            if depth > 10 { break; } // safety limit
        }
        acct.depth = depth;
    }

    Ok(accounts)
}

#[derive(Debug, Deserialize)]
pub struct LineDimensionInput {
    pub line_index: usize,
    pub dimension_id: String,
}

#[tauri::command]
pub async fn create_transaction(
    db: State<'_, DbState>,
    date: String,
    description: String,
    reference: Option<String>,
    journal_type: Option<String>,
    entries: Vec<JournalEntryInput>,
    dimensions: Option<Vec<LineDimensionInput>>,
) -> Result<String, String> {
    let jtype = journal_type.unwrap_or_else(|| "GENERAL".to_string());
    let valid_types = ["GENERAL", "ADJUSTING", "CLOSING", "REVERSING", "OPENING"];
    if !valid_types.contains(&jtype.as_str()) {
        return Err(format!("Invalid journal type: {}", jtype));
    }
    // Users cannot manually create system journal types
    if matches!(jtype.as_str(), "CLOSING" | "REVERSING" | "OPENING") {
        return Err(format!("Cannot manually create {} journal entries", jtype));
    }

    let total_debit: i64 = entries.iter().map(|e| e.debit).sum();
    let total_credit: i64 = entries.iter().map(|e| e.credit).sum();

    if total_debit != total_credit {
        return Err(format!(
            "Transaction does not balance: debits={} credits={} difference={}",
            total_debit, total_credit, total_debit - total_credit
        ));
    }

    if total_debit == 0 {
        return Err("Transaction must have non-zero amounts".to_string());
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check period locks
    let date_locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end >= ?1 AND is_locked = 1",
        params![date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if date_locked {
        return Err("Cannot create transaction in a locked period".to_string());
    }

    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    // Check for deactivated accounts
    for entry in &entries {
        let (is_active, acct_name): (i64, String) = conn.query_row(
            "SELECT is_active, name FROM accounts WHERE id = ?1",
            params![entry.account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).map_err(|_| format!("Account not found: {}", entry.account_id))?;
        if is_active != 1 {
            return Err(format!("Cannot create transaction with deactivated account: {}", acct_name));
        }
    }

    // Auto-reference number if not provided
    let final_reference = if reference.as_ref().map_or(true, |r| r.is_empty()) {
        let prefix = match jtype.as_str() {
            "GENERAL" => "GJ", "ADJUSTING" => "AJ", "CLOSING" => "CJ",
            "REVERSING" => "RJ", "OPENING" => "OJ", _ => "GJ",
        };
        let counter_key = format!("next_ref_{}", jtype.to_lowercase());
        let counter: i64 = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![counter_key],
            |row| row.get::<_, String>(0),
        ).map(|v| v.parse::<i64>().unwrap_or(1))
            .unwrap_or(1);
        let auto_ref = format!("{}-{:04}", prefix, counter);
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![counter_key, (counter + 1).to_string()],
        ).map_err(|e| e.to_string())?;
        Some(auto_ref)
    } else {
        reference
    };

    // Validate dimensions before inserting
    if let Some(ref dims) = dimensions {
        for dim_ref in dims {
            if dim_ref.line_index >= entries.len() {
                return Err(format!("Invalid line_index: {}", dim_ref.line_index));
            }
            let (is_active, dim_name): (i64, String) = conn.query_row(
                "SELECT is_active, name FROM dimensions WHERE id = ?1",
                params![dim_ref.dimension_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(|_| format!("Dimension not found: {}", dim_ref.dimension_id))?;
            if is_active != 1 {
                return Err(format!("Cannot use inactive dimension: {}", dim_name));
            }
        }
    }

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;

    let insert_result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, journal_type, is_locked, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![tx_id, date, description, final_reference, jtype, now],
        ).map_err(|e| e.to_string())?;

        let mut entry_ids: Vec<String> = Vec::new();
        for entry in &entries {
            let entry_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![entry_id, tx_id, entry.account_id, entry.debit, entry.credit, entry.memo],
            ).map_err(|e| e.to_string())?;
            entry_ids.push(entry_id);
        }

        // Insert dimension junction rows
        if let Some(ref dims) = dimensions {
            for dim_ref in dims {
                let junction_id = Uuid::new_v4().to_string();
                let line_id = &entry_ids[dim_ref.line_index];
                conn.execute(
                    "INSERT INTO transaction_line_dimensions (id, transaction_line_id, dimension_id) VALUES (?1, ?2, ?3)",
                    params![junction_id, line_id, dim_ref.dimension_id],
                ).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    })();

    let final_result = match insert_result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(tx_id.clone())
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    };

    drop(guard);
    if final_result.is_ok() {
        crate::events::emit_event(&db, "transaction.created", serde_json::json!({
            "transaction_id": tx_id,
            "date": date,
            "description": description,
            "journal_type": jtype,
            "line_count": entries.len(),
            "total_amount": total_debit,
        }));
    }
    final_result
}

#[tauri::command]
pub async fn get_account_balance(
    db: State<'_, DbState>,
    account_id: String,
    as_of_date: Option<String>,
) -> Result<i64, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let acct_type: String = conn
        .query_row("SELECT type FROM accounts WHERE id = ?1", params![account_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let (total_debit, total_credit): (i64, i64) = match &as_of_date {
        Some(date) => conn.query_row(
            "SELECT COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
             FROM journal_entries je
             JOIN transactions t ON je.transaction_id = t.id
             WHERE je.account_id = ?1 AND t.date <= ?2",
            params![account_id, date],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
        None => conn.query_row(
            "SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
             FROM journal_entries WHERE account_id = ?1",
            params![account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ),
    }
    .map_err(|e| e.to_string())?;

    let balance = if is_debit_normal(&acct_type) {
        total_debit - total_credit
    } else {
        total_credit - total_debit
    };

    Ok(balance)
}

#[tauri::command]
pub async fn get_trial_balance(
    db: State<'_, DbState>,
    as_of_date: Option<String>,
    exclude_journal_types: Option<Vec<String>>,
) -> Result<TrialBalanceResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let exclude_clause = match &exclude_journal_types {
        Some(types) if !types.is_empty() => {
            let quoted: Vec<String> = types.iter().map(|t| format!("'{}'", t)).collect();
            format!(" AND t.journal_type NOT IN ({})", quoted.join(","))
        }
        _ => String::new(),
    };

    let query = match &as_of_date {
        Some(date) => format!(
            "SELECT a.id, a.code, a.name, a.type,
                    COALESCE(SUM(je.debit), 0) AS total_debit,
                    COALESCE(SUM(je.credit), 0) AS total_credit,
                    a.parent_id
             FROM accounts a
             LEFT JOIN journal_entries je ON je.account_id = a.id
             LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date <= '{}'{}
             WHERE a.is_active = 1
             GROUP BY a.id ORDER BY a.code",
            date, exclude_clause
        ),
        None => format!(
            "SELECT a.id, a.code, a.name, a.type,
                    COALESCE(SUM(je.debit), 0) AS total_debit,
                    COALESCE(SUM(je.credit), 0) AS total_credit,
                    a.parent_id
             FROM accounts a
             LEFT JOIN journal_entries je ON je.account_id = a.id
             LEFT JOIN transactions t ON je.transaction_id = t.id{}
             WHERE a.is_active = 1
             GROUP BY a.id ORDER BY a.code",
            exclude_clause
        ),
    };

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows_iter = stmt
        .query_map([], |row| {
            let acct_type: String = row.get(3)?;
            let total_debit: i64 = row.get(4)?;
            let total_credit: i64 = row.get(5)?;
            let net = if is_debit_normal(&acct_type) {
                total_debit - total_credit
            } else {
                total_credit - total_debit
            };
            // Column determined by sign: positive net = normal side,
            // negative net = abnormal side (show abs in opposite column)
            let (debit, credit) = if net >= 0 {
                if is_debit_normal(&acct_type) { (net, 0) } else { (0, net) }
            } else {
                if is_debit_normal(&acct_type) { (0, -net) } else { (-net, 0) }
            };
            Ok(AccountBalanceRow {
                account_id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                acct_type,
                debit,
                credit,
                depth: 0,
                parent_id: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut rows = Vec::new();
    for row in rows_iter {
        let r = row.map_err(|e| e.to_string())?;
        if r.debit != 0 || r.credit != 0 {
            rows.push(r);
        }
    }

    // Compute depth
    let id_to_parent: std::collections::HashMap<String, Option<String>> = rows
        .iter()
        .map(|r| (r.account_id.clone(), r.parent_id.clone()))
        .collect();
    for r in &mut rows {
        let mut depth = 0i64;
        let mut current = r.parent_id.clone();
        while let Some(ref pid) = current {
            depth += 1;
            current = id_to_parent.get(pid).and_then(|p| p.clone());
            if depth > 10 { break; }
        }
        r.depth = depth;
    }

    let total_debits: i64 = rows.iter().map(|r| r.debit).sum();
    let total_credits: i64 = rows.iter().map(|r| r.credit).sum();

    Ok(TrialBalanceResult {
        rows,
        total_debits,
        total_credits,
        is_balanced: total_debits == total_credits,
    })
}

#[tauri::command]
pub async fn get_income_statement(
    db: State<'_, DbState>,
    start_date: String,
    end_date: String,
    exclude_journal_types: Option<Vec<String>>,
    basis: Option<String>,
) -> Result<IncomeStatementResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let exclude_clause = match &exclude_journal_types {
        Some(types) if !types.is_empty() => {
            let quoted: Vec<String> = types.iter().map(|t| format!("'{}'", t)).collect();
            format!(" AND t.journal_type NOT IN ({})", quoted.join(","))
        }
        _ => String::new(),
    };

    let cash_clause = if basis.as_deref() == Some("CASH") {
        " AND t.id IN (SELECT je2.transaction_id FROM journal_entries je2 JOIN accounts a2 ON je2.account_id = a2.id WHERE COALESCE(a2.is_cash_account, 0) = 1)"
    } else { "" };

    let query = format!(
        "SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0), a.parent_id
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2{}{}
         WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
         GROUP BY a.id ORDER BY a.code",
        exclude_clause, cash_clause
    );
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![start_date, end_date], |row| {
        let acct_type: String = row.get(3)?;
        let total_debit: i64 = row.get(4)?;
        let total_credit: i64 = row.get(5)?;
        let balance = if is_debit_normal(&acct_type) {
            total_debit - total_credit
        } else {
            total_credit - total_debit
        };
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, acct_type, balance, row.get::<_, Option<String>>(6)?))
    }).map_err(|e| e.to_string())?;

    let mut revenue = Vec::new();
    let mut expenses = Vec::new();

    for row in rows {
        let (id, code, name, acct_type, balance, parent_id) = row.map_err(|e| e.to_string())?;
        if balance == 0 { continue; }
        let item = AccountBalanceItem { account_id: id, code, name, balance, depth: 0, parent_id };
        match acct_type.as_str() {
            "REVENUE" => revenue.push(item),
            "EXPENSE" => expenses.push(item),
            _ => {}
        }
    }

    let total_revenue: i64 = revenue.iter().map(|r| r.balance).sum();
    let total_expenses: i64 = expenses.iter().map(|r| r.balance).sum();

    Ok(IncomeStatementResult {
        revenue,
        expenses,
        total_revenue,
        total_expenses,
        net_income: total_revenue - total_expenses,
        start_date,
        end_date,
    })
}

#[tauri::command]
pub async fn get_balance_sheet(
    db: State<'_, DbState>,
    as_of_date: String,
) -> Result<BalanceSheetResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0), a.parent_id
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date <= ?1
         WHERE a.is_active = 1
         GROUP BY a.id ORDER BY a.code"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![as_of_date], |row| {
        let acct_type: String = row.get(3)?;
        let total_debit: i64 = row.get(4)?;
        let total_credit: i64 = row.get(5)?;
        let balance = if is_debit_normal(&acct_type) {
            total_debit - total_credit
        } else {
            total_credit - total_debit
        };
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, acct_type, balance, row.get::<_, Option<String>>(6)?))
    }).map_err(|e| e.to_string())?;

    let mut assets = Vec::new();
    let mut liabilities = Vec::new();
    let mut equity = Vec::new();
    let mut net_income: i64 = 0;

    for row in rows {
        let (id, code, name, acct_type, balance, parent_id) = row.map_err(|e| e.to_string())?;
        if balance == 0 { continue; }
        let item = AccountBalanceItem { account_id: id, code, name, balance, depth: 0, parent_id };
        match acct_type.as_str() {
            "ASSET" => assets.push(item),
            "LIABILITY" => liabilities.push(item),
            "EQUITY" => equity.push(item),
            "REVENUE" => net_income += balance,
            "EXPENSE" => net_income -= balance,
            _ => {}
        }
    }

    let total_assets: i64 = assets.iter().map(|r| r.balance).sum();
    let total_liabilities: i64 = liabilities.iter().map(|r| r.balance).sum();
    let total_equity: i64 = equity.iter().map(|r| r.balance).sum::<i64>() + net_income;

    Ok(BalanceSheetResult {
        assets,
        liabilities,
        equity,
        total_assets,
        total_liabilities,
        total_equity,
        is_balanced: total_assets == total_liabilities + total_equity,
        as_of_date,
    })
}

#[tauri::command]
pub async fn get_transactions(
    db: State<'_, DbState>,
    account_id: Option<String>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<Vec<TransactionWithEntries>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut where_clauses = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(ref aid) = account_id {
        where_clauses.push(format!("t.id IN (SELECT transaction_id FROM journal_entries WHERE account_id = ?{}))", param_values.len() + 1));
        // Fix: this needs the opening paren
        where_clauses.last_mut().map(|s| *s = format!("t.id IN (SELECT transaction_id FROM journal_entries WHERE account_id = ?{})", param_values.len() + 1));
        param_values.push(Box::new(aid.clone()));
    }
    if let Some(ref sd) = start_date {
        where_clauses.push(format!("t.date >= ?{}", param_values.len() + 1));
        param_values.push(Box::new(sd.clone()));
    }
    if let Some(ref ed) = end_date {
        where_clauses.push(format!("t.date <= ?{}", param_values.len() + 1));
        param_values.push(Box::new(ed.clone()));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let query = format!("SELECT id, date, description, reference, is_locked, created_at, is_void, void_of, journal_type FROM transactions{} ORDER BY date DESC, created_at DESC", where_sql);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let tx_rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(TransactionWithEntries {
            id: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            reference: row.get(3)?,
            journal_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "GENERAL".to_string()),
            is_locked: row.get(4)?,
            created_at: row.get(5)?,
            is_void: row.get(6)?,
            void_of: row.get(7)?,
            entries: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;

    let mut transactions = Vec::new();
    for tx in tx_rows {
        let mut t = tx.map_err(|e| e.to_string())?;

        let mut entry_stmt = conn.prepare(
            "SELECT id, transaction_id, account_id, debit, credit, memo FROM journal_entries WHERE transaction_id = ?1"
        ).map_err(|e| e.to_string())?;

        let entries = entry_stmt.query_map(params![t.id], |row| {
            Ok(JournalEntryOutput {
                id: row.get(0)?,
                transaction_id: row.get(1)?,
                account_id: row.get(2)?,
                debit: row.get(3)?,
                credit: row.get(4)?,
                memo: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        for entry in entries {
            t.entries.push(entry.map_err(|e| e.to_string())?);
        }
        transactions.push(t);
    }

    Ok(transactions)
}

#[tauri::command]
pub async fn update_journal_entry(
    db: State<'_, DbState>,
    journal_entry_id: String,
    field: String,
    new_value: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check if period is locked for this entry
    let (account_id, tx_date): (String, String) = conn.query_row(
        "SELECT je.account_id, t.date FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id WHERE je.id = ?1",
        params![journal_entry_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = ?1 AND period_start <= ?2 AND period_end >= ?2 AND is_locked = 1",
        params![account_id, tx_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if locked {
        return Err("Cannot edit: period is locked".to_string());
    }

    // Get old value
    let allowed_fields = ["debit", "credit", "memo", "account_id"];
    if !allowed_fields.contains(&field.as_str()) {
        return Err(format!("Cannot update field: {}", field));
    }

    let old_value: String = conn.query_row(
        &format!("SELECT COALESCE(CAST({} AS TEXT), '') FROM journal_entries WHERE id = ?1", field),
        params![journal_entry_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    // Update the field
    conn.execute(
        &format!("UPDATE journal_entries SET {} = ?1 WHERE id = ?2", field),
        params![new_value, journal_entry_id],
    ).map_err(|e| e.to_string())?;

    // Write audit log
    let audit_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO audit_log (id, journal_entry_id, field_changed, old_value, new_value, changed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![audit_id, journal_entry_id, field, old_value, new_value, now],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn lock_period(
    db: State<'_, DbState>,
    account_id: String,
    period_start: String,
    period_end: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO reconciliation_periods (id, account_id, period_start, period_end, is_locked, locked_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![id, account_id, period_start, period_end, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn check_period_locked(
    db: State<'_, DbState>,
    account_id: String,
    date: String,
) -> Result<bool, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = ?1 AND period_start <= ?2 AND period_end >= ?2 AND is_locked = 1",
        params![account_id, date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(locked)
}

// ── Phase 9: App Shell & Navigation ──────────────────────

#[derive(Debug, Serialize)]
pub struct AppMetadata {
    pub version: String,
    pub db_path: String,
    pub last_backup_date: Option<String>,
}

#[tauri::command]
pub async fn get_app_metadata(db: State<'_, DbState>) -> Result<AppMetadata, String> {
    let path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
    Ok(AppMetadata {
        version: env!("CARGO_PKG_VERSION").to_string(),
        db_path: path_guard.clone().unwrap_or_default(),
        last_backup_date: None,
    })
}

#[derive(Debug, Serialize)]
pub struct DashboardSummary {
    pub total_assets: i64,
    pub total_liabilities: i64,
    pub total_equity: i64,
    pub total_revenue: i64,
    pub total_expenses: i64,
    pub net_income: i64,
    pub transaction_count: i64,
    pub recent_transactions: Vec<TransactionWithEntries>,
}

#[tauri::command]
pub async fn get_dashboard_summary(db: State<'_, DbState>) -> Result<DashboardSummary, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut totals_stmt = conn.prepare(
        "SELECT a.type,
                COALESCE(SUM(je.debit), 0) AS total_debit,
                COALESCE(SUM(je.credit), 0) AS total_credit
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         WHERE a.is_active = 1
         GROUP BY a.type"
    ).map_err(|e| e.to_string())?;

    let mut total_assets: i64 = 0;
    let mut total_liabilities: i64 = 0;
    let mut total_equity: i64 = 0;
    let mut total_revenue: i64 = 0;
    let mut total_expenses: i64 = 0;

    let rows = totals_stmt.query_map([], |row| {
        let acct_type: String = row.get(0)?;
        let td: i64 = row.get(1)?;
        let tc: i64 = row.get(2)?;
        Ok((acct_type, td, tc))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        let (acct_type, td, tc) = row.map_err(|e| e.to_string())?;
        match acct_type.as_str() {
            "ASSET" => total_assets += td - tc,
            "LIABILITY" => total_liabilities += tc - td,
            "EQUITY" => total_equity += tc - td,
            "REVENUE" => total_revenue += tc - td,
            "EXPENSE" => total_expenses += td - tc,
            _ => {}
        }
    }

    let net_income = total_revenue - total_expenses;

    let transaction_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions", [], |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    // Recent 10 transactions
    let mut tx_stmt = conn.prepare(
        "SELECT id, date, description, reference, is_locked, created_at, is_void, void_of, journal_type FROM transactions ORDER BY date DESC, created_at DESC LIMIT 10"
    ).map_err(|e| e.to_string())?;

    let tx_rows = tx_stmt.query_map([], |row| {
        Ok(TransactionWithEntries {
            id: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            reference: row.get(3)?,
            journal_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "GENERAL".to_string()),
            is_locked: row.get(4)?,
            created_at: row.get(5)?,
            is_void: row.get(6)?,
            void_of: row.get(7)?,
            entries: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;

    let mut recent_transactions = Vec::new();
    for tx in tx_rows {
        let mut t = tx.map_err(|e| e.to_string())?;
        let mut entry_stmt = conn.prepare(
            "SELECT id, transaction_id, account_id, debit, credit, memo FROM journal_entries WHERE transaction_id = ?1"
        ).map_err(|e| e.to_string())?;
        let entries = entry_stmt.query_map(params![t.id], |row| {
            Ok(JournalEntryOutput {
                id: row.get(0)?,
                transaction_id: row.get(1)?,
                account_id: row.get(2)?,
                debit: row.get(3)?,
                credit: row.get(4)?,
                memo: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        for entry in entries {
            t.entries.push(entry.map_err(|e| e.to_string())?);
        }
        recent_transactions.push(t);
    }

    Ok(DashboardSummary {
        total_assets,
        total_liabilities,
        total_equity: total_equity + net_income,
        total_revenue,
        total_expenses,
        net_income,
        transaction_count,
        recent_transactions,
    })
}

// ── Phase 10: Account Management (CRUD) ──────────────────

#[tauri::command]
pub async fn create_account(
    db: State<'_, DbState>,
    code: String,
    name: String,
    acct_type: String,
    parent_id: Option<String>,
) -> Result<String, String> {
    let valid_types = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
    if !valid_types.contains(&acct_type.as_str()) {
        return Err(format!("Invalid account type: {}", acct_type));
    }
    if name.trim().is_empty() {
        return Err("Account name cannot be empty".to_string());
    }
    if code.trim().is_empty() {
        return Err("Account code cannot be empty".to_string());
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check unique code
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM accounts WHERE code = ?1",
        params![code],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if exists {
        return Err(format!("Account code '{}' already exists", code));
    }

    // Check for circular parent reference
    if let Some(ref pid) = parent_id {
        let parent_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM accounts WHERE id = ?1", params![pid], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !parent_exists {
            return Err(format!("Parent account not found: {}", pid));
        }
        // Walk parent chain to detect cycle
        let mut current = Some(pid.clone());
        let mut depth = 0;
        while let Some(ref cid) = current {
            let next: Option<String> = conn.query_row(
                "SELECT parent_id FROM accounts WHERE id = ?1", params![cid], |row| row.get(0),
            ).unwrap_or(None);
            current = next;
            depth += 1;
            if depth > 10 {
                return Err("Circular parent reference detected".to_string());
            }
        }
    }

    let id = Uuid::new_v4().to_string();
    let nb = if is_debit_normal(&acct_type) { "DEBIT" } else { "CREDIT" };
    let now = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO accounts (id, code, name, type, normal_balance, parent_id, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        params![id, code.trim(), name.trim(), acct_type, nb, parent_id, now],
    ).map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "account_id": id,
        "code": code,
        "name": name,
        "type": acct_type,
    });
    drop(guard);
    crate::events::emit_event(&db, "account.created", payload);
    Ok(id)
}

#[tauri::command]
pub async fn update_account(
    db: State<'_, DbState>,
    account_id: String,
    name: Option<String>,
    code: Option<String>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Verify account exists
    let _exists: String = conn.query_row(
        "SELECT id FROM accounts WHERE id = ?1",
        params![account_id],
        |row| row.get(0),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

    if let Some(ref new_name) = name {
        if new_name.trim().is_empty() {
            return Err("Account name cannot be empty".to_string());
        }
        conn.execute(
            "UPDATE accounts SET name = ?1 WHERE id = ?2",
            params![new_name.trim(), account_id],
        ).map_err(|e| e.to_string())?;
    }

    if let Some(ref new_code) = code {
        if new_code.trim().is_empty() {
            return Err("Account code cannot be empty".to_string());
        }
        // Check uniqueness
        let dup: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM accounts WHERE code = ?1 AND id != ?2",
            params![new_code.trim(), account_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if dup {
            return Err(format!("Account code '{}' already exists", new_code));
        }
        conn.execute(
            "UPDATE accounts SET code = ?1 WHERE id = ?2",
            params![new_code.trim(), account_id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn deactivate_account(
    db: State<'_, DbState>,
    account_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let (acct_type, is_system): (String, i64) = conn.query_row(
        "SELECT type, COALESCE(is_system, 0) FROM accounts WHERE id = ?1",
        params![account_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

    if is_system != 0 {
        return Err("Cannot deactivate a system account".to_string());
    }

    // Check balance is zero
    let (total_debit, total_credit): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM journal_entries WHERE account_id = ?1",
        params![account_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let balance = if is_debit_normal(&acct_type) {
        total_debit - total_credit
    } else {
        total_credit - total_debit
    };

    if balance != 0 {
        return Err(format!("Cannot deactivate account with non-zero balance ({})", balance));
    }

    conn.execute(
        "UPDATE accounts SET is_active = 0 WHERE id = ?1",
        params![account_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn reactivate_account(
    db: State<'_, DbState>,
    account_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let _exists: String = conn.query_row(
        "SELECT id FROM accounts WHERE id = ?1",
        params![account_id],
        |row| row.get(0),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

    conn.execute(
        "UPDATE accounts SET is_active = 1 WHERE id = ?1",
        params![account_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ── Phase 21: Opening Balances ───────────────────────────

#[derive(Debug, Deserialize)]
pub struct OpeningBalanceInput {
    pub account_id: String,
    pub balance: i64,
}

#[tauri::command]
pub async fn enter_opening_balances(
    db: State<'_, DbState>,
    balances: Vec<OpeningBalanceInput>,
    effective_date: String,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Find Opening Balance Equity account
    let obe_id: String = conn.query_row(
        "SELECT id FROM accounts WHERE code = '3500'",
        [],
        |row| row.get(0),
    ).map_err(|_| "Opening Balance Equity account not found".to_string())?;

    // Remove any existing OPENING transaction (opening balances are a setup step)
    let existing_opening: Option<String> = conn.query_row(
        "SELECT id FROM transactions WHERE journal_type = 'OPENING' LIMIT 1",
        [],
        |row| row.get(0),
    ).ok();
    if let Some(ref old_tx_id) = existing_opening {
        conn.execute("DELETE FROM journal_entries WHERE transaction_id = ?1", params![old_tx_id]).map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM transactions WHERE id = ?1", params![old_tx_id]).map_err(|e| e.to_string())?;
    }

    let mut entries: Vec<(String, i64, i64)> = Vec::new(); // (account_id, debit, credit)

    for ob in &balances {
        if ob.balance == 0 { continue; }
        let acct_type: String = conn.query_row(
            "SELECT type FROM accounts WHERE id = ?1",
            params![ob.account_id],
            |row| row.get(0),
        ).map_err(|_| format!("Account not found: {}", ob.account_id))?;

        if is_debit_normal(&acct_type) {
            if ob.balance > 0 {
                entries.push((ob.account_id.clone(), ob.balance, 0));
            } else {
                entries.push((ob.account_id.clone(), 0, -ob.balance));
            }
        } else {
            if ob.balance > 0 {
                entries.push((ob.account_id.clone(), 0, ob.balance));
            } else {
                entries.push((ob.account_id.clone(), -ob.balance, 0));
            }
        }
    }

    if entries.is_empty() {
        return Err("No non-zero balances provided".to_string());
    }

    let total_debit: i64 = entries.iter().map(|e| e.1).sum();
    let total_credit: i64 = entries.iter().map(|e| e.2).sum();
    let diff = total_debit - total_credit;
    if diff > 0 {
        entries.push((obe_id, 0, diff));
    } else if diff < 0 {
        entries.push((obe_id, -diff, 0));
    }

    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, journal_type, is_locked, created_at) VALUES (?1, ?2, 'Opening Balances', 'OJ-0001', 'OPENING', 0, ?3)",
            params![tx_id, effective_date, now],
        ).map_err(|e| e.to_string())?;

        for (account_id, debit, credit) in &entries {
            let eid = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![eid, tx_id, account_id, debit, credit],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; Ok(tx_id) }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
}

// ── Phase 23: Module Foundation ──────────────────────────

#[derive(Debug, Serialize)]
pub struct Module {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub table_prefix: String,
    pub enabled: i64,
    pub installed_at: i64,
}

#[tauri::command]
pub async fn list_modules(db: State<'_, DbState>) -> Result<Vec<Module>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, name, version, description, table_prefix, enabled, installed_at FROM modules ORDER BY name"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(Module {
            id: row.get(0)?,
            name: row.get(1)?,
            version: row.get(2)?,
            description: row.get(3)?,
            table_prefix: row.get(4)?,
            enabled: row.get(5)?,
            installed_at: row.get(6)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut modules = Vec::new();
    for row in rows {
        modules.push(row.map_err(|e| e.to_string())?);
    }
    Ok(modules)
}

#[tauri::command]
pub async fn get_module(db: State<'_, DbState>, module_id: String) -> Result<Module, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    conn.query_row(
        "SELECT id, name, version, description, table_prefix, enabled, installed_at FROM modules WHERE id = ?1",
        params![module_id],
        |row| Ok(Module {
            id: row.get(0)?,
            name: row.get(1)?,
            version: row.get(2)?,
            description: row.get(3)?,
            table_prefix: row.get(4)?,
            enabled: row.get(5)?,
            installed_at: row.get(6)?,
        }),
    ).map_err(|_| format!("Module not found: {}", module_id))
}

// ── Phase 31: Reconciliation Service ─────────────────────

#[derive(Debug, Serialize)]
pub struct ReconciliationInfo {
    pub id: String,
    pub account_id: String,
    pub statement_date: String,
    pub statement_balance: i64,
    pub book_balance: i64,
    pub difference: i64,
    pub is_reconciled: i64,
    pub reconciled_at: Option<i64>,
}

#[tauri::command]
pub async fn start_reconciliation(
    db: State<'_, DbState>,
    account_id: String,
    statement_date: String,
    statement_balance: i64,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Calculate book balance
    let acct_type: String = conn.query_row(
        "SELECT type FROM accounts WHERE id = ?1", params![account_id], |row| row.get(0),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

    let (total_debit, total_credit): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id
         WHERE je.account_id = ?1 AND t.date <= ?2",
        params![account_id, statement_date],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let book_balance = if is_debit_normal(&acct_type) { total_debit - total_credit } else { total_credit - total_debit };

    let id = Uuid::new_v4().to_string();
    // Store in reconciliation_periods table with special format
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO reconciliation_periods (id, account_id, period_start, period_end, is_locked, locked_at)
         VALUES (?1, ?2, ?3, ?4, 0, ?5)",
        params![id, format!("RECON:{}", account_id), statement_date, format!("{}|{}|{}", statement_balance, book_balance, 0), now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn complete_reconciliation(
    db: State<'_, DbState>,
    account_id: String,
    statement_date: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Lock the period
    let already_locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end >= ?1 AND is_locked = 1",
        params![statement_date], |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if !already_locked {
        let lock_id = Uuid::new_v4().to_string();
        let now = Utc::now().timestamp();
        conn.execute(
            "INSERT INTO reconciliation_periods (id, account_id, period_start, period_end, is_locked, locked_at)
             VALUES (?1, 'GLOBAL', '0000-01-01', ?2, 1, ?3)",
            params![lock_id, statement_date, now],
        ).map_err(|e| e.to_string())?;
    }

    // Mark all entries in the reconciled period + account as reconciled
    conn.execute(
        "UPDATE journal_entries SET is_reconciled = 1
         WHERE account_id = ?1 AND transaction_id IN (
             SELECT id FROM transactions WHERE date <= ?2
         )",
        params![account_id, statement_date],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_unreconciled_entries(
    db: State<'_, DbState>,
    account_id: String,
) -> Result<Vec<JournalEntryOutput>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT je.id, je.transaction_id, je.account_id, je.debit, je.credit, je.memo
         FROM journal_entries je
         WHERE je.account_id = ?1 AND COALESCE(je.is_reconciled, 0) = 0
         ORDER BY je.id"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![account_id], |row| {
        Ok(JournalEntryOutput {
            id: row.get(0)?,
            transaction_id: row.get(1)?,
            account_id: row.get(2)?,
            debit: row.get(3)?,
            credit: row.get(4)?,
            memo: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows { result.push(row.map_err(|e| e.to_string())?); }
    Ok(result)
}

// ── Phase 30: Bank Feed Pipeline ─────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct BankTransactionInput {
    pub date: String,
    pub description: String,
    pub amount: i64,
    pub payee: Option<String>,
    pub bank_ref: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PendingBankTransaction {
    pub id: String,
    pub date: String,
    pub description: String,
    pub amount: i64,
    pub payee: Option<String>,
    pub bank_ref: Option<String>,
    pub status: String,
    pub suggested_account_id: Option<String>,
    pub created_transaction_id: Option<String>,
    pub imported_at: i64,
}

#[tauri::command]
pub async fn import_bank_transactions(
    db: State<'_, DbState>,
    items: Vec<BankTransactionInput>,
) -> Result<i64, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let now = Utc::now().timestamp();
    let mut imported: i64 = 0;

    for item in &items {
        // Deduplicate by bank_ref
        if let Some(ref bref) = item.bank_ref {
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) > 0 FROM pending_bank_transactions WHERE bank_ref = ?1",
                params![bref], |row| row.get(0),
            ).unwrap_or(false);
            if exists { continue; }
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO pending_bank_transactions (id, date, description, amount, payee, bank_ref, status, imported_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'PENDING', ?7)",
            params![id, item.date, item.description, item.amount, item.payee, item.bank_ref, now],
        ).map_err(|e| e.to_string())?;
        imported += 1;
    }
    Ok(imported)
}

#[tauri::command]
pub async fn list_pending_bank_transactions(db: State<'_, DbState>) -> Result<Vec<PendingBankTransaction>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, date, description, amount, payee, bank_ref, status, suggested_account_id, created_transaction_id, imported_at
         FROM pending_bank_transactions WHERE status = 'PENDING' ORDER BY date DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(PendingBankTransaction {
            id: row.get(0)?, date: row.get(1)?, description: row.get(2)?,
            amount: row.get(3)?, payee: row.get(4)?, bank_ref: row.get(5)?,
            status: row.get(6)?, suggested_account_id: row.get(7)?,
            created_transaction_id: row.get(8)?, imported_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for row in rows { result.push(row.map_err(|e| e.to_string())?); }
    Ok(result)
}

#[tauri::command]
pub async fn approve_bank_transaction(
    db: State<'_, DbState>,
    pending_id: String,
    account_id: String,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let (date, desc, amount): (String, String, i64) = conn.query_row(
        "SELECT date, description, amount FROM pending_bank_transactions WHERE id = ?1 AND status = 'PENDING'",
        params![pending_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| "Pending transaction not found or already processed".to_string())?;

    let cash_id: String = conn.query_row(
        "SELECT id FROM accounts WHERE COALESCE(is_cash_account, 0) = 1 LIMIT 1",
        [], |row| row.get(0),
    ).map_err(|_| "No cash account found".to_string())?;

    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, journal_type, is_locked, created_at) VALUES (?1, ?2, ?3, 'GENERAL', 0, ?4)",
            params![tx_id, date, desc, now],
        ).map_err(|e| e.to_string())?;

        if amount > 0 {
            let e1 = Uuid::new_v4().to_string();
            let e2 = Uuid::new_v4().to_string();
            conn.execute("INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, ?4, 0)", params![e1, tx_id, cash_id, amount]).map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, 0, ?4)", params![e2, tx_id, account_id, amount]).map_err(|e| e.to_string())?;
        } else {
            let abs_amount = -amount;
            let e1 = Uuid::new_v4().to_string();
            let e2 = Uuid::new_v4().to_string();
            conn.execute("INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, ?4, 0)", params![e1, tx_id, account_id, abs_amount]).map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, 0, ?4)", params![e2, tx_id, cash_id, abs_amount]).map_err(|e| e.to_string())?;
        }

        conn.execute("UPDATE pending_bank_transactions SET status = 'APPROVED', created_transaction_id = ?1 WHERE id = ?2",
            params![tx_id, pending_id]).map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; Ok(tx_id) }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
}

#[tauri::command]
pub async fn dismiss_bank_transaction(db: State<'_, DbState>, pending_id: String) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute("UPDATE pending_bank_transactions SET status = 'DISMISSED' WHERE id = ?1", params![pending_id]).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Phase 28: Recurring Transactions ─────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct RecurringEntryInput {
    pub account_id: String,
    pub debit: i64,
    pub credit: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RecurringTemplate {
    pub id: String,
    pub description: String,
    pub recurrence: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub last_generated: Option<String>,
    pub is_paused: i64,
    pub entries_json: String,
    pub created_at: i64,
}

#[derive(Debug, Serialize)]
pub struct DueRecurring {
    pub template_id: String,
    pub description: String,
    pub due_date: String,
}

#[tauri::command]
pub async fn create_recurring(
    db: State<'_, DbState>,
    description: String,
    recurrence: String,
    start_date: String,
    end_date: Option<String>,
    entries: Vec<RecurringEntryInput>,
) -> Result<String, String> {
    let valid = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"];
    if !valid.contains(&recurrence.as_str()) {
        return Err(format!("Invalid recurrence: {}", recurrence));
    }
    let total_debit: i64 = entries.iter().map(|e| e.debit).sum();
    let total_credit: i64 = entries.iter().map(|e| e.credit).sum();
    if total_debit != total_credit { return Err("Template entries do not balance".to_string()); }
    if total_debit == 0 { return Err("Template must have non-zero amounts".to_string()); }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    let entries_json = serde_json::to_string(&entries).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO recurring_templates (id, description, recurrence, start_date, end_date, is_paused, entries_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7)",
        params![id, description, recurrence, start_date, end_date, entries_json, now],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn list_recurring(db: State<'_, DbState>) -> Result<Vec<RecurringTemplate>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, description, recurrence, start_date, end_date, last_generated, is_paused, entries_json, created_at FROM recurring_templates ORDER BY description"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(RecurringTemplate {
            id: row.get(0)?, description: row.get(1)?, recurrence: row.get(2)?,
            start_date: row.get(3)?, end_date: row.get(4)?, last_generated: row.get(5)?,
            is_paused: row.get(6)?, entries_json: row.get(7)?, created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut templates = Vec::new();
    for row in rows { templates.push(row.map_err(|e| e.to_string())?); }
    Ok(templates)
}

#[tauri::command]
pub async fn update_recurring(
    db: State<'_, DbState>,
    id: String,
    description: Option<String>,
    recurrence: Option<String>,
    end_date: Option<String>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    if let Some(ref d) = description {
        conn.execute("UPDATE recurring_templates SET description = ?1 WHERE id = ?2", params![d, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref r) = recurrence {
        conn.execute("UPDATE recurring_templates SET recurrence = ?1 WHERE id = ?2", params![r, id]).map_err(|e| e.to_string())?;
    }
    if let Some(ref ed) = end_date {
        conn.execute("UPDATE recurring_templates SET end_date = ?1 WHERE id = ?2", params![ed, id]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn pause_recurring(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute("UPDATE recurring_templates SET is_paused = 1 WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn resume_recurring(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute("UPDATE recurring_templates SET is_paused = 0 WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_recurring(db: State<'_, DbState>, id: String) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute("DELETE FROM recurring_templates WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn generate_recurring(
    db: State<'_, DbState>,
    template_id: String,
    date: String,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let (desc, entries_json, is_paused): (String, String, i64) = conn.query_row(
        "SELECT description, entries_json, is_paused FROM recurring_templates WHERE id = ?1",
        params![template_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| format!("Recurring template not found: {}", template_id))?;

    if is_paused != 0 { return Err("Cannot generate from paused template".to_string()); }

    let entries: Vec<RecurringEntryInput> = serde_json::from_str(&entries_json).map_err(|e| e.to_string())?;
    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, journal_type, is_locked, created_at) VALUES (?1, ?2, ?3, 'GENERAL', 0, ?4)",
            params![tx_id, date, desc, now],
        ).map_err(|e| e.to_string())?;
        for entry in &entries {
            let eid = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![eid, tx_id, entry.account_id, entry.debit, entry.credit, entry.memo],
            ).map_err(|e| e.to_string())?;
        }
        conn.execute("UPDATE recurring_templates SET last_generated = ?1 WHERE id = ?2", params![date, template_id]).map_err(|e| e.to_string())?;
        Ok(())
    })();

    match result {
        Ok(()) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; Ok(tx_id) }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
}

// ── Phase 24: Cash Flow Statement ────────────────────────

#[derive(Debug, Serialize)]
pub struct CashFlowItem {
    pub account_id: String,
    pub code: String,
    pub name: String,
    pub amount: i64,
}

#[derive(Debug, Serialize)]
pub struct CashFlowStatement {
    pub net_income: i64,
    pub operating: Vec<CashFlowItem>,
    pub investing: Vec<CashFlowItem>,
    pub financing: Vec<CashFlowItem>,
    pub total_operating: i64,
    pub total_investing: i64,
    pub total_financing: i64,
    pub net_change_in_cash: i64,
    pub beginning_cash: i64,
    pub ending_cash: i64,
}

#[tauri::command]
pub async fn get_cash_flow_statement(
    db: State<'_, DbState>,
    start_date: String,
    end_date: String,
) -> Result<CashFlowStatement, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Net income
    let mut is_stmt = conn.prepare(
        "SELECT a.type, COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2
         WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
         GROUP BY a.type"
    ).map_err(|e| e.to_string())?;

    let mut total_revenue: i64 = 0;
    let mut total_expenses: i64 = 0;
    let rows = is_stmt.query_map(params![start_date, end_date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?))
    }).map_err(|e| e.to_string())?;
    for row in rows {
        let (acct_type, td, tc) = row.map_err(|e| e.to_string())?;
        match acct_type.as_str() {
            "REVENUE" => total_revenue += tc - td,
            "EXPENSE" => total_expenses += td - tc,
            _ => {}
        }
    }
    let net_income = total_revenue - total_expenses;

    // Cash balances
    let day_before = {
        let d = chrono::NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
            .map_err(|e| e.to_string())?;
        (d - chrono::Duration::days(1)).format("%Y-%m-%d").to_string()
    };

    let beginning_cash: i64 = conn.query_row(
        "SELECT COALESCE(SUM(je.debit - je.credit), 0)
         FROM journal_entries je
         JOIN accounts a ON je.account_id = a.id AND COALESCE(a.is_cash_account, 0) = 1
         JOIN transactions t ON je.transaction_id = t.id AND t.date <= ?1",
        params![day_before],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let ending_cash: i64 = conn.query_row(
        "SELECT COALESCE(SUM(je.debit - je.credit), 0)
         FROM journal_entries je
         JOIN accounts a ON je.account_id = a.id AND COALESCE(a.is_cash_account, 0) = 1
         JOIN transactions t ON je.transaction_id = t.id AND t.date <= ?1",
        params![end_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    // Changes in non-cash BS accounts
    let mut bs_stmt = conn.prepare(
        "SELECT a.id, a.code, a.name, a.type, a.cash_flow_category,
                COALESCE(SUM(CASE WHEN t.date <= ?1 THEN je.debit - je.credit ELSE 0 END), 0) as begin_bal,
                COALESCE(SUM(CASE WHEN t.date <= ?2 THEN je.debit - je.credit ELSE 0 END), 0) as end_bal
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id
         WHERE a.is_active = 1 AND COALESCE(a.is_cash_account, 0) = 0
           AND a.type IN ('ASSET', 'LIABILITY', 'EQUITY')
         GROUP BY a.id"
    ).map_err(|e| e.to_string())?;

    let mut operating = Vec::new();
    let mut investing = Vec::new();
    let mut financing = Vec::new();

    let bs_rows = bs_stmt.query_map(params![day_before, end_date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?, row.get::<_, i64>(6)?))
    }).map_err(|e| e.to_string())?;

    for row in bs_rows {
        let (id, code, name, acct_type, category, begin_raw, end_raw) = row.map_err(|e| e.to_string())?;
        let begin_bal = if is_debit_normal(&acct_type) { begin_raw } else { -begin_raw };
        let end_bal = if is_debit_normal(&acct_type) { end_raw } else { -end_raw };
        let change = end_bal - begin_bal;
        if change == 0 { continue; }

        let cash_impact = if is_debit_normal(&acct_type) { -change } else { change };
        let item = CashFlowItem { account_id: id, code: code.clone(), name, amount: cash_impact };

        if let Some(ref cat) = category {
            match cat.as_str() {
                "INVESTING" => investing.push(item),
                "FINANCING" => financing.push(item),
                _ => operating.push(item),
            }
        } else {
            let code_num: i32 = code.parse().unwrap_or(0);
            match acct_type.as_str() {
                "ASSET" => if code_num < 1500 { operating.push(item) } else { investing.push(item) },
                "LIABILITY" => if code_num < 2500 { operating.push(item) } else { financing.push(item) },
                _ => financing.push(item),
            }
        }
    }

    let total_operating = net_income + operating.iter().map(|i| i.amount).sum::<i64>();
    let total_investing = investing.iter().map(|i| i.amount).sum::<i64>();
    let total_financing = financing.iter().map(|i| i.amount).sum::<i64>();

    Ok(CashFlowStatement {
        net_income,
        operating,
        investing,
        financing,
        total_operating,
        total_investing,
        total_financing,
        net_change_in_cash: total_operating + total_investing + total_financing,
        beginning_cash,
        ending_cash,
    })
}

// ── Phase 22: Fiscal Year Close ──────────────────────────

#[derive(Debug, Serialize)]
pub struct FiscalYearCloseResult {
    pub transaction_id: String,
    pub net_income: i64,
}

#[derive(Debug, Serialize)]
pub struct FiscalYearCloseInfo {
    pub transaction_id: String,
    pub date: String,
    pub net_income: i64,
}

#[tauri::command]
pub async fn close_fiscal_year(
    db: State<'_, DbState>,
    fiscal_year_end_date: String,
) -> Result<FiscalYearCloseResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check not already closed
    let already_closed: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM transactions WHERE journal_type = 'CLOSING' AND date = ?1",
        params![fiscal_year_end_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if already_closed {
        return Err("Fiscal year already closed for this date".to_string());
    }

    // Find retained earnings account
    let re_id: String = conn.query_row(
        "SELECT id FROM accounts WHERE code = '3200'",
        [],
        |row| row.get(0),
    ).map_err(|_| "Retained Earnings account not found".to_string())?;

    // Get fiscal year start
    let start_month: String = conn.query_row(
        "SELECT value FROM settings WHERE key = 'fiscal_year_start_month'",
        [],
        |row| row.get(0),
    ).unwrap_or_else(|_| "1".to_string());
    let start_month_num: u32 = start_month.parse().unwrap_or(1);
    let end_year: i32 = fiscal_year_end_date[..4].parse().unwrap_or(2026);
    let start_year = if start_month_num == 1 { end_year } else { end_year - 1 };
    let start_date = format!("{}-{:02}-01", start_year, start_month_num);

    // Get revenue/expense balances
    let mut stmt = conn.prepare(
        "SELECT a.id, a.type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2
         WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
         GROUP BY a.id"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![start_date, fiscal_year_end_date], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?, row.get::<_, i64>(3)?))
    }).map_err(|e| e.to_string())?;

    let mut entries: Vec<(String, i64, i64)> = Vec::new();
    let mut total_revenue: i64 = 0;
    let mut total_expenses: i64 = 0;

    for row in rows {
        let (acct_id, acct_type, total_debit, total_credit) = row.map_err(|e| e.to_string())?;
        let balance = if is_debit_normal(&acct_type) {
            total_debit - total_credit
        } else {
            total_credit - total_debit
        };
        if balance == 0 { continue; }

        match acct_type.as_str() {
            "REVENUE" => {
                total_revenue += balance;
                entries.push((acct_id, balance, 0)); // debit revenue to zero it
            }
            "EXPENSE" => {
                total_expenses += balance;
                entries.push((acct_id, 0, balance)); // credit expense to zero it
            }
            _ => {}
        }
    }

    // Zero-activity years are valid — create the closing entry even with no lines

    let net_income = total_revenue - total_expenses;
    if net_income > 0 {
        entries.push((re_id, 0, net_income)); // credit retained earnings
    } else if net_income < 0 {
        entries.push((re_id, -net_income, 0)); // debit retained earnings
    }

    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, journal_type, is_locked, created_at)
             VALUES (?1, ?2, ?3, 'CJ-CLOSE', 'CLOSING', 0, ?4)",
            params![tx_id, fiscal_year_end_date, format!("Closing Entry — FY ending {}", fiscal_year_end_date), now],
        ).map_err(|e| e.to_string())?;

        for (account_id, debit, credit) in &entries {
            let eid = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![eid, tx_id, account_id, debit, credit],
            ).map_err(|e| e.to_string())?;
        }

        // Lock the period
        let already_locked: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end >= ?1 AND is_locked = 1",
            params![fiscal_year_end_date],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !already_locked {
            let lock_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO reconciliation_periods (id, account_id, period_start, period_end, is_locked, locked_at)
                 VALUES (?1, 'GLOBAL', '0000-01-01', ?2, 1, ?3)",
                params![lock_id, fiscal_year_end_date, now],
            ).map_err(|e| e.to_string())?;
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(FiscalYearCloseResult { transaction_id: tx_id, net_income })
        }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
}

#[tauri::command]
pub async fn list_fiscal_year_closes(
    db: State<'_, DbState>,
) -> Result<Vec<FiscalYearCloseInfo>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let re_id: String = conn.query_row(
        "SELECT id FROM accounts WHERE code = '3200'",
        [],
        |row| row.get(0),
    ).unwrap_or_default();

    let mut stmt = conn.prepare(
        "SELECT t.id, t.date FROM transactions t WHERE t.journal_type = 'CLOSING' ORDER BY t.date DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        let (tx_id, date) = row.map_err(|e| e.to_string())?;
        let net_income: i64 = conn.query_row(
            "SELECT COALESCE(credit, 0) - COALESCE(debit, 0) FROM journal_entries WHERE transaction_id = ?1 AND account_id = ?2",
            params![tx_id, re_id],
            |row| row.get(0),
        ).unwrap_or(0);
        results.push(FiscalYearCloseInfo { transaction_id: tx_id, date, net_income });
    }

    Ok(results)
}

// ── Phase 11: Transaction Register ───────────────────────

#[derive(Debug, Serialize)]
pub struct ListTransactionsResult {
    pub transactions: Vec<TransactionWithEntries>,
    pub total: i64,
}

fn build_tx_with_entries(conn: &rusqlite::Connection, tx: &mut TransactionWithEntries) -> Result<(), String> {
    let mut entry_stmt = conn.prepare(
        "SELECT id, transaction_id, account_id, debit, credit, memo FROM journal_entries WHERE transaction_id = ?1"
    ).map_err(|e| e.to_string())?;
    let entries = entry_stmt.query_map(params![tx.id], |row| {
        Ok(JournalEntryOutput {
            id: row.get(0)?,
            transaction_id: row.get(1)?,
            account_id: row.get(2)?,
            debit: row.get(3)?,
            credit: row.get(4)?,
            memo: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    for entry in entries {
        tx.entries.push(entry.map_err(|e| e.to_string())?);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_transactions(
    db: State<'_, DbState>,
    offset: Option<i64>,
    limit: Option<i64>,
    start_date: Option<String>,
    end_date: Option<String>,
    account_id: Option<String>,
    memo_search: Option<String>,
) -> Result<ListTransactionsResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref sd) = start_date {
        where_clauses.push(format!("t.date >= ?{}", idx)); idx += 1;
        param_values.push(Box::new(sd.clone()));
    }
    if let Some(ref ed) = end_date {
        where_clauses.push(format!("t.date <= ?{}", idx)); idx += 1;
        param_values.push(Box::new(ed.clone()));
    }
    if let Some(ref aid) = account_id {
        where_clauses.push(format!("t.id IN (SELECT transaction_id FROM journal_entries WHERE account_id = ?{})", idx)); idx += 1;
        param_values.push(Box::new(aid.clone()));
    }
    if let Some(ref memo) = memo_search {
        where_clauses.push(format!("LOWER(t.description) LIKE ?{}", idx));
        param_values.push(Box::new(format!("%{}%", memo.to_lowercase())));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    // Count total
    let count_query = format!("SELECT COUNT(*) FROM transactions t{}", where_sql);
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
    let total: i64 = conn.query_row(&count_query, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // Fetch page
    let lim = limit.unwrap_or(50);
    let off = offset.unwrap_or(0);
    let data_query = format!(
        "SELECT id, date, description, reference, is_locked, created_at, is_void, void_of, journal_type FROM transactions t{} ORDER BY t.date DESC, t.created_at DESC LIMIT {} OFFSET {}",
        where_sql, lim, off
    );

    let mut stmt = conn.prepare(&data_query).map_err(|e| e.to_string())?;
    let tx_rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(TransactionWithEntries {
            id: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            reference: row.get(3)?,
            journal_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "GENERAL".to_string()),
            is_locked: row.get(4)?,
            created_at: row.get(5)?,
            is_void: row.get(6)?,
            void_of: row.get(7)?,
            entries: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;

    let mut transactions = Vec::new();
    for tx in tx_rows {
        let mut t = tx.map_err(|e| e.to_string())?;
        build_tx_with_entries(&conn, &mut t)?;
        transactions.push(t);
    }

    Ok(ListTransactionsResult { transactions, total })
}

#[tauri::command]
pub async fn get_transaction_detail(
    db: State<'_, DbState>,
    transaction_id: String,
) -> Result<TransactionWithEntries, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut tx = conn.query_row(
        "SELECT id, date, description, reference, is_locked, created_at, is_void, void_of, journal_type FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| {
            Ok(TransactionWithEntries {
                id: row.get(0)?,
                date: row.get(1)?,
                description: row.get(2)?,
                reference: row.get(3)?,
                journal_type: row.get::<_, Option<String>>(8)?.unwrap_or_else(|| "GENERAL".to_string()),
                is_locked: row.get(4)?,
                created_at: row.get(5)?,
                is_void: row.get(6)?,
                void_of: row.get(7)?,
                entries: Vec::new(),
            })
        },
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;

    build_tx_with_entries(&conn, &mut tx)?;
    Ok(tx)
}

#[tauri::command]
pub async fn count_transactions(
    db: State<'_, DbState>,
    start_date: Option<String>,
    end_date: Option<String>,
    account_id: Option<String>,
    memo_search: Option<String>,
) -> Result<i64, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut where_clauses: Vec<String> = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(ref sd) = start_date {
        where_clauses.push(format!("t.date >= ?{}", idx)); idx += 1;
        param_values.push(Box::new(sd.clone()));
    }
    if let Some(ref ed) = end_date {
        where_clauses.push(format!("t.date <= ?{}", idx)); idx += 1;
        param_values.push(Box::new(ed.clone()));
    }
    if let Some(ref aid) = account_id {
        where_clauses.push(format!("t.id IN (SELECT transaction_id FROM journal_entries WHERE account_id = ?{})", idx)); idx += 1;
        param_values.push(Box::new(aid.clone()));
    }
    if let Some(ref memo) = memo_search {
        where_clauses.push(format!("LOWER(t.description) LIKE ?{}", idx));
        let _ = idx; // suppress unused warning
        param_values.push(Box::new(format!("%{}%", memo.to_lowercase())));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let query = format!("SELECT COUNT(*) FROM transactions t{}", where_sql);
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
    let count: i64 = conn.query_row(&query, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

// ── Phase 12: Transaction Editing, Voiding & Audit Trail ─

fn is_transaction_locked(conn: &rusqlite::Connection, transaction_id: &str) -> Result<bool, String> {
    // Check global period lock first
    let tx_date: String = conn.query_row(
        "SELECT date FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| row.get(0),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;

    let global_locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end >= ?1 AND is_locked = 1",
        params![tx_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if global_locked { return Ok(true); }

    // Check per-account period locks
    let locked: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM journal_entries je
         JOIN transactions t ON je.transaction_id = t.id
         JOIN reconciliation_periods rp ON rp.account_id = je.account_id
           AND rp.period_start <= t.date AND rp.period_end >= t.date AND rp.is_locked = 1
         WHERE je.transaction_id = ?1",
        params![transaction_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(locked)
}

fn write_audit_log(
    conn: &rusqlite::Connection,
    transaction_id: &str,
    field_changed: &str,
    old_value: &str,
    new_value: &str,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO audit_log (id, journal_entry_id, transaction_id, field_changed, old_value, new_value, changed_at)
         VALUES (?1, '', ?2, ?3, ?4, ?5, ?6)",
        params![id, transaction_id, field_changed, old_value, new_value, now],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn update_transaction(
    db: State<'_, DbState>,
    transaction_id: String,
    date: Option<String>,
    description: Option<String>,
    reference: Option<String>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    if is_transaction_locked(&conn, &transaction_id)? {
        return Err("Cannot edit: transaction is in a locked period".to_string());
    }

    // Check if voided
    let is_void: bool = conn.query_row(
        "SELECT is_void FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;
    if is_void {
        return Err("Cannot edit a voided transaction".to_string());
    }

    // Get current values for audit log
    let (old_date, old_desc, old_ref): (String, String, Option<String>) = conn.query_row(
        "SELECT date, description, reference FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;

    if let Some(ref new_date) = date {
        if *new_date != old_date {
            conn.execute("UPDATE transactions SET date = ?1 WHERE id = ?2", params![new_date, transaction_id])
                .map_err(|e| e.to_string())?;
            write_audit_log(&conn, &transaction_id, "date", &old_date, new_date)?;
        }
    }

    if let Some(ref new_desc) = description {
        if *new_desc != old_desc {
            conn.execute("UPDATE transactions SET description = ?1 WHERE id = ?2", params![new_desc, transaction_id])
                .map_err(|e| e.to_string())?;
            write_audit_log(&conn, &transaction_id, "description", &old_desc, new_desc)?;
        }
    }

    if let Some(ref new_ref) = reference {
        let old_ref_str = old_ref.unwrap_or_default();
        if *new_ref != old_ref_str {
            conn.execute("UPDATE transactions SET reference = ?1 WHERE id = ?2", params![new_ref, transaction_id])
                .map_err(|e| e.to_string())?;
            write_audit_log(&conn, &transaction_id, "reference", &old_ref_str, new_ref)?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn update_transaction_lines(
    db: State<'_, DbState>,
    transaction_id: String,
    entries: Vec<JournalEntryInput>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    if is_transaction_locked(&conn, &transaction_id)? {
        return Err("Cannot edit: transaction is in a locked period".to_string());
    }

    // Check if voided
    let is_void: bool = conn.query_row(
        "SELECT is_void FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;
    if is_void {
        return Err("Cannot edit a voided transaction".to_string());
    }

    // Validate balance
    let total_debit: i64 = entries.iter().map(|e| e.debit).sum();
    let total_credit: i64 = entries.iter().map(|e| e.credit).sum();
    if total_debit != total_credit {
        return Err(format!("Lines do not balance: debits={} credits={}", total_debit, total_credit));
    }
    if total_debit == 0 {
        return Err("Transaction must have non-zero amounts".to_string());
    }

    // Capture old entries for audit
    let mut old_stmt = conn.prepare(
        "SELECT account_id, debit, credit, memo FROM journal_entries WHERE transaction_id = ?1"
    ).map_err(|e| e.to_string())?;
    let old_entries: Vec<String> = old_stmt.query_map(params![transaction_id], |row| {
        Ok(format!("{}:D{}C{}",
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?))
    }).map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let new_entries: Vec<String> = entries.iter()
        .map(|e| format!("{}:D{}C{}", e.account_id, e.debit, e.credit))
        .collect();

    // Atomically replace
    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute("DELETE FROM journal_entries WHERE transaction_id = ?1", params![transaction_id])
            .map_err(|e| e.to_string())?;
        for entry in &entries {
            let eid = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![eid, transaction_id, entry.account_id, entry.debit, entry.credit, entry.memo],
            ).map_err(|e| e.to_string())?;
        }
        write_audit_log(&conn, &transaction_id, "lines",
            &old_entries.join(";"), &new_entries.join(";"))?;
        Ok(())
    })();

    match result {
        Ok(()) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; Ok(()) }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
}

#[tauri::command]
pub async fn void_transaction(
    db: State<'_, DbState>,
    transaction_id: String,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    if is_transaction_locked(&conn, &transaction_id)? {
        return Err("Cannot void: transaction is in a locked period".to_string());
    }

    // Check not already voided
    let already_void: bool = conn.query_row(
        "SELECT is_void FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;

    if already_void {
        return Err("Transaction is already voided".to_string());
    }

    // Check if this is a reversing entry (void_of IS NOT NULL)
    let is_reversing: bool = conn.query_row(
        "SELECT void_of IS NOT NULL FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if is_reversing {
        return Err("Cannot void a reversing entry".to_string());
    }

    // Get original entries
    let mut stmt = conn.prepare(
        "SELECT account_id, debit, credit, memo FROM journal_entries WHERE transaction_id = ?1"
    ).map_err(|e| e.to_string())?;
    let original_entries: Vec<(String, i64, i64, Option<String>)> = stmt.query_map(params![transaction_id], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    }).map_err(|e| e.to_string())?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Get original date and description
    let (orig_date, orig_desc): (String, String) = conn.query_row(
        "SELECT date, description FROM transactions WHERE id = ?1",
        params![transaction_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    let result = (|| -> Result<String, String> {
        // Create reversing transaction
        let void_tx_id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, journal_type, is_locked, is_void, void_of, created_at)
             VALUES (?1, ?2, ?3, ?4, 'REVERSING', 0, 0, ?5, ?6)",
            params![void_tx_id, orig_date, format!("VOID: {}", orig_desc), "VOID", transaction_id, now],
        ).map_err(|e| e.to_string())?;

        // Insert reversed entries (debit↔credit swapped)
        for (account_id, debit, credit, memo) in &original_entries {
            let eid = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![eid, void_tx_id, account_id, credit, debit, memo],
            ).map_err(|e| e.to_string())?;
        }

        // Mark original as voided
        conn.execute(
            "UPDATE transactions SET is_void = 1 WHERE id = ?1",
            params![transaction_id],
        ).map_err(|e| e.to_string())?;

        // Audit log
        write_audit_log(&conn, &transaction_id, "voided", "false", "true")?;

        Ok(void_tx_id)
    })();

    let final_result = match result {
        Ok(id) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(id)
        }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    };

    drop(stmt);
    drop(guard);
    if let Ok(ref void_id) = final_result {
        crate::events::emit_event(&db, "transaction.voided", serde_json::json!({
            "transaction_id": transaction_id,
            "void_transaction_id": void_id,
        }));
    }
    final_result
}

#[derive(Debug, Serialize)]
pub struct AuditLogEntry {
    pub id: String,
    pub transaction_id: Option<String>,
    pub field_changed: String,
    pub old_value: String,
    pub new_value: String,
    pub changed_at: i64,
}

#[tauri::command]
pub async fn get_audit_log(
    db: State<'_, DbState>,
    transaction_id: String,
) -> Result<Vec<AuditLogEntry>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, transaction_id, field_changed, old_value, new_value, changed_at
         FROM audit_log WHERE transaction_id = ?1
         ORDER BY changed_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![transaction_id], |row| {
        Ok(AuditLogEntry {
            id: row.get(0)?,
            transaction_id: row.get(1)?,
            field_changed: row.get(2)?,
            old_value: row.get(3)?,
            new_value: row.get(4)?,
            changed_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        entries.push(row.map_err(|e| e.to_string())?);
    }
    Ok(entries)
}

// ── Phase 13: Backup & Restore ───────────────────────────

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub path: String,
    pub size: u64,
}

#[tauri::command]
pub async fn export_database(
    db: State<'_, DbState>,
    destination: String,
) -> Result<ExportResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Use SQLite backup API for safe copy
    conn.execute("VACUUM INTO ?1", params![destination])
        .map_err(|e| format!("Backup failed: {}", e))?;

    let size = std::fs::metadata(&destination)
        .map_err(|e| e.to_string())?
        .len();

    Ok(ExportResult { path: destination, size })
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub account_count: i64,
    pub transaction_count: i64,
}

#[tauri::command]
pub async fn import_database(
    db: State<'_, DbState>,
    source: String,
) -> Result<ImportResult, String> {
    // Validate source is a valid SQLite db with expected tables
    let source_conn = rusqlite::Connection::open(&source)
        .map_err(|e| format!("Invalid database file: {}", e))?;

    let has_accounts: bool = source_conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='accounts'",
        [], |row| row.get(0),
    ).map_err(|e| format!("Invalid database: {}", e))?;

    let has_transactions: bool = source_conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='transactions'",
        [], |row| row.get(0),
    ).map_err(|e| format!("Invalid database: {}", e))?;

    if !has_accounts || !has_transactions {
        return Err("Database is missing required tables (accounts, transactions)".to_string());
    }

    let account_count: i64 = source_conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let transaction_count: i64 = source_conn.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    drop(source_conn);

    // Replace the current database
    let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
    let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
    let company_dir = dir_guard.as_ref().ok_or("No file is open")?.clone();
    drop(dir_guard);
    let db_path = format!("{}/company.sqlite", company_dir);

    // Close current connection by replacing it
    if let Some(ref c) = *conn_guard {
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();
    }

    // Copy source over the current db
    std::fs::copy(&source, &db_path)
        .map_err(|e| format!("Failed to replace database: {}", e))?;

    // Reopen
    let new_conn = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to reopen database: {}", e))?;
    new_conn.execute_batch("PRAGMA journal_mode=WAL;").ok();
    new_conn.execute_batch("PRAGMA foreign_keys=ON;").ok();
    *conn_guard = Some(new_conn);

    Ok(ImportResult { account_count, transaction_count })
}

#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub filename: String,
    pub size: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
pub struct AutoBackupResult {
    pub path: String,
    pub backup_count: usize,
}

#[tauri::command]
pub async fn auto_backup(
    db: State<'_, DbState>,
) -> Result<AutoBackupResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let company_dir = db.company_dir.lock().map_err(|e| e.to_string())?
        .clone().ok_or("No file is open")?;
    let backups_dir = std::path::Path::new(&company_dir).join("backups");

    std::fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backups directory: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let backup_path = backups_dir.join(format!("bookkeeping-{}.db", timestamp));
    let backup_str = backup_path.to_string_lossy().to_string();

    // VACUUM INTO snapshots the kernel company.sqlite. Module .sqlite files and
    // documents are not included in this single-file backup — full directory
    // backup (zip) is a follow-up to add a `zip` crate dependency.
    conn.execute("VACUUM INTO ?1", params![backup_str])
        .map_err(|e| format!("Auto-backup failed: {}", e))?;

    // Keep only 5 most recent
    let mut backup_files: Vec<_> = std::fs::read_dir(&backups_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "db"))
        .collect();

    backup_files.sort_by_key(|e| std::cmp::Reverse(e.file_name()));

    if backup_files.len() > 5 {
        for old_file in &backup_files[5..] {
            std::fs::remove_file(old_file.path()).ok();
        }
    }

    let remaining = backup_files.len().min(5);

    Ok(AutoBackupResult {
        path: backup_str,
        backup_count: remaining,
    })
}

#[tauri::command]
pub async fn list_backups(
    db: State<'_, DbState>,
) -> Result<Vec<BackupInfo>, String> {
    let company_dir = db.company_dir.lock().map_err(|e| e.to_string())?
        .clone().ok_or("No file is open")?;
    let backups_dir = std::path::Path::new(&company_dir).join("backups");

    if !backups_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<BackupInfo> = std::fs::read_dir(&backups_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "db"))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let filename = e.file_name().to_string_lossy().to_string();
            let created = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string()))
                .flatten()
                .unwrap_or_default();
            Some(BackupInfo {
                path: e.path().to_string_lossy().to_string(),
                filename,
                size: meta.len(),
                created_at: created,
            })
        })
        .collect();

    backups.sort_by(|a, b| b.filename.cmp(&a.filename));
    Ok(backups)
}

// ── Phase 14: CSV Export ─────────────────────────────────

fn cents_to_dollars(cents: i64) -> String {
    let negative = cents < 0;
    let abs = cents.unsigned_abs();
    let dollars = abs / 100;
    let remainder = abs % 100;
    if negative {
        format!("-{}.{:02}", dollars, remainder)
    } else {
        format!("{}.{:02}", dollars, remainder)
    }
}

#[tauri::command]
pub async fn export_csv(
    db: State<'_, DbState>,
    export_type: String,
    start_date: Option<String>,
    end_date: Option<String>,
    as_of_date: Option<String>,
    account_id: Option<String>,
    memo_search: Option<String>,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    match export_type.as_str() {
        "ChartOfAccounts" => {
            let mut csv = String::from("Account Number,Account Name,Type,Active,Balance\n");
            let mut stmt = conn.prepare(
                "SELECT a.id, a.code, a.name, a.type, a.is_active,
                        COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
                 FROM accounts a
                 LEFT JOIN journal_entries je ON je.account_id = a.id
                 GROUP BY a.id ORDER BY a.code"
            ).map_err(|e| e.to_string())?;

            let rows = stmt.query_map([], |row| {
                let acct_type: String = row.get(3)?;
                let td: i64 = row.get(5)?;
                let tc: i64 = row.get(6)?;
                let balance = if is_debit_normal(&acct_type) { td - tc } else { tc - td };
                Ok((row.get::<_, String>(1)?, row.get::<_, String>(2)?, acct_type,
                    row.get::<_, i64>(4)?, balance))
            }).map_err(|e| e.to_string())?;

            for row in rows {
                let (code, name, acct_type, active, balance) = row.map_err(|e| e.to_string())?;
                csv.push_str(&format!("{},\"{}\",{},{},{}\n",
                    code, name.replace('"', "\"\""), acct_type,
                    if active == 1 { "Yes" } else { "No" }, cents_to_dollars(balance)));
            }
            Ok(csv)
        }

        "TrialBalance" => {
            let aod = as_of_date.unwrap_or_else(|| "9999-12-31".to_string());
            let mut csv = String::from("Account Number,Account Name,Debit,Credit\n");
            let mut stmt = conn.prepare(
                "SELECT a.code, a.name, a.type,
                        COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
                 FROM accounts a
                 LEFT JOIN journal_entries je ON je.account_id = a.id
                 LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date <= ?1
                 WHERE a.is_active = 1
                 GROUP BY a.id ORDER BY a.code"
            ).map_err(|e| e.to_string())?;

            let mut total_debit: i64 = 0;
            let mut total_credit: i64 = 0;

            let rows = stmt.query_map(params![aod], |row| {
                let acct_type: String = row.get(2)?;
                let td: i64 = row.get(3)?;
                let tc: i64 = row.get(4)?;
                let net = if is_debit_normal(&acct_type) { td - tc } else { tc - td };
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, acct_type, net))
            }).map_err(|e| e.to_string())?;

            for row in rows {
                let (code, name, acct_type, net) = row.map_err(|e| e.to_string())?;
                if net == 0 { continue; }
                let (d, c) = if net >= 0 {
                    if is_debit_normal(&acct_type) { (net, 0) } else { (0, net) }
                } else {
                    if is_debit_normal(&acct_type) { (0, -net) } else { (-net, 0) }
                };
                total_debit += d;
                total_credit += c;
                csv.push_str(&format!("{},\"{}\",{},{}\n",
                    code, name.replace('"', "\"\""), cents_to_dollars(d), cents_to_dollars(c)));
            }
            csv.push_str(&format!("TOTAL,,{},{}\n", cents_to_dollars(total_debit), cents_to_dollars(total_credit)));
            Ok(csv)
        }

        "IncomeStatement" => {
            let sd = start_date.unwrap_or_else(|| "0000-01-01".to_string());
            let ed = end_date.unwrap_or_else(|| "9999-12-31".to_string());
            let mut csv = String::from("Account Name,Type,Amount\n");

            let mut stmt = conn.prepare(
                "SELECT a.name, a.type,
                        COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
                 FROM accounts a
                 LEFT JOIN journal_entries je ON je.account_id = a.id
                 LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2
                 WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
                 GROUP BY a.id ORDER BY a.type, a.code"
            ).map_err(|e| e.to_string())?;

            let rows = stmt.query_map(params![sd, ed], |row| {
                let acct_type: String = row.get(1)?;
                let td: i64 = row.get(2)?;
                let tc: i64 = row.get(3)?;
                let balance = if is_debit_normal(&acct_type) { td - tc } else { tc - td };
                Ok((row.get::<_, String>(0)?, acct_type, balance))
            }).map_err(|e| e.to_string())?;

            let mut total_rev: i64 = 0;
            let mut total_exp: i64 = 0;
            for row in rows {
                let (name, acct_type, balance) = row.map_err(|e| e.to_string())?;
                if balance == 0 { continue; }
                match acct_type.as_str() {
                    "REVENUE" => total_rev += balance,
                    "EXPENSE" => total_exp += balance,
                    _ => {}
                }
                csv.push_str(&format!("\"{}\",{},{}\n", name.replace('"', "\"\""), acct_type, cents_to_dollars(balance)));
            }
            csv.push_str(&format!("Net Income,,{}\n", cents_to_dollars(total_rev - total_exp)));
            Ok(csv)
        }

        "BalanceSheet" => {
            let aod = as_of_date.unwrap_or_else(|| "9999-12-31".to_string());
            let mut csv = String::from("Account Name,Type,Amount\n");

            let mut stmt = conn.prepare(
                "SELECT a.name, a.type,
                        COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
                 FROM accounts a
                 LEFT JOIN journal_entries je ON je.account_id = a.id
                 LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date <= ?1
                 WHERE a.is_active = 1
                 GROUP BY a.id ORDER BY a.type, a.code"
            ).map_err(|e| e.to_string())?;

            let rows = stmt.query_map(params![aod], |row| {
                let acct_type: String = row.get(1)?;
                let td: i64 = row.get(2)?;
                let tc: i64 = row.get(3)?;
                let balance = if is_debit_normal(&acct_type) { td - tc } else { tc - td };
                Ok((row.get::<_, String>(0)?, acct_type, balance))
            }).map_err(|e| e.to_string())?;

            for row in rows {
                let (name, acct_type, balance) = row.map_err(|e| e.to_string())?;
                if balance == 0 { continue; }
                csv.push_str(&format!("\"{}\",{},{}\n", name.replace('"', "\"\""), acct_type, cents_to_dollars(balance)));
            }
            Ok(csv)
        }

        "TransactionRegister" => {
            let mut csv = String::from("Date,Reference,Description,Account,Debit,Credit\n");
            let mut where_clauses: Vec<String> = Vec::new();
            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            let mut idx = 1;

            if let Some(ref sd) = start_date {
                where_clauses.push(format!("t.date >= ?{}", idx)); idx += 1;
                param_values.push(Box::new(sd.clone()));
            }
            if let Some(ref ed) = end_date {
                where_clauses.push(format!("t.date <= ?{}", idx)); idx += 1;
                param_values.push(Box::new(ed.clone()));
            }
            if let Some(ref aid) = account_id {
                where_clauses.push(format!("t.id IN (SELECT transaction_id FROM journal_entries WHERE account_id = ?{})", idx)); idx += 1;
                param_values.push(Box::new(aid.clone()));
            }
            if let Some(ref memo) = memo_search {
                where_clauses.push(format!("LOWER(t.description) LIKE ?{}", idx));
                let _ = idx;
                param_values.push(Box::new(format!("%{}%", memo.to_lowercase())));
            }

            let where_sql = if where_clauses.is_empty() { String::new() }
                else { format!(" WHERE {}", where_clauses.join(" AND ")) };

            let query = format!(
                "SELECT t.date, t.reference, t.description, a.name, je.debit, je.credit
                 FROM journal_entries je
                 JOIN transactions t ON je.transaction_id = t.id
                 JOIN accounts a ON je.account_id = a.id
                 {} ORDER BY t.date, t.created_at, je.rowid", where_sql);

            let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
            let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params_refs.as_slice(), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            }).map_err(|e| e.to_string())?;

            for row in rows {
                let (date, reference, desc, acct_name, debit, credit) = row.map_err(|e| e.to_string())?;
                csv.push_str(&format!("{},{},\"{}\",\"{}\",{},{}\n",
                    date, reference.unwrap_or_default(),
                    desc.replace('"', "\"\""), acct_name.replace('"', "\"\""),
                    cents_to_dollars(debit), cents_to_dollars(credit)));
            }
            Ok(csv)
        }

        _ => Err(format!("Unknown export type: {}", export_type)),
    }
}

// ── Phase 15: Settings & Preferences ─────────────────────

#[tauri::command]
pub async fn get_setting(
    db: State<'_, DbState>,
    key: String,
) -> Result<Option<String>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let result: Option<String> = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    ).ok();
    Ok(result)
}

#[tauri::command]
pub async fn set_setting(
    db: State<'_, DbState>,
    key: String,
    value: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_all_settings(
    db: State<'_, DbState>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;

    let mut map = std::collections::HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

// ── Phase 16: Period Management ──────────────────────────

#[derive(Debug, Serialize)]
pub struct LockedPeriod {
    pub id: String,
    pub end_date: String,
    pub locked_at: i64,
}

#[tauri::command]
pub async fn lock_period_global(
    db: State<'_, DbState>,
    end_date: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check no existing lock is after this date (sequential enforcement)
    let existing_after: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end >= ?1 AND is_locked = 1",
        params![end_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if existing_after {
        return Err("Cannot lock: a later period is already locked (would create gap)".to_string());
    }

    // Check for exact duplicate — idempotent
    let exact_dup: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND period_end = ?1 AND is_locked = 1",
        params![end_date],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if exact_dup {
        return Ok(());
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();
    conn.execute(
        "INSERT INTO reconciliation_periods (id, account_id, period_start, period_end, is_locked, locked_at)
         VALUES (?1, 'GLOBAL', '0000-01-01', ?2, 1, ?3)",
        params![id, end_date, now],
    ).map_err(|e| e.to_string())?;

    let payload = serde_json::json!({ "end_date": end_date });
    drop(guard);
    crate::events::emit_event(&db, "period.locked", payload);
    Ok(())
}

#[tauri::command]
pub async fn unlock_period_global(
    db: State<'_, DbState>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let latest_id: Option<String> = conn.query_row(
        "SELECT id FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND is_locked = 1 ORDER BY period_end DESC LIMIT 1",
        [],
        |row| row.get(0),
    ).ok();

    match latest_id {
        Some(id) => {
            conn.execute("DELETE FROM reconciliation_periods WHERE id = ?1", params![id])
                .map_err(|e| e.to_string())?;
            Ok(())
        }
        None => Err("No locked periods to unlock".to_string()),
    }
}

#[tauri::command]
pub async fn list_locked_periods_global(
    db: State<'_, DbState>,
) -> Result<Vec<LockedPeriod>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, period_end, locked_at FROM reconciliation_periods WHERE account_id = 'GLOBAL' AND is_locked = 1 ORDER BY period_end DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(LockedPeriod {
            id: row.get(0)?,
            end_date: row.get(1)?,
            locked_at: row.get(2)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut periods = Vec::new();
    for row in rows {
        periods.push(row.map_err(|e| e.to_string())?);
    }
    Ok(periods)
}

// ── Phase 17: Report Enhancements ────────────────────────

#[derive(Debug, Serialize)]
pub struct LedgerEntry {
    pub transaction_id: String,
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    pub debit: i64,
    pub credit: i64,
    pub running_balance: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AccountLedgerResult {
    pub account_id: String,
    pub account_code: String,
    pub account_name: String,
    pub account_type: String,
    pub entries: Vec<LedgerEntry>,
    pub total: i64,
}

#[tauri::command]
pub async fn get_account_ledger(
    db: State<'_, DbState>,
    account_id: String,
    start_date: Option<String>,
    end_date: Option<String>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<AccountLedgerResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let acct = conn.query_row(
        "SELECT id, code, name, type FROM accounts WHERE id = ?1",
        params![account_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, String>(3)?)),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

    let (_, acct_code, acct_name, acct_type) = acct;

    let mut where_clauses = vec!["je.account_id = ?1".to_string()];
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(account_id.clone())];
    let mut idx = 2;

    if let Some(ref sd) = start_date {
        where_clauses.push(format!("t.date >= ?{}", idx)); idx += 1;
        param_values.push(Box::new(sd.clone()));
    }
    if let Some(ref ed) = end_date {
        where_clauses.push(format!("t.date <= ?{}", idx));
        let _ = idx;
        param_values.push(Box::new(ed.clone()));
    }

    let where_sql = format!(" WHERE {}", where_clauses.join(" AND "));

    // Count total
    let count_query = format!(
        "SELECT COUNT(*) FROM journal_entries je JOIN transactions t ON je.transaction_id = t.id{}",
        where_sql
    );
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
    let total: i64 = conn.query_row(&count_query, params_refs.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?;

    // Fetch entries
    let lim = limit.unwrap_or(100);
    let off = offset.unwrap_or(0);
    let data_query = format!(
        "SELECT t.id, t.date, t.description, t.reference, je.debit, je.credit, je.memo
         FROM journal_entries je
         JOIN transactions t ON je.transaction_id = t.id
         {} ORDER BY t.date ASC, t.created_at ASC LIMIT {} OFFSET {}",
        where_sql, lim, off
    );

    let mut stmt = conn.prepare(&data_query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, Option<String>>(6)?,
        ))
    }).map_err(|e| e.to_string())?;

    let is_debit = is_debit_normal(&acct_type);
    let mut running: i64 = 0;
    let mut entries = Vec::new();

    for row in rows {
        let (tx_id, date, desc, reference, debit, credit, memo) = row.map_err(|e| e.to_string())?;
        if is_debit {
            running += debit - credit;
        } else {
            running += credit - debit;
        }
        entries.push(LedgerEntry {
            transaction_id: tx_id,
            date,
            description: desc,
            reference,
            debit,
            credit,
            running_balance: running,
            memo,
        });
    }

    Ok(AccountLedgerResult {
        account_id,
        account_code: acct_code,
        account_name: acct_name,
        account_type: acct_type,
        entries,
        total,
    })
}

// ── Phase 32: Dimensions/Tags Engine ────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Dimension {
    pub id: String,
    #[serde(rename = "type")]
    pub dim_type: String,
    pub name: String,
    pub code: Option<String>,
    pub parent_id: Option<String>,
    pub is_active: i64,
    pub created_at: String,
    pub depth: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LineDimension {
    pub transaction_line_id: String,
    pub dimension_id: String,
    pub dimension_type: String,
    pub dimension_name: String,
}

#[tauri::command]
pub async fn create_dimension(
    db: State<'_, DbState>,
    dim_type: String,
    name: String,
    code: Option<String>,
    parent_id: Option<String>,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Validate parent exists and is same type
    if let Some(ref pid) = parent_id {
        let parent_type: String = conn.query_row(
            "SELECT type FROM dimensions WHERE id = ?1",
            params![pid],
            |row| row.get(0),
        ).map_err(|_| format!("Parent dimension not found: {}", pid))?;
        if parent_type != dim_type {
            return Err(format!("Parent dimension type '{}' does not match '{}'", parent_type, dim_type));
        }
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    conn.execute(
        "INSERT INTO dimensions (id, type, name, code, parent_id, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
        params![id, dim_type, name, code, parent_id, now],
    ).map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            format!("Dimension '{}' of type '{}' already exists", name, dim_type)
        } else {
            e.to_string()
        }
    })?;

    Ok(id)
}

#[tauri::command]
pub async fn update_dimension(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    code: Option<String>,
    parent_id: Option<String>,
    is_active: Option<i64>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check dimension exists
    let (current_type, _current_name): (String, String) = conn.query_row(
        "SELECT type, name FROM dimensions WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| format!("Dimension not found: {}", id))?;

    // Validate parent if provided
    if let Some(ref pid) = parent_id {
        let parent_type: String = conn.query_row(
            "SELECT type FROM dimensions WHERE id = ?1",
            params![pid],
            |row| row.get(0),
        ).map_err(|_| format!("Parent dimension not found: {}", pid))?;
        if parent_type != current_type {
            return Err(format!("Parent dimension type '{}' does not match '{}'", parent_type, current_type));
        }
        // Check for circular reference
        let mut current = Some(pid.clone());
        let mut depth = 0;
        while let Some(ref cid) = current {
            if cid == &id {
                return Err("Circular parent reference detected".to_string());
            }
            depth += 1;
            if depth > 10 { break; }
            current = conn.query_row(
                "SELECT parent_id FROM dimensions WHERE id = ?1",
                params![cid],
                |row| row.get(0),
            ).unwrap_or(None);
        }
    }

    if let Some(ref n) = name {
        conn.execute("UPDATE dimensions SET name = ?1 WHERE id = ?2", params![n, id])
            .map_err(|e| {
                if e.to_string().contains("UNIQUE") {
                    format!("Dimension '{}' of type '{}' already exists", n, current_type)
                } else {
                    e.to_string()
                }
            })?;
    }
    if let Some(ref c) = code {
        conn.execute("UPDATE dimensions SET code = ?1 WHERE id = ?2", params![c, id])
            .map_err(|e| e.to_string())?;
    }
    if parent_id.is_some() {
        conn.execute("UPDATE dimensions SET parent_id = ?1 WHERE id = ?2", params![parent_id, id])
            .map_err(|e| e.to_string())?;
    }
    if let Some(active) = is_active {
        conn.execute("UPDATE dimensions SET is_active = ?1 WHERE id = ?2", params![active, id])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub async fn list_dimensions(
    db: State<'_, DbState>,
    dim_type: Option<String>,
) -> Result<Vec<Dimension>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let (query, param_val) = match &dim_type {
        Some(t) => (
            format!("SELECT id, type, name, code, parent_id, is_active, created_at FROM dimensions WHERE type = '{}' ORDER BY name", t),
            None,
        ),
        None => (
            "SELECT id, type, name, code, parent_id, is_active, created_at FROM dimensions ORDER BY type, name".to_string(),
            None::<String>,
        ),
    };
    let _ = param_val; // suppress unused warning

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(Dimension {
            id: row.get(0)?,
            dim_type: row.get(1)?,
            name: row.get(2)?,
            code: row.get(3)?,
            parent_id: row.get(4)?,
            is_active: row.get(5)?,
            created_at: row.get(6)?,
            depth: 0,
        })
    }).map_err(|e| e.to_string())?;

    let mut dims: Vec<Dimension> = Vec::new();
    for row in rows {
        dims.push(row.map_err(|e| e.to_string())?);
    }

    // Compute depth from parent chain
    let id_to_parent: std::collections::HashMap<String, Option<String>> = dims
        .iter()
        .map(|d| (d.id.clone(), d.parent_id.clone()))
        .collect();
    for d in &mut dims {
        let mut depth = 0i64;
        let mut current = d.parent_id.clone();
        while let Some(ref pid) = current {
            depth += 1;
            current = id_to_parent.get(pid).cloned().flatten();
            if depth > 10 { break; }
        }
        d.depth = depth;
    }

    Ok(dims)
}

#[tauri::command]
pub async fn list_dimension_types(
    db: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare("SELECT DISTINCT type FROM dimensions ORDER BY type")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let mut types = Vec::new();
    for row in rows {
        types.push(row.map_err(|e| e.to_string())?);
    }
    Ok(types)
}

#[tauri::command]
pub async fn delete_dimension(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check for transaction line references
    let ref_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transaction_line_dimensions WHERE dimension_id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if ref_count > 0 {
        return Err("Cannot delete dimension with transaction references. Deactivate instead.".to_string());
    }

    // Check for child dimensions
    let child_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM dimensions WHERE parent_id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if child_count > 0 {
        return Err("Cannot delete dimension with child dimensions".to_string());
    }

    conn.execute("DELETE FROM dimensions WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_transaction_dimensions(
    db: State<'_, DbState>,
    transaction_id: String,
) -> Result<Vec<LineDimension>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT tld.transaction_line_id, tld.dimension_id, d.type, d.name
         FROM transaction_line_dimensions tld
         JOIN dimensions d ON tld.dimension_id = d.id
         JOIN journal_entries je ON tld.transaction_line_id = je.id
         WHERE je.transaction_id = ?1
         ORDER BY tld.transaction_line_id, d.type, d.name"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![transaction_id], |row| {
        Ok(LineDimension {
            transaction_line_id: row.get(0)?,
            dimension_id: row.get(1)?,
            dimension_type: row.get(2)?,
            dimension_name: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

// ── Phase 33: Contact Registry ───────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct Contact {
    pub id: String,
    #[serde(rename = "type")]
    pub contact_type: String,
    pub name: String,
    pub company_name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub address_line1: Option<String>,
    pub address_line2: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub postal_code: Option<String>,
    pub country: Option<String>,
    pub tax_id: Option<String>,
    pub notes: Option<String>,
    pub is_active: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactLedgerEntry {
    pub transaction_id: String,
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    pub journal_type: String,
    pub total_debit: i64,
    pub total_credit: i64,
    pub running_balance: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactLedgerResult {
    pub contact_id: String,
    pub contact_name: String,
    pub entries: Vec<ContactLedgerEntry>,
    pub total_debits: i64,
    pub total_credits: i64,
    pub net_balance: i64,
}

#[tauri::command]
pub async fn create_contact(
    db: State<'_, DbState>,
    contact_type: String,
    name: String,
    company_name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    address_line1: Option<String>,
    address_line2: Option<String>,
    city: Option<String>,
    state: Option<String>,
    postal_code: Option<String>,
    country: Option<String>,
    tax_id: Option<String>,
    notes: Option<String>,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let valid_types = ["CUSTOMER", "VENDOR", "EMPLOYEE", "OTHER"];
    if !valid_types.contains(&contact_type.as_str()) {
        return Err(format!("Invalid contact type: {}", contact_type));
    }

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let country_val = country.unwrap_or_else(|| "US".to_string());

    conn.execute(
        "INSERT INTO contacts (id, type, name, company_name, email, phone, address_line1, address_line2, city, state, postal_code, country, tax_id, notes, is_active, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15, ?15)",
        params![id, contact_type, name, company_name, email, phone, address_line1, address_line2, city, state, postal_code, country_val, tax_id, notes, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn update_contact(
    db: State<'_, DbState>,
    id: String,
    name: Option<String>,
    company_name: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    address_line1: Option<String>,
    address_line2: Option<String>,
    city: Option<String>,
    state: Option<String>,
    postal_code: Option<String>,
    country: Option<String>,
    tax_id: Option<String>,
    notes: Option<String>,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check exists
    let _exists: String = conn.query_row(
        "SELECT id FROM contacts WHERE id = ?1", params![id], |row| row.get(0),
    ).map_err(|_| format!("Contact not found: {}", id))?;

    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    if let Some(ref v) = name { conn.execute("UPDATE contacts SET name = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = company_name { conn.execute("UPDATE contacts SET company_name = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = email { conn.execute("UPDATE contacts SET email = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = phone { conn.execute("UPDATE contacts SET phone = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = address_line1 { conn.execute("UPDATE contacts SET address_line1 = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = address_line2 { conn.execute("UPDATE contacts SET address_line2 = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = city { conn.execute("UPDATE contacts SET city = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = state { conn.execute("UPDATE contacts SET state = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = postal_code { conn.execute("UPDATE contacts SET postal_code = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = country { conn.execute("UPDATE contacts SET country = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = tax_id { conn.execute("UPDATE contacts SET tax_id = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }
    if let Some(ref v) = notes { conn.execute("UPDATE contacts SET notes = ?1, updated_at = ?3 WHERE id = ?2", params![v, id, now]).map_err(|e| e.to_string())?; }

    Ok(())
}

#[tauri::command]
pub async fn get_contact(
    db: State<'_, DbState>,
    id: String,
) -> Result<Contact, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    conn.query_row(
        "SELECT id, type, name, company_name, email, phone, address_line1, address_line2, city, state, postal_code, country, tax_id, notes, is_active, created_at, updated_at
         FROM contacts WHERE id = ?1",
        params![id],
        |row| Ok(Contact {
            id: row.get(0)?,
            contact_type: row.get(1)?,
            name: row.get(2)?,
            company_name: row.get(3)?,
            email: row.get(4)?,
            phone: row.get(5)?,
            address_line1: row.get(6)?,
            address_line2: row.get(7)?,
            city: row.get(8)?,
            state: row.get(9)?,
            postal_code: row.get(10)?,
            country: row.get(11)?,
            tax_id: row.get(12)?,
            notes: row.get(13)?,
            is_active: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        }),
    ).map_err(|_| format!("Contact not found: {}", id))
}

#[tauri::command]
pub async fn list_contacts(
    db: State<'_, DbState>,
    contact_type: Option<String>,
    search: Option<String>,
    is_active: Option<i64>,
) -> Result<Vec<Contact>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut conditions = Vec::new();
    let mut param_values: Vec<String> = Vec::new();

    if let Some(ref t) = contact_type {
        param_values.push(t.clone());
        conditions.push(format!("type = ?{}", param_values.len()));
    }
    if let Some(ref s) = search {
        let like = format!("%{}%", s);
        param_values.push(like.clone());
        let idx = param_values.len();
        param_values.push(like.clone());
        let idx2 = param_values.len();
        param_values.push(like);
        let idx3 = param_values.len();
        conditions.push(format!("(name LIKE ?{} OR company_name LIKE ?{} OR email LIKE ?{})", idx, idx2, idx3));
    }
    if let Some(active) = is_active {
        param_values.push(active.to_string());
        conditions.push(format!("is_active = ?{}", param_values.len()));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", conditions.join(" AND "))
    };

    let query = format!(
        "SELECT id, type, name, company_name, email, phone, address_line1, address_line2, city, state, postal_code, country, tax_id, notes, is_active, created_at, updated_at
         FROM contacts{} ORDER BY name",
        where_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(Contact {
            id: row.get(0)?,
            contact_type: row.get(1)?,
            name: row.get(2)?,
            company_name: row.get(3)?,
            email: row.get(4)?,
            phone: row.get(5)?,
            address_line1: row.get(6)?,
            address_line2: row.get(7)?,
            city: row.get(8)?,
            state: row.get(9)?,
            postal_code: row.get(10)?,
            country: row.get(11)?,
            tax_id: row.get(12)?,
            notes: row.get(13)?,
            is_active: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn deactivate_contact(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let rows = conn.execute("UPDATE contacts SET is_active = 0, updated_at = ?2 WHERE id = ?1", params![id, now])
        .map_err(|e| e.to_string())?;
    if rows == 0 { return Err(format!("Contact not found: {}", id)); }
    Ok(())
}

#[tauri::command]
pub async fn reactivate_contact(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
    let rows = conn.execute("UPDATE contacts SET is_active = 1, updated_at = ?2 WHERE id = ?1", params![id, now])
        .map_err(|e| e.to_string())?;
    if rows == 0 { return Err(format!("Contact not found: {}", id)); }
    Ok(())
}

#[tauri::command]
pub async fn delete_contact(
    db: State<'_, DbState>,
    id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let ref_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transaction_contacts WHERE contact_id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    if ref_count > 0 {
        return Err("Cannot delete contact with transaction references. Deactivate instead.".to_string());
    }

    let rows = conn.execute("DELETE FROM contacts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if rows == 0 { return Err(format!("Contact not found: {}", id)); }
    Ok(())
}

#[tauri::command]
pub async fn link_transaction_contact(
    db: State<'_, DbState>,
    transaction_id: String,
    contact_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Validate contact exists
    let _: String = conn.query_row(
        "SELECT id FROM contacts WHERE id = ?1", params![contact_id], |row| row.get(0),
    ).map_err(|_| format!("Contact not found: {}", contact_id))?;

    // Validate transaction exists
    let _: String = conn.query_row(
        "SELECT id FROM transactions WHERE id = ?1", params![transaction_id], |row| row.get(0),
    ).map_err(|_| format!("Transaction not found: {}", transaction_id))?;

    // Remove existing PRIMARY link if any
    conn.execute(
        "DELETE FROM transaction_contacts WHERE transaction_id = ?1 AND role = 'PRIMARY'",
        params![transaction_id],
    ).map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO transaction_contacts (id, transaction_id, contact_id, role) VALUES (?1, ?2, ?3, 'PRIMARY')",
        params![id, transaction_id, contact_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn unlink_transaction_contact(
    db: State<'_, DbState>,
    transaction_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    conn.execute(
        "DELETE FROM transaction_contacts WHERE transaction_id = ?1 AND role = 'PRIMARY'",
        params![transaction_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_contact_ledger(
    db: State<'_, DbState>,
    contact_id: String,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<ContactLedgerResult, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let contact_name: String = conn.query_row(
        "SELECT name FROM contacts WHERE id = ?1", params![contact_id], |row| row.get(0),
    ).map_err(|_| format!("Contact not found: {}", contact_id))?;

    let mut date_clause = String::new();
    if let Some(ref sd) = start_date {
        date_clause.push_str(&format!(" AND t.date >= '{}'", sd));
    }
    if let Some(ref ed) = end_date {
        date_clause.push_str(&format!(" AND t.date <= '{}'", ed));
    }

    let query = format!(
        "SELECT t.id, t.date, t.description, t.reference, t.journal_type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM transactions t
         JOIN transaction_contacts tc ON tc.transaction_id = t.id
         JOIN journal_entries je ON je.transaction_id = t.id
         WHERE tc.contact_id = ?1 AND t.is_void = 0{}
         GROUP BY t.id
         ORDER BY t.date, t.created_at",
        date_clause
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![contact_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut running = 0i64;
    let mut total_debits = 0i64;
    let mut total_credits = 0i64;

    for row in rows {
        let (tx_id, date, desc, reference, jtype, debit, credit) = row.map_err(|e| e.to_string())?;
        running += debit - credit;
        total_debits += debit;
        total_credits += credit;
        entries.push(ContactLedgerEntry {
            transaction_id: tx_id,
            date,
            description: desc,
            reference,
            journal_type: jtype,
            total_debit: debit,
            total_credit: credit,
            running_balance: running,
        });
    }

    Ok(ContactLedgerResult {
        contact_id: contact_id.clone(),
        contact_name,
        entries,
        total_debits,
        total_credits,
        net_balance: running,
    })
}

#[tauri::command]
pub async fn get_contact_balance(
    db: State<'_, DbState>,
    contact_id: String,
    as_of: Option<String>,
) -> Result<i64, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Validate contact exists
    let _: String = conn.query_row(
        "SELECT id FROM contacts WHERE id = ?1", params![contact_id], |row| row.get(0),
    ).map_err(|_| format!("Contact not found: {}", contact_id))?;

    let date_clause = match &as_of {
        Some(d) => format!(" AND t.date <= '{}'", d),
        None => String::new(),
    };

    let query = format!(
        "SELECT COALESCE(SUM(je.debit), 0) - COALESCE(SUM(je.credit), 0)
         FROM journal_entries je
         JOIN transactions t ON je.transaction_id = t.id
         JOIN transaction_contacts tc ON tc.transaction_id = t.id
         WHERE tc.contact_id = ?1 AND t.is_void = 0{}",
        date_clause
    );

    let balance: i64 = conn.query_row(&query, params![contact_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(balance)
}

// ── Phase 34: General Ledger ─────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct GLEntryDimension {
    #[serde(rename = "type")]
    pub dim_type: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GLEntry {
    pub transaction_id: String,
    pub transaction_line_id: String,
    pub date: String,
    pub reference: Option<String>,
    pub description: String,
    pub debit: i64,
    pub credit: i64,
    pub running_balance: i64,
    pub contact_name: Option<String>,
    pub dimensions: Vec<GLEntryDimension>,
    pub is_void: bool,
    pub journal_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GLAccountInfo {
    pub id: String,
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub acct_type: String,
    pub normal_balance: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GLAccountGroup {
    pub account: GLAccountInfo,
    pub opening_balance: i64,
    pub entries: Vec<GLEntry>,
    pub closing_balance: i64,
    pub total_debits: i64,
    pub total_credits: i64,
}

#[tauri::command]
pub async fn get_general_ledger(
    db: State<'_, DbState>,
    account_id: Option<String>,
    account_ids: Option<Vec<String>>,
    start_date: Option<String>,
    end_date: Option<String>,
    contact_id: Option<String>,
    journal_type: Option<String>,
    include_void: Option<bool>,
) -> Result<Vec<GLAccountGroup>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let include_void = include_void.unwrap_or(false);

    // Get target accounts
    let accounts_query = match (&account_id, &account_ids) {
        (Some(id), _) => format!("SELECT id, code, name, type, normal_balance FROM accounts WHERE id = '{}' AND is_active = 1 ORDER BY code", id),
        (None, Some(ids)) if !ids.is_empty() => {
            let quoted: Vec<String> = ids.iter().map(|id| format!("'{}'", id)).collect();
            format!("SELECT id, code, name, type, normal_balance FROM accounts WHERE id IN ({}) AND is_active = 1 ORDER BY code", quoted.join(","))
        }
        _ => "SELECT id, code, name, type, normal_balance FROM accounts WHERE is_active = 1 ORDER BY code".to_string(),
    };

    let mut acct_stmt = conn.prepare(&accounts_query).map_err(|e| e.to_string())?;
    let acct_rows = acct_stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut target_accounts = Vec::new();
    for row in acct_rows {
        target_accounts.push(row.map_err(|e| e.to_string())?);
    }

    // Build contact filter
    let contact_join = if contact_id.is_some() {
        " JOIN transaction_contacts tc ON tc.transaction_id = t.id"
    } else { "" };
    let contact_where = if let Some(ref cid) = contact_id {
        format!(" AND tc.contact_id = '{}'", cid)
    } else { String::new() };

    let mut result = Vec::new();

    for (acct_id, code, name, acct_type, normal_balance) in &target_accounts {
        let is_debit_norm = normal_balance == "DEBIT";

        // Opening balance: sum of entries before start_date
        let opening_balance = if let Some(ref sd) = start_date {
            let void_clause = if !include_void { " AND t.is_void = 0" } else { "" };
            let oq = format!(
                "SELECT COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
                 FROM journal_entries je
                 JOIN transactions t ON je.transaction_id = t.id
                 WHERE je.account_id = ?1 AND t.date < ?2{}",
                void_clause
            );
            let (d, c): (i64, i64) = conn.query_row(&oq, params![acct_id, sd], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?;
            if is_debit_norm { d - c } else { c - d }
        } else { 0 };

        // Build entry query with filters
        let mut where_clauses = vec![format!("je.account_id = '{}'", acct_id)];
        if !include_void {
            where_clauses.push("t.is_void = 0".to_string());
        }
        if let Some(ref sd) = start_date {
            where_clauses.push(format!("t.date >= '{}'", sd));
        }
        if let Some(ref ed) = end_date {
            where_clauses.push(format!("t.date <= '{}'", ed));
        }
        if let Some(ref jt) = journal_type {
            where_clauses.push(format!("t.journal_type = '{}'", jt));
        }

        let entry_query = format!(
            "SELECT je.id, je.transaction_id, je.debit, je.credit, je.memo,
                    t.date, t.reference, t.description, t.is_void, t.journal_type
             FROM journal_entries je
             JOIN transactions t ON je.transaction_id = t.id{}
             WHERE {}{}
             ORDER BY t.date, t.created_at, je.id",
            contact_join,
            where_clauses.join(" AND "),
            contact_where
        );

        let mut entry_stmt = conn.prepare(&entry_query).map_err(|e| e.to_string())?;
        let entry_rows = entry_stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,  // je.id
                row.get::<_, String>(1)?,  // transaction_id
                row.get::<_, i64>(2)?,     // debit
                row.get::<_, i64>(3)?,     // credit
                row.get::<_, Option<String>>(4)?, // memo
                row.get::<_, String>(5)?,  // date
                row.get::<_, Option<String>>(6)?, // reference
                row.get::<_, String>(7)?,  // description
                row.get::<_, i64>(8)?,     // is_void
                row.get::<_, String>(9)?,  // journal_type
            ))
        }).map_err(|e| e.to_string())?;

        let mut entries = Vec::new();
        let mut running = opening_balance;
        let mut total_debits: i64 = 0;
        let mut total_credits: i64 = 0;

        for row in entry_rows {
            let (line_id, tx_id, debit, credit, memo, date, reference, description, is_void_i, jtype) =
                row.map_err(|e| e.to_string())?;

            if is_debit_norm {
                running += debit - credit;
            } else {
                running += credit - debit;
            }
            total_debits += debit;
            total_credits += credit;

            // Get contact name
            let contact_name: Option<String> = conn.query_row(
                "SELECT c.name FROM transaction_contacts tc JOIN contacts c ON tc.contact_id = c.id WHERE tc.transaction_id = ?1 AND tc.role = 'PRIMARY' LIMIT 1",
                params![tx_id],
                |row| row.get(0),
            ).ok();

            // Get dimensions for this line
            let mut dim_stmt = conn.prepare(
                "SELECT d.type, d.name FROM transaction_line_dimensions tld JOIN dimensions d ON tld.dimension_id = d.id WHERE tld.transaction_line_id = ?1"
            ).map_err(|e| e.to_string())?;
            let dim_rows = dim_stmt.query_map(params![line_id], |row| {
                Ok(GLEntryDimension { dim_type: row.get(0)?, name: row.get(1)? })
            }).map_err(|e| e.to_string())?;
            let mut dims = Vec::new();
            for dr in dim_rows {
                dims.push(dr.map_err(|e| e.to_string())?);
            }

            entries.push(GLEntry {
                transaction_id: tx_id,
                transaction_line_id: line_id,
                date,
                reference,
                description: memo.unwrap_or(description),
                debit,
                credit,
                running_balance: running,
                contact_name,
                dimensions: dims,
                is_void: is_void_i != 0,
                journal_type: jtype,
            });
        }

        if !entries.is_empty() || opening_balance != 0 {
            result.push(GLAccountGroup {
                account: GLAccountInfo {
                    id: acct_id.clone(),
                    code: code.clone(),
                    name: name.clone(),
                    acct_type: acct_type.clone(),
                    normal_balance: normal_balance.clone(),
                },
                opening_balance,
                entries,
                closing_balance: running,
                total_debits,
                total_credits,
            });
        }
    }

    Ok(result)
}

// ── Phase 35: Document Attachments ───────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentMeta {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub filename: String,
    pub stored_filename: String,
    pub mime_type: String,
    pub file_size_bytes: i64,
    pub description: Option<String>,
    pub uploaded_at: String,
    pub uploaded_by: String,
}

fn guess_mime_type(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "csv" => "text/csv",
        "txt" => "text/plain",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _ => "application/octet-stream",
    }.to_string()
}

fn get_documents_dir(db: &DbState) -> Result<String, String> {
    let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
    let dir = dir_guard.as_ref().ok_or("No file is open")?;
    Ok(format!("{}/documents", dir))
}

#[tauri::command]
pub async fn attach_document(
    db: State<'_, DbState>,
    entity_type: String,
    entity_id: String,
    file_path: String,
    filename: String,
    description: Option<String>,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let valid_types = ["TRANSACTION", "CONTACT", "ACCOUNT"];
    if !valid_types.contains(&entity_type.as_str()) {
        return Err(format!("Invalid entity_type: {}", entity_type));
    }

    let table = match entity_type.as_str() {
        "TRANSACTION" => "transactions",
        "CONTACT" => "contacts",
        "ACCOUNT" => "accounts",
        _ => return Err("Invalid entity_type".to_string()),
    };
    let _: String = conn.query_row(
        &format!("SELECT id FROM {} WHERE id = ?1", table),
        params![entity_id],
        |row| row.get(0),
    ).map_err(|_| format!("{} not found: {}", entity_type, entity_id))?;

    let source_path = std::path::Path::new(&file_path);
    let file_size = std::fs::metadata(source_path)
        .map(|m| m.len() as i64)
        .unwrap_or(0);
    if file_size > 25 * 1024 * 1024 {
        return Err("File exceeds 25MB limit".to_string());
    }

    let id = Uuid::new_v4().to_string();
    let ext = filename.rsplit('.').next().map(|e| format!(".{}", e)).unwrap_or_default();
    let stored_filename = format!("{}{}", Uuid::new_v4(), ext);
    let mime_type = guess_mime_type(&filename);
    let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();

    let docs_dir = get_documents_dir(&db)?;
    let date_now = Utc::now();
    let year_month_dir = format!("{}/{:04}/{:02}", docs_dir, date_now.format("%Y"), date_now.format("%m"));
    std::fs::create_dir_all(&year_month_dir).map_err(|e| format!("Failed to create documents dir: {}", e))?;

    let dest_path = format!("{}/{}", year_month_dir, stored_filename);
    std::fs::copy(source_path, &dest_path).map_err(|e| format!("Failed to copy file: {}", e))?;

    conn.execute(
        "INSERT INTO documents (id, entity_type, entity_id, filename, stored_filename, mime_type, file_size_bytes, description, uploaded_at, uploaded_by)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'user')",
        params![id, entity_type, entity_id, filename, stored_filename, mime_type, file_size, description, now],
    ).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn list_documents(
    db: State<'_, DbState>,
    entity_type: String,
    entity_id: String,
) -> Result<Vec<DocumentMeta>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let mut stmt = conn.prepare(
        "SELECT id, entity_type, entity_id, filename, stored_filename, mime_type, file_size_bytes, description, uploaded_at, uploaded_by
         FROM documents WHERE entity_type = ?1 AND entity_id = ?2 ORDER BY uploaded_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![entity_type, entity_id], |row| {
        Ok(DocumentMeta {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            filename: row.get(3)?,
            stored_filename: row.get(4)?,
            mime_type: row.get(5)?,
            file_size_bytes: row.get(6)?,
            description: row.get(7)?,
            uploaded_at: row.get(8)?,
            uploaded_by: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn get_document_path(
    db: State<'_, DbState>,
    document_id: String,
) -> Result<String, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let (stored_filename, uploaded_at): (String, String) = conn.query_row(
        "SELECT stored_filename, uploaded_at FROM documents WHERE id = ?1",
        params![document_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|_| format!("Document not found: {}", document_id))?;

    let docs_dir = get_documents_dir(&db)?;
    let year = &uploaded_at[0..4];
    let month = &uploaded_at[5..7];
    Ok(format!("{}/{}/{}/{}", docs_dir, year, month, stored_filename))
}

#[tauri::command]
pub async fn delete_document(
    db: State<'_, DbState>,
    document_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Get file path before deleting metadata
    let result: Result<(String, String), _> = conn.query_row(
        "SELECT stored_filename, uploaded_at FROM documents WHERE id = ?1",
        params![document_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    );

    if let Ok((stored_filename, uploaded_at)) = result {
        let docs_dir = get_documents_dir(&db)?;
        let year = &uploaded_at[0..4];
        let month = &uploaded_at[5..7];
        let file_path = format!("{}/{}/{}/{}", docs_dir, year, month, stored_filename);
        let _ = std::fs::remove_file(&file_path);
    }

    let rows = conn.execute("DELETE FROM documents WHERE id = ?1", params![document_id])
        .map_err(|e| e.to_string())?;
    if rows == 0 {
        return Err(format!("Document not found: {}", document_id));
    }

    Ok(())
}

#[tauri::command]
pub async fn get_document_count(
    db: State<'_, DbState>,
    entity_type: String,
    entity_id: String,
) -> Result<i64, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM documents WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(count)
}

// ── Phase 38: Module Storage (ATTACH-based sandbox) ─────────

/// Get the path where a module's .sqlite file lives.
fn module_db_path(db: &DbState, module_id: &str) -> Result<String, String> {
    let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
    let dir = dir_guard.as_ref().ok_or("No file is open")?;
    Ok(format!("{}/modules/{}.sqlite", dir, module_id))
}

/// Verify that a module is currently attached. Used as a security check on every
/// module storage operation — modules cannot read/write through this API unless
/// they have been explicitly attached.
fn require_module_attached(db: &DbState, module_id: &str) -> Result<(), String> {
    validate_ident(module_id)?;
    let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
    if !attached.iter().any(|m| m == module_id) {
        return Err(format!("Module not attached: {}", module_id));
    }
    Ok(())
}

#[tauri::command]
pub async fn attach_module_db(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<(), String> {
    validate_ident(&module_id)?;

    // Make sure modules/ exists
    {
        let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
        let dir = dir_guard.as_ref().ok_or("No file is open")?.clone();
        std::fs::create_dir_all(format!("{}/modules", dir))
            .map_err(|e| format!("Failed to create modules dir: {}", e))?;
    }

    let path = module_db_path(&db, &module_id)?;

    // Check not already attached
    {
        let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        if attached.iter().any(|m| m == &module_id) {
            return Ok(()); // idempotent
        }
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // SQLite ATTACH does not support parameter binding for the path or alias,
    // so we sanitize the inputs and embed them directly.
    let sql = format!(
        "ATTACH DATABASE '{}' AS module_{};",
        path.replace('\'', "''"),
        sanitize_ident(&module_id)
    );
    conn.execute_batch(&sql).map_err(|e| format!("ATTACH failed: {}", e))?;

    // Initialize the module's _migrations table if it doesn't exist
    let init_sql = format!(
        "CREATE TABLE IF NOT EXISTS module_{}._migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
        sanitize_ident(&module_id)
    );
    conn.execute_batch(&init_sql).map_err(|e| e.to_string())?;

    drop(guard);
    let mut attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
    attached.push(module_id);
    Ok(())
}

#[tauri::command]
pub async fn detach_module_db(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<(), String> {
    validate_ident(&module_id)?;

    {
        let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        if !attached.iter().any(|m| m == &module_id) {
            return Ok(()); // idempotent
        }
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let sql = format!("DETACH DATABASE module_{};", sanitize_ident(&module_id));
    conn.execute_batch(&sql).map_err(|e| format!("DETACH failed: {}", e))?;
    drop(guard);

    let mut attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
    attached.retain(|m| m != &module_id);
    Ok(())
}

#[tauri::command]
pub async fn list_attached_modules(db: State<'_, DbState>) -> Result<Vec<String>, String> {
    let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
    Ok(attached.clone())
}

#[tauri::command]
pub async fn module_create_table(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    columns_sql: String,
) -> Result<(), String> {
    require_module_attached(&db, &module_id)?;
    validate_ident(&table_name)?;
    if table_name.starts_with('_') {
        return Err("Table names cannot start with underscore (reserved)".to_string());
    }

    // Reject any SQL injection attempts in columns_sql by checking for statement terminators
    if columns_sql.contains(';') {
        return Err("columns_sql cannot contain ';'".to_string());
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let sql = format!(
        "CREATE TABLE IF NOT EXISTS module_{}.{} ({});",
        sanitize_ident(&module_id),
        sanitize_ident(&table_name),
        columns_sql
    );
    conn.execute_batch(&sql).map_err(|e| format!("CREATE TABLE failed: {}", e))?;
    Ok(())
}

/// Helper: convert a serde_json::Value to an owned rusqlite ToSql wrapper.
fn json_value_to_sql(v: &serde_json::Value) -> Result<rusqlite::types::Value, String> {
    use rusqlite::types::Value;
    match v {
        serde_json::Value::Null => Ok(Value::Null),
        serde_json::Value::Bool(b) => Ok(Value::Integer(if *b { 1 } else { 0 })),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Value::Integer(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Value::Real(f))
            } else {
                Err(format!("Unsupported number: {}", n))
            }
        }
        serde_json::Value::String(s) => Ok(Value::Text(s.clone())),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            Ok(Value::Text(v.to_string()))
        }
    }
}

#[tauri::command]
pub async fn module_insert(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    row_json: serde_json::Value,
) -> Result<i64, String> {
    require_module_attached(&db, &module_id)?;
    validate_ident(&table_name)?;

    let obj = row_json.as_object().ok_or("row_json must be an object")?;
    if obj.is_empty() {
        return Err("row_json cannot be empty".to_string());
    }

    let mut cols: Vec<String> = Vec::new();
    let mut placeholders: Vec<String> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    for (i, (k, v)) in obj.iter().enumerate() {
        validate_ident(k)?;
        cols.push(sanitize_ident(k));
        placeholders.push(format!("?{}", i + 1));
        values.push(json_value_to_sql(v)?);
    }

    let sql = format!(
        "INSERT INTO module_{}.{} ({}) VALUES ({});",
        sanitize_ident(&module_id),
        sanitize_ident(&table_name),
        cols.join(", "),
        placeholders.join(", ")
    );

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("INSERT failed: {}", e))?;
    Ok(conn.last_insert_rowid())
}

#[derive(Debug, Deserialize)]
pub struct ModuleQueryFilter {
    pub column: String,
    pub op: String,
    pub value: serde_json::Value,
}

fn row_to_json(row: &rusqlite::Row, col_names: &[String]) -> Result<serde_json::Value, rusqlite::Error> {
    use rusqlite::types::ValueRef;
    let mut obj = serde_json::Map::new();
    for (i, name) in col_names.iter().enumerate() {
        let val = match row.get_ref(i)? {
            ValueRef::Null => serde_json::Value::Null,
            ValueRef::Integer(n) => serde_json::Value::Number(n.into()),
            ValueRef::Real(f) => serde_json::Number::from_f64(f)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null),
            ValueRef::Text(s) => serde_json::Value::String(String::from_utf8_lossy(s).into_owned()),
            ValueRef::Blob(_) => serde_json::Value::Null,
        };
        obj.insert(name.clone(), val);
    }
    Ok(serde_json::Value::Object(obj))
}

#[tauri::command]
pub async fn module_query(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    filters: Option<Vec<ModuleQueryFilter>>,
) -> Result<Vec<serde_json::Value>, String> {
    require_module_attached(&db, &module_id)?;
    validate_ident(&table_name)?;

    let allowed_ops = ["=", "!=", "<", ">", "<=", ">=", "LIKE"];
    let mut where_clauses: Vec<String> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(ref fs) = filters {
        for (i, f) in fs.iter().enumerate() {
            validate_ident(&f.column)?;
            if !allowed_ops.contains(&f.op.as_str()) {
                return Err(format!("Invalid filter op: {}", f.op));
            }
            where_clauses.push(format!("{} {} ?{}", sanitize_ident(&f.column), f.op, i + 1));
            values.push(json_value_to_sql(&f.value)?);
        }
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };

    let sql = format!(
        "SELECT * FROM module_{}.{}{};",
        sanitize_ident(&module_id),
        sanitize_ident(&table_name),
        where_sql
    );

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("SELECT failed: {}", e))?;
    let col_names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();

    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params_refs.as_slice(), |row| row_to_json(row, &col_names))
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for r in rows {
        result.push(r.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

#[tauri::command]
pub async fn module_update(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    id: serde_json::Value,
    fields: serde_json::Value,
) -> Result<usize, String> {
    require_module_attached(&db, &module_id)?;
    validate_ident(&table_name)?;

    let obj = fields.as_object().ok_or("fields must be an object")?;
    if obj.is_empty() {
        return Err("fields cannot be empty".to_string());
    }

    let mut set_clauses: Vec<String> = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    for (i, (k, v)) in obj.iter().enumerate() {
        validate_ident(k)?;
        set_clauses.push(format!("{} = ?{}", sanitize_ident(k), i + 1));
        values.push(json_value_to_sql(v)?);
    }
    let id_placeholder = values.len() + 1;
    values.push(json_value_to_sql(&id)?);

    let sql = format!(
        "UPDATE module_{}.{} SET {} WHERE id = ?{};",
        sanitize_ident(&module_id),
        sanitize_ident(&table_name),
        set_clauses.join(", "),
        id_placeholder
    );

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let params_refs: Vec<&dyn rusqlite::ToSql> = values.iter().map(|v| v as &dyn rusqlite::ToSql).collect();
    let n = conn.execute(&sql, params_refs.as_slice())
        .map_err(|e| format!("UPDATE failed: {}", e))?;
    Ok(n)
}

#[tauri::command]
pub async fn module_delete(
    db: State<'_, DbState>,
    module_id: String,
    table_name: String,
    id: serde_json::Value,
) -> Result<usize, String> {
    require_module_attached(&db, &module_id)?;
    validate_ident(&table_name)?;

    let id_val = json_value_to_sql(&id)?;
    let sql = format!(
        "DELETE FROM module_{}.{} WHERE id = ?1;",
        sanitize_ident(&module_id),
        sanitize_ident(&table_name)
    );

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let n = conn.execute(&sql, rusqlite::params![id_val])
        .map_err(|e| format!("DELETE failed: {}", e))?;
    Ok(n)
}

// ── Phase 39: Migration Coordinator ─────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MigrationSpec {
    pub version: i64,
    pub description: String,
    pub sql: String,
    pub checksum: String,
}

#[derive(Debug, Serialize)]
pub struct MigrationStatus {
    pub module_id: String,
    pub latest_version: i64,
    pub applied_count: i64,
    pub pending_count: i64,
    pub failed_count: i64,
    pub last_error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunMigrationsResult {
    pub applied: Vec<i64>,
    pub failed: Option<i64>,
    pub error: Option<String>,
}

/// Look up the SHA-256-style checksum recorded for a previously-applied
/// migration. Returns None if the migration hasn't been applied yet.
fn get_applied_checksum(
    conn: &rusqlite::Connection,
    module_id: &str,
    version: i64,
) -> Result<Option<String>, String> {
    let row: Option<Option<String>> = conn
        .query_row(
            "SELECT checksum FROM migration_log WHERE module_id = ?1 AND version = ?2 AND success = 1",
            params![module_id, version],
            |r| r.get::<_, Option<String>>(0),
        )
        .ok();
    Ok(row.flatten())
}

#[tauri::command]
pub async fn register_module_migrations(
    db: State<'_, DbState>,
    module_id: String,
    migrations: Vec<MigrationSpec>,
) -> Result<Vec<MigrationSpec>, String> {
    validate_ident(&module_id)?;
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Detect tampered migrations: if a migration with this version was already
    // applied successfully, its checksum must match the new one being registered.
    for m in &migrations {
        if let Some(existing) = get_applied_checksum(conn, &module_id, m.version)? {
            if existing != m.checksum {
                return Err(format!(
                    "Checksum mismatch for {} v{}: applied={}, new={}",
                    module_id, m.version, existing, m.checksum
                ));
            }
        }
    }

    // Replace any previously-pending entries for these versions, then insert
    // the new pending list. We don't touch already-applied migrations.
    for m in &migrations {
        conn.execute(
            "DELETE FROM module_pending_migrations WHERE module_id = ?1 AND version = ?2",
            params![module_id, m.version],
        ).map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO module_pending_migrations (module_id, version, description, sql, checksum)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![module_id, m.version, m.description, m.sql, m.checksum],
        ).map_err(|e| e.to_string())?;
    }

    // Return the list of migrations that are still pending (not yet applied).
    let mut stmt = conn.prepare(
        "SELECT pm.version, pm.description, pm.sql, pm.checksum
         FROM module_pending_migrations pm
         WHERE pm.module_id = ?1
           AND NOT EXISTS (
             SELECT 1 FROM migration_log ml
             WHERE ml.module_id = pm.module_id AND ml.version = pm.version AND ml.success = 1
           )
         ORDER BY pm.version"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![module_id], |r| {
        Ok(MigrationSpec {
            version: r.get(0)?,
            description: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
            sql: r.get(2)?,
            checksum: r.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut pending = Vec::new();
    for r in rows { pending.push(r.map_err(|e| e.to_string())?); }
    Ok(pending)
}

/// Build a topological order of all module dependencies recorded in
/// `module_dependencies`. Returns an error if a cycle is detected.
fn topological_sort(conn: &rusqlite::Connection) -> Result<Vec<String>, String> {
    // Adjacency: for each module, the list of modules it depends on.
    let mut deps: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    let mut all_modules: std::collections::HashSet<String> = std::collections::HashSet::new();

    let mut stmt = conn.prepare(
        "SELECT module_id, depends_on_module_id FROM module_dependencies"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for r in rows {
        let (m, d) = r.map_err(|e| e.to_string())?;
        deps.entry(m.clone()).or_default().push(d.clone());
        all_modules.insert(m);
        all_modules.insert(d);
    }

    // Kahn's algorithm using DFS detection for clarity.
    let mut order: Vec<String> = Vec::new();
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut on_stack: std::collections::HashSet<String> = std::collections::HashSet::new();

    fn visit(
        node: &str,
        deps: &std::collections::HashMap<String, Vec<String>>,
        visited: &mut std::collections::HashSet<String>,
        on_stack: &mut std::collections::HashSet<String>,
        order: &mut Vec<String>,
    ) -> Result<(), String> {
        if visited.contains(node) { return Ok(()); }
        if on_stack.contains(node) {
            return Err(format!("Circular dependency detected at module: {}", node));
        }
        on_stack.insert(node.to_string());
        if let Some(children) = deps.get(node) {
            for child in children {
                visit(child, deps, visited, on_stack, order)?;
            }
        }
        on_stack.remove(node);
        visited.insert(node.to_string());
        order.push(node.to_string());
        Ok(())
    }

    let mut sorted: Vec<String> = all_modules.into_iter().collect();
    sorted.sort();
    for m in sorted {
        visit(&m, &deps, &mut visited, &mut on_stack, &mut order)?;
    }
    Ok(order)
}

#[tauri::command]
pub async fn check_dependency_graph(db: State<'_, DbState>) -> Result<Vec<String>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    topological_sort(conn)
}

#[tauri::command]
pub async fn register_module_dependency(
    db: State<'_, DbState>,
    module_id: String,
    depends_on_module_id: String,
    min_version: Option<i64>,
) -> Result<(), String> {
    validate_ident(&module_id)?;
    validate_ident(&depends_on_module_id)?;
    if module_id == depends_on_module_id {
        return Err("A module cannot depend on itself".to_string());
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO module_dependencies (module_id, depends_on_module_id, min_version)
         VALUES (?1, ?2, ?3)",
        params![module_id, depends_on_module_id, min_version.unwrap_or(1)],
    ).map_err(|e| e.to_string())?;

    // Re-check the dependency graph after adding — reject cycles immediately
    // so the bad insert is caught before any migration runs.
    if let Err(e) = topological_sort(conn) {
        // Roll back the insert
        let _ = conn.execute(
            "DELETE FROM module_dependencies WHERE module_id = ?1 AND depends_on_module_id = ?2",
            params![module_id, depends_on_module_id],
        );
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
pub async fn run_module_migrations(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<RunMigrationsResult, String> {
    validate_ident(&module_id)?;

    // Step 1: dependency check. All modules this module depends on must have
    // applied at least min_version successfully.
    {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        // Reject circular dependencies up front
        topological_sort(conn)?;

        let mut stmt = conn.prepare(
            "SELECT depends_on_module_id, min_version FROM module_dependencies WHERE module_id = ?1"
        ).map_err(|e| e.to_string())?;
        let dep_rows = stmt.query_map(params![module_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        }).map_err(|e| e.to_string())?;
        for r in dep_rows {
            let (dep, min_v) = r.map_err(|e| e.to_string())?;
            let max_applied: i64 = conn.query_row(
                "SELECT COALESCE(MAX(version), 0) FROM migration_log WHERE module_id = ?1 AND success = 1",
                params![dep], |r| r.get(0),
            ).map_err(|e| e.to_string())?;
            if max_applied < min_v {
                return Err(format!(
                    "Dependency not satisfied: {} requires {} >= v{} (current: v{})",
                    module_id, dep, min_v, max_applied
                ));
            }
        }
    }

    // Step 2: ensure module DB is attached (inlined to avoid State cloning).
    let already_attached = {
        let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        attached.iter().any(|m| m == &module_id)
    };
    if !already_attached {
        // Make sure modules/ exists
        {
            let dir_guard = db.company_dir.lock().map_err(|e| e.to_string())?;
            let dir = dir_guard.as_ref().ok_or("No file is open")?.clone();
            std::fs::create_dir_all(format!("{}/modules", dir))
                .map_err(|e| format!("Failed to create modules dir: {}", e))?;
        }
        let path = module_db_path(&db, &module_id)?;
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        let attach_sql = format!(
            "ATTACH DATABASE '{}' AS module_{};",
            path.replace('\'', "''"),
            sanitize_ident(&module_id)
        );
        conn.execute_batch(&attach_sql).map_err(|e| format!("ATTACH failed: {}", e))?;
        let init_sql = format!(
            "CREATE TABLE IF NOT EXISTS module_{}._migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
            sanitize_ident(&module_id)
        );
        conn.execute_batch(&init_sql).map_err(|e| e.to_string())?;
        drop(guard);
        let mut attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        attached.push(module_id.clone());
    }

    // Step 3: load pending migrations (in version order) that haven't been
    // successfully applied yet.
    let pending: Vec<MigrationSpec> = {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        let mut stmt = conn.prepare(
            "SELECT pm.version, pm.description, pm.sql, pm.checksum
             FROM module_pending_migrations pm
             WHERE pm.module_id = ?1
               AND NOT EXISTS (
                 SELECT 1 FROM migration_log ml
                 WHERE ml.module_id = pm.module_id AND ml.version = pm.version AND ml.success = 1
               )
             ORDER BY pm.version"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![module_id], |r| {
            Ok(MigrationSpec {
                version: r.get(0)?,
                description: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                sql: r.get(2)?,
                checksum: r.get(3)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| e.to_string())?); }
        out
    };

    // Step 4: apply migrations one at a time. On failure: record the failure
    // row and stop (do not advance to subsequent versions).
    let mut applied: Vec<i64> = Vec::new();
    for m in &pending {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();

        // SAVEPOINT semantics — execute_batch wraps in an implicit transaction
        // for the kernel connection, but the migration SQL targets the ATTACHed
        // module schema. We use a SAVEPOINT to allow rollback of just this
        // migration without affecting any in-flight kernel transaction.
        let savepoint = format!("mig_{}_{}", sanitize_ident(&module_id), m.version);
        conn.execute_batch(&format!("SAVEPOINT {};", savepoint))
            .map_err(|e| e.to_string())?;

        let exec_result = conn.execute_batch(&m.sql);

        match exec_result {
            Ok(()) => {
                conn.execute_batch(&format!("RELEASE {};", savepoint))
                    .map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT INTO migration_log (module_id, version, description, checksum, success)
                     VALUES (?1, ?2, ?3, ?4, 1)",
                    params![module_id, m.version, m.description, m.checksum],
                ).map_err(|e| e.to_string())?;
                applied.push(m.version);
            }
            Err(e) => {
                let _ = conn.execute_batch(&format!("ROLLBACK TO {}; RELEASE {};", savepoint, savepoint));
                let err_msg = e.to_string();
                conn.execute(
                    "INSERT INTO migration_log (module_id, version, description, checksum, success, error_message)
                     VALUES (?1, ?2, ?3, ?4, 0, ?5)",
                    params![module_id, m.version, m.description, m.checksum, err_msg],
                ).ok();
                return Ok(RunMigrationsResult {
                    applied,
                    failed: Some(m.version),
                    error: Some(err_msg),
                });
            }
        }
    }

    Ok(RunMigrationsResult { applied, failed: None, error: None })
}

#[tauri::command]
pub async fn get_migration_status(
    db: State<'_, DbState>,
    module_id: Option<String>,
) -> Result<Vec<MigrationStatus>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Discover module ids: union of pending + log tables.
    let mut module_ids: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    if let Some(ref m) = module_id {
        validate_ident(m)?;
        module_ids.insert(m.clone());
    } else {
        let mut stmt = conn.prepare(
            "SELECT module_id FROM migration_log
             UNION SELECT module_id FROM module_pending_migrations"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
        for r in rows { module_ids.insert(r.map_err(|e| e.to_string())?); }
    }

    let mut result = Vec::new();
    for mid in module_ids {
        let latest_version: i64 = conn.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM migration_log WHERE module_id = ?1 AND success = 1",
            params![mid], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let applied_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM migration_log WHERE module_id = ?1 AND success = 1",
            params![mid], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let failed_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM migration_log WHERE module_id = ?1 AND success = 0",
            params![mid], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let pending_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM module_pending_migrations pm
             WHERE pm.module_id = ?1
               AND NOT EXISTS (
                 SELECT 1 FROM migration_log ml
                 WHERE ml.module_id = pm.module_id AND ml.version = pm.version AND ml.success = 1
               )",
            params![mid], |r| r.get(0),
        ).map_err(|e| e.to_string())?;
        let last_error: Option<String> = conn.query_row(
            "SELECT error_message FROM migration_log
             WHERE module_id = ?1 AND success = 0
             ORDER BY id DESC LIMIT 1",
            params![mid], |r| r.get::<_, Option<String>>(0),
        ).unwrap_or(None);

        result.push(MigrationStatus {
            module_id: mid,
            latest_version,
            applied_count,
            pending_count,
            failed_count,
            last_error,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn module_execute_migration(
    db: State<'_, DbState>,
    module_id: String,
    version: String,
    sql: String,
) -> Result<(), String> {
    require_module_attached(&db, &module_id)?;

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Check if already applied
    let already: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM module_{}._migrations WHERE version = ?1",
                 sanitize_ident(&module_id)),
        params![version],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if already > 0 {
        return Ok(()); // idempotent
    }

    // Run the migration SQL. Note: this is the only place where modules can run
    // raw SQL — it's intended for install/upgrade migrations only.
    // We rewrite occurrences of plain table names is the module's responsibility:
    // they must qualify tables with their own schema, OR the migration SQL must
    // be transformed by the SDK before being passed here. For Phase 38 we accept
    // raw SQL but execute it within the attached schema by SET-ing the search.
    // Simplest correct approach: require migrations to use module_{id}.table syntax.
    conn.execute_batch(&sql).map_err(|e| format!("Migration failed: {}", e))?;

    conn.execute(
        &format!("INSERT INTO module_{}._migrations (version) VALUES (?1)",
                 sanitize_ident(&module_id)),
        params![version],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

// ── Phase 40: Module Registry & Lifecycle ────────────────

#[derive(Debug, Deserialize, Clone)]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub sdk_version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<serde_json::Value>,
    pub entry_point: Option<String>,
    #[serde(default)]
    pub migrations: Vec<serde_json::Value>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ModuleRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub sdk_version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub permissions: Vec<String>,
    pub dependencies: serde_json::Value,
    pub entry_point: Option<String>,
    pub install_path: Option<String>,
    pub status: String,
    pub installed_at: String,
    pub updated_at: String,
    pub error_message: Option<String>,
}

const SUPPORTED_SDK_VERSIONS: &[&str] = &["1"];

fn row_to_registry_entry(row: &rusqlite::Row) -> rusqlite::Result<ModuleRegistryEntry> {
    let perms_json: String = row.get(7)?;
    let deps_json: String = row.get(8)?;
    Ok(ModuleRegistryEntry {
        id: row.get(0)?,
        name: row.get(1)?,
        version: row.get(2)?,
        sdk_version: row.get(3)?,
        description: row.get(4)?,
        author: row.get(5)?,
        license: row.get(6)?,
        permissions: serde_json::from_str(&perms_json).unwrap_or_default(),
        dependencies: serde_json::from_str(&deps_json).unwrap_or(serde_json::json!([])),
        entry_point: row.get(9)?,
        install_path: row.get(10)?,
        status: row.get(11)?,
        installed_at: row.get(12)?,
        updated_at: row.get(13)?,
        error_message: row.get(14)?,
    })
}

const REGISTRY_COLUMNS: &str =
    "id, name, version, sdk_version, description, author, license, permissions, dependencies,
     entry_point, install_path, status, installed_at, updated_at, error_message";

#[tauri::command]
pub async fn install_module(
    db: State<'_, DbState>,
    manifest_json: serde_json::Value,
    install_path: Option<String>,
) -> Result<ModuleRegistryEntry, String> {
    let manifest: ModuleManifest = serde_json::from_value(manifest_json)
        .map_err(|e| format!("Invalid manifest: {}", e))?;

    if manifest.id.is_empty() {
        return Err("Manifest id cannot be empty".to_string());
    }
    if !SUPPORTED_SDK_VERSIONS.contains(&manifest.sdk_version.as_str()) {
        return Err(format!(
            "Unsupported sdk_version '{}': this kernel supports {:?}",
            manifest.sdk_version, SUPPORTED_SDK_VERSIONS
        ));
    }

    // Module ids in the registry can contain dots (e.g. com.example.invoicing).
    // Translate to a SQL-safe alias for ATTACH purposes by replacing dots with
    // underscores. Reject anything that isn't [A-Za-z0-9._-].
    if !manifest.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err(format!("Invalid module id '{}': allowed chars are A-Z, 0-9, '.', '_', '-'", manifest.id));
    }

    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();

    // Conflict check
    let exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM module_registry WHERE id = ?1",
        params![manifest.id], |r| r.get(0),
    ).map_err(|e| e.to_string())?;
    if exists {
        return Err(format!("Module already installed: {}", manifest.id));
    }

    let perms_json = serde_json::to_string(&manifest.permissions).unwrap_or_else(|_| "[]".to_string());
    let deps_json = serde_json::to_string(&manifest.dependencies).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO module_registry
         (id, name, version, sdk_version, description, author, license, permissions, dependencies,
          entry_point, install_path, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'active')",
        params![
            manifest.id, manifest.name, manifest.version, manifest.sdk_version,
            manifest.description, manifest.author, manifest.license,
            perms_json, deps_json,
            manifest.entry_point, install_path
        ],
    ).map_err(|e| format!("Failed to register module: {}", e))?;

    // Phase 41: Insert each declared permission scope into module_permissions.
    // The host UI shows the consent screen BEFORE calling install_module — by
    // the time we get here, the user has approved the manifest's full scope set.
    for scope in &manifest.permissions {
        conn.execute(
            "INSERT OR IGNORE INTO module_permissions (module_id, scope) VALUES (?1, ?2)",
            params![manifest.id, scope],
        ).map_err(|e| format!("Failed to grant permission: {}", e))?;
    }

    // Read back the inserted row
    let entry = conn.query_row(
        &format!("SELECT {} FROM module_registry WHERE id = ?1", REGISTRY_COLUMNS),
        params![manifest.id],
        row_to_registry_entry,
    ).map_err(|e| e.to_string())?;

    let payload = serde_json::json!({
        "module_id": entry.id,
        "name": entry.name,
        "version": entry.version,
    });
    drop(guard);
    crate::events::emit_event(&db, "module.installed", payload);

    Ok(entry)
}

#[tauri::command]
pub async fn uninstall_module(
    db: State<'_, DbState>,
    module_id: String,
    keep_data: Option<bool>,
) -> Result<(), String> {
    let keep = keep_data.unwrap_or(false);

    // Mark as uninstalling, then DETACH, then optionally delete the .sqlite,
    // then remove from registry. Service registry entries cleared as well.
    {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        let updated = conn.execute(
            "UPDATE module_registry SET status = 'uninstalling', updated_at = datetime('now')
             WHERE id = ?1",
            params![module_id],
        ).map_err(|e| e.to_string())?;
        if updated == 0 {
            return Err(format!("Module not found: {}", module_id));
        }
    }

    // DETACH if attached. Module ids may contain dots — derive the alias used
    // when attaching by replacing them with underscores.
    let alias = module_id.replace(['.', '-'], "_");
    {
        let attached_now = {
            let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
            attached.iter().any(|m| m == &alias)
        };
        if attached_now {
            let guard = get_conn(&db)?;
            let conn = guard.as_ref().unwrap();
            let _ = conn.execute_batch(&format!("DETACH DATABASE module_{};", sanitize_ident(&alias)));
            drop(guard);
            let mut attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
            attached.retain(|m| m != &alias);
        }
    }

    // Optionally delete the module's .sqlite file
    if !keep {
        if let Ok(dir_guard) = db.company_dir.lock() {
            if let Some(ref dir) = *dir_guard {
                let path = format!("{}/modules/{}.sqlite", dir, alias);
                let _ = std::fs::remove_file(&path);
            }
        }
    }

    // Clear service registry, hooks, event subscriptions
    crate::sdk_v1::unregister_module_services(&db, &module_id);
    crate::hooks::unregister_all_for_module(&db, &module_id);
    crate::events::unsubscribe_all_for_module(&db, &module_id);

    // Remove from registry + clean migration_log + module_dependencies + pending
    {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        // Phase 41: explicitly clear permissions before deleting registry row
        conn.execute("DELETE FROM module_permissions WHERE module_id = ?1", params![module_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM module_registry WHERE id = ?1", params![module_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM migration_log WHERE module_id = ?1", params![alias])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM module_pending_migrations WHERE module_id = ?1", params![alias])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM module_dependencies WHERE module_id = ?1 OR depends_on_module_id = ?1",
            params![alias],
        ).map_err(|e| e.to_string())?;
    }

    crate::events::emit_event(&db, "module.uninstalled", serde_json::json!({
        "module_id": module_id,
    }));

    Ok(())
}

#[tauri::command]
pub async fn enable_module(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<(), String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let n = conn.execute(
        "UPDATE module_registry SET status = 'active', error_message = NULL,
         updated_at = datetime('now') WHERE id = ?1",
        params![module_id],
    ).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("Module not found: {}", module_id));
    }
    Ok(())
}

#[tauri::command]
pub async fn disable_module(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<(), String> {
    {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        let n = conn.execute(
            "UPDATE module_registry SET status = 'disabled', updated_at = datetime('now')
             WHERE id = ?1",
            params![module_id],
        ).map_err(|e| e.to_string())?;
        if n == 0 {
            return Err(format!("Module not found: {}", module_id));
        }
    }

    // DETACH the module's database (if attached) and clear its services.
    let alias = module_id.replace(['.', '-'], "_");
    let attached_now = {
        let attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        attached.iter().any(|m| m == &alias)
    };
    if attached_now {
        let guard = get_conn(&db)?;
        let conn = guard.as_ref().unwrap();
        let _ = conn.execute_batch(&format!("DETACH DATABASE module_{};", sanitize_ident(&alias)));
        drop(guard);
        let mut attached = db.attached_modules.lock().map_err(|e| e.to_string())?;
        attached.retain(|m| m != &alias);
    }
    crate::sdk_v1::unregister_module_services(&db, &module_id);
    crate::hooks::unregister_all_for_module(&db, &module_id);
    crate::events::unsubscribe_all_for_module(&db, &module_id);
    Ok(())
}

#[tauri::command]
pub async fn get_module_info(
    db: State<'_, DbState>,
    module_id: String,
) -> Result<ModuleRegistryEntry, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    conn.query_row(
        &format!("SELECT {} FROM module_registry WHERE id = ?1", REGISTRY_COLUMNS),
        params![module_id],
        row_to_registry_entry,
    ).map_err(|_| format!("Module not found: {}", module_id))
}

#[tauri::command]
pub async fn list_installed_modules(
    db: State<'_, DbState>,
) -> Result<Vec<ModuleRegistryEntry>, String> {
    let guard = get_conn(&db)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        &format!("SELECT {} FROM module_registry ORDER BY name", REGISTRY_COLUMNS)
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], row_to_registry_entry).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows { out.push(r.map_err(|e| e.to_string())?); }
    Ok(out)
}

