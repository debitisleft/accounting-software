use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;
use chrono::Utc;

use crate::DbState;

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
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
pub struct JournalEntryInput {
    pub account_id: String,
    pub debit: i64,
    pub credit: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct JournalEntryOutput {
    pub id: String,
    pub transaction_id: String,
    pub account_id: String,
    pub debit: i64,
    pub credit: i64,
    pub memo: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TransactionWithEntries {
    pub id: String,
    pub date: String,
    pub description: String,
    pub reference: Option<String>,
    pub is_locked: i64,
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, code, name, type, normal_balance, parent_id, is_active, created_at FROM accounts WHERE is_active = 1 ORDER BY code")
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
    entries: Vec<JournalEntryInput>,
) -> Result<String, String> {
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

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx_id = Uuid::new_v4().to_string();
    let now = Utc::now().timestamp();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;

    let insert_result = (|| -> Result<(), String> {
        conn.execute(
            "INSERT INTO transactions (id, date, description, reference, is_locked, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
            params![tx_id, date, description, reference, now],
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
) -> Result<TrialBalanceResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let query = match &as_of_date {
        Some(date) => format!(
            "SELECT a.id, a.code, a.name, a.type,
                    COALESCE(SUM(je.debit), 0) AS total_debit,
                    COALESCE(SUM(je.credit), 0) AS total_credit
             FROM accounts a
             LEFT JOIN journal_entries je ON je.account_id = a.id
             LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date <= '{}'
             WHERE a.is_active = 1
             GROUP BY a.id ORDER BY a.code",
            date
        ),
        None => "SELECT a.id, a.code, a.name, a.type,
                    COALESCE(SUM(je.debit), 0) AS total_debit,
                    COALESCE(SUM(je.credit), 0) AS total_credit
             FROM accounts a
             LEFT JOIN journal_entries je ON je.account_id = a.id
             WHERE a.is_active = 1
             GROUP BY a.id ORDER BY a.code"
            .to_string(),
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
) -> Result<IncomeStatementResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT a.id, a.code, a.name, a.type,
                COALESCE(SUM(je.debit), 0), COALESCE(SUM(je.credit), 0)
         FROM accounts a
         LEFT JOIN journal_entries je ON je.account_id = a.id
         LEFT JOIN transactions t ON je.transaction_id = t.id AND t.date >= ?1 AND t.date <= ?2
         WHERE a.is_active = 1 AND a.type IN ('REVENUE', 'EXPENSE')
         GROUP BY a.id ORDER BY a.code"
    ).map_err(|e| e.to_string())?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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

    let query = format!("SELECT id, date, description, reference, is_locked, created_at FROM transactions{} ORDER BY date DESC, created_at DESC", where_sql);
    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();

    let tx_rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(TransactionWithEntries {
            id: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            reference: row.get(3)?,
            is_locked: row.get(4)?,
            created_at: row.get(5)?,
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
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
    Ok(AppMetadata {
        version: env!("CARGO_PKG_VERSION").to_string(),
        db_path: db.db_path.clone(),
        last_backup_date: None, // Will be populated when backup feature is added
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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
        "SELECT id, date, description, reference, is_locked, created_at FROM transactions ORDER BY date DESC, created_at DESC LIMIT 10"
    ).map_err(|e| e.to_string())?;

    let tx_rows = tx_stmt.query_map([], |row| {
        Ok(TransactionWithEntries {
            id: row.get(0)?,
            date: row.get(1)?,
            description: row.get(2)?,
            reference: row.get(3)?,
            is_locked: row.get(4)?,
            created_at: row.get(5)?,
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

    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let acct_type: String = conn.query_row(
        "SELECT type FROM accounts WHERE id = ?1",
        params![account_id],
        |row| row.get(0),
    ).map_err(|_| format!("Account not found: {}", account_id))?;

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
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
