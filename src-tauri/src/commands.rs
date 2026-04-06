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

#[tauri::command]
pub async fn create_new_file(
    db: State<'_, DbState>,
    path: String,
    company_name: String,
) -> Result<FileInfo, String> {
    // Close any currently open file
    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *conn_guard {
            crate::db::close_book_file(c).ok();
        }
        *conn_guard = None;
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = None;
    }

    let conn = crate::db::create_book_file(&path, &company_name)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        *conn_guard = Some(conn);
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = Some(path.clone());
    }

    add_to_recent(&db.app_data_dir, &path, &company_name);

    Ok(FileInfo { path, company_name })
}

#[tauri::command]
pub async fn open_file(
    db: State<'_, DbState>,
    path: String,
) -> Result<FileInfo, String> {
    // Close any currently open file
    {
        let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
        if let Some(ref c) = *conn_guard {
            crate::db::close_book_file(c).ok();
        }
        *conn_guard = None;
        let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
        *path_guard = None;
    }

    let conn = crate::db::open_book_file(&path)?;

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
        *path_guard = Some(path.clone());
    }

    add_to_recent(&db.app_data_dir, &path, &company_name);

    Ok(FileInfo { path, company_name })
}

#[tauri::command]
pub async fn close_file(db: State<'_, DbState>) -> Result<(), String> {
    let mut conn_guard = db.conn.lock().map_err(|e| e.to_string())?;
    if let Some(ref c) = *conn_guard {
        crate::db::close_book_file(c)?;
    }
    *conn_guard = None;
    let mut path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
    *path_guard = None;
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
        .prepare("SELECT id, code, name, type, normal_balance, parent_id, is_active, created_at, COALESCE(is_system, 0) FROM accounts WHERE is_active = 1 ORDER BY code")
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
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut accounts = Vec::new();
    for row in rows {
        accounts.push(row.map_err(|e| e.to_string())?);
    }
    Ok(accounts)
}

#[tauri::command]
pub async fn create_transaction(
    db: State<'_, DbState>,
    date: String,
    description: String,
    reference: Option<String>,
    journal_type: Option<String>,
    entries: Vec<JournalEntryInput>,
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

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;

    let insert_result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, journal_type, is_locked, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![tx_id, date, description, final_reference, jtype, now],
        ).map_err(|e| e.to_string())?;

        for entry in &entries {
            let entry_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO journal_entries (id, transaction_id, account_id, debit, credit, memo) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![entry_id, tx_id, entry.account_id, entry.debit, entry.credit, entry.memo],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();

    match insert_result {
        Ok(()) => {
            conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
            Ok(tx_id)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
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
                    COALESCE(SUM(je.credit), 0) AS total_credit
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
                    COALESCE(SUM(je.credit), 0) AS total_credit
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

    let query = format!(
        "SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2{}
         WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
         GROUP BY a.id ORDER BY a.code",
        exclude_clause
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
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, acct_type, balance))
    }).map_err(|e| e.to_string())?;

    let mut revenue = Vec::new();
    let mut expenses = Vec::new();

    for row in rows {
        let (id, code, name, acct_type, balance) = row.map_err(|e| e.to_string())?;
        if balance == 0 { continue; }
        let item = AccountBalanceItem { account_id: id, code, name, balance };
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
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
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
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, acct_type, balance))
    }).map_err(|e| e.to_string())?;

    let mut assets = Vec::new();
    let mut liabilities = Vec::new();
    let mut equity = Vec::new();
    let mut net_income: i64 = 0;

    for row in rows {
        let (id, code, name, acct_type, balance) = row.map_err(|e| e.to_string())?;
        if balance == 0 { continue; }
        let item = AccountBalanceItem { account_id: id, code, name, balance };
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

    let id = Uuid::new_v4().to_string();
    let nb = if is_debit_normal(&acct_type) { "DEBIT" } else { "CREDIT" };
    let now = Utc::now().timestamp();

    conn.execute(
        "INSERT INTO accounts (id, code, name, type, normal_balance, parent_id, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7)",
        params![id, code.trim(), name.trim(), acct_type, nb, parent_id, now],
    ).map_err(|e| e.to_string())?;

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

    if entries.is_empty() {
        return Err("No revenue or expense balances to close".to_string());
    }

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
        where_clauses.push(format!("LOWER(t.description) LIKE ?{}", idx)); idx += 1;
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

    match result {
        Ok(id) => { conn.execute("COMMIT", []).map_err(|e| e.to_string())?; Ok(id) }
        Err(e) => { let _ = conn.execute("ROLLBACK", []); Err(e) }
    }
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
    let path_guard = db.current_path.lock().map_err(|e| e.to_string())?;
    let db_path = path_guard.as_ref().ok_or("No file is open")?.clone();
    drop(path_guard);

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
    let current_path = db.current_path.lock().map_err(|e| e.to_string())?.clone().ok_or("No file is open")?;
    let db_path = std::path::Path::new(&current_path);
    let backups_dir = db_path.parent()
        .ok_or("Cannot determine backup directory")?
        .join("backups");

    std::fs::create_dir_all(&backups_dir)
        .map_err(|e| format!("Failed to create backups directory: {}", e))?;

    let timestamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let backup_path = backups_dir.join(format!("bookkeeping-{}.db", timestamp));
    let backup_str = backup_path.to_string_lossy().to_string();

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
    let current_path = db.current_path.lock().map_err(|e| e.to_string())?.clone().ok_or("No file is open")?;
    let db_path = std::path::Path::new(&current_path);
    let backups_dir = db_path.parent()
        .ok_or("Cannot determine backup directory")?
        .join("backups");

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
