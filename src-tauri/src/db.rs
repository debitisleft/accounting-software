use rusqlite::{Connection, Result, params};
use std::path::PathBuf;
use uuid::Uuid;
use chrono::Utc;

/// Initialize the database at the app data directory.
/// Creates all tables and seeds default accounts.
pub fn init_db(app_data_dir: PathBuf) -> Result<Connection> {
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    let db_path = app_data_dir.join("bookkeeping.db");
    let conn = Connection::open(db_path)?;

    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    create_tables(&conn)?;
    seed_accounts(&conn)?;

    Ok(conn)
}

fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
            normal_balance TEXT NOT NULL CHECK(normal_balance IN ('DEBIT','CREDIT')),
            parent_id TEXT REFERENCES accounts(id),
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            reference TEXT,
            is_locked INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
            id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL REFERENCES transactions(id),
            account_id TEXT NOT NULL REFERENCES accounts(id),
            debit INTEGER NOT NULL DEFAULT 0,
            credit INTEGER NOT NULL DEFAULT 0,
            memo TEXT,
            CHECK(debit >= 0),
            CHECK(credit >= 0),
            CHECK(NOT (debit > 0 AND credit > 0))
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id TEXT PRIMARY KEY,
            journal_entry_id TEXT NOT NULL,
            field_changed TEXT NOT NULL,
            old_value TEXT NOT NULL,
            new_value TEXT NOT NULL,
            changed_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS reconciliation_periods (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            period_start TEXT NOT NULL,
            period_end TEXT NOT NULL,
            is_locked INTEGER NOT NULL DEFAULT 0,
            locked_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS categorization_rules (
            id TEXT PRIMARY KEY,
            merchant_pattern TEXT NOT NULL,
            suggested_account_id TEXT NOT NULL,
            confidence INTEGER NOT NULL DEFAULT 0,
            times_confirmed INTEGER NOT NULL DEFAULT 0
        );
        "
    )?;
    Ok(())
}

fn normal_balance_for(acct_type: &str) -> &str {
    match acct_type {
        "ASSET" | "EXPENSE" => "DEBIT",
        _ => "CREDIT",
    }
}

fn seed_accounts(conn: &Connection) -> Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))?;
    if count > 0 {
        return Ok(());
    }

    let now = Utc::now().timestamp();
    let accounts: Vec<(&str, &str, &str)> = vec![
        // ASSETS
        ("1000", "Cash", "ASSET"),
        ("1010", "Checking Account", "ASSET"),
        ("1020", "Savings Account", "ASSET"),
        ("1100", "Accounts Receivable", "ASSET"),
        ("1200", "Inventory", "ASSET"),
        ("1300", "Prepaid Expenses", "ASSET"),
        ("1500", "Equipment", "ASSET"),
        ("1510", "Accumulated Depreciation", "ASSET"),
        // LIABILITIES
        ("2000", "Accounts Payable", "LIABILITY"),
        ("2100", "Credit Card Payable", "LIABILITY"),
        ("2200", "Wages Payable", "LIABILITY"),
        ("2300", "Sales Tax Payable", "LIABILITY"),
        ("2500", "Notes Payable", "LIABILITY"),
        // EQUITY
        ("3000", "Owner's Equity", "EQUITY"),
        ("3100", "Owner's Draws", "EQUITY"),
        ("3200", "Retained Earnings", "EQUITY"),
        // REVENUE
        ("4000", "Sales Revenue", "REVENUE"),
        ("4100", "Service Revenue", "REVENUE"),
        ("4200", "Interest Income", "REVENUE"),
        // EXPENSES
        ("5000", "Cost of Goods Sold", "EXPENSE"),
        ("5100", "Rent Expense", "EXPENSE"),
        ("5200", "Utilities Expense", "EXPENSE"),
        ("5300", "Wages Expense", "EXPENSE"),
        ("5400", "Office Supplies", "EXPENSE"),
        ("5500", "Depreciation Expense", "EXPENSE"),
        ("5600", "Insurance Expense", "EXPENSE"),
    ];

    for (code, name, acct_type) in &accounts {
        let id = Uuid::new_v4().to_string();
        let nb = normal_balance_for(acct_type);
        conn.execute(
            "INSERT INTO accounts (id, code, name, type, normal_balance, is_active, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![id, code, name, acct_type, nb, now],
        )?;
    }

    Ok(())
}
