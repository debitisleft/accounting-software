use rusqlite::{Connection, Result, params};
use uuid::Uuid;
use chrono::Utc;
use std::path::Path;

/// Create a new .sqlite book file at the given path.
/// Sets up schema, seeds default accounts, and stores company_name in settings.
pub fn create_book_file(path: &str, company_name: &str) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")?;

    create_tables(&conn)?;
    run_migrations(&conn)?;
    seed_default_settings(&conn, company_name)?;
    seed_accounts(&conn)?;

    Ok(conn)
}

/// Open an existing .sqlite book file. Validates expected tables exist.
pub fn open_book_file(path: &str) -> std::result::Result<Connection, String> {
    if !Path::new(path).exists() {
        return Err(format!("File not found: {}", path));
    }

    let conn = Connection::open(path).map_err(|e| format!("Failed to open database: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;

    // Validate expected tables
    let required_tables = ["accounts", "transactions", "journal_entries", "settings"];
    for table in required_tables {
        let exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !exists {
            return Err(format!("Invalid book file: missing '{}' table", table));
        }
    }

    // Run any pending migrations on older files
    run_migrations(&conn).map_err(|e| e.to_string())?;

    Ok(conn)
}

/// Close the book file cleanly (WAL checkpoint).
pub fn close_book_file(conn: &Connection) -> std::result::Result<(), String> {
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| format!("WAL checkpoint failed: {}", e))?;
    Ok(())
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

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pending_bank_transactions (
            id TEXT PRIMARY KEY,
            bank_account_id TEXT,
            date TEXT NOT NULL,
            description TEXT NOT NULL,
            amount INTEGER NOT NULL,
            payee TEXT,
            bank_ref TEXT,
            status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','DISMISSED')),
            suggested_account_id TEXT,
            created_transaction_id TEXT,
            imported_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS recurring_templates (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            recurrence TEXT NOT NULL CHECK(recurrence IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
            start_date TEXT NOT NULL,
            end_date TEXT,
            last_generated TEXT,
            is_paused INTEGER NOT NULL DEFAULT 0,
            entries_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS modules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            version TEXT NOT NULL,
            description TEXT,
            table_prefix TEXT NOT NULL UNIQUE,
            enabled INTEGER NOT NULL DEFAULT 1,
            installed_at INTEGER NOT NULL
        );
        "
    )?;
    Ok(())
}

fn run_migrations(conn: &Connection) -> Result<()> {
    // Migration: add is_void and void_of columns if not present
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(transactions)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !cols.iter().any(|c| c == "is_void") {
        conn.execute_batch("ALTER TABLE transactions ADD COLUMN is_void INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !cols.iter().any(|c| c == "void_of") {
        conn.execute_batch("ALTER TABLE transactions ADD COLUMN void_of TEXT;")?;
    }

    // Migration: add transaction_id column to audit_log if not present
    let audit_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(audit_log)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !audit_cols.iter().any(|c| c == "transaction_id") {
        conn.execute_batch("ALTER TABLE audit_log ADD COLUMN transaction_id TEXT;")?;
    }

    // Migration: add journal_type column to transactions if not present
    if !cols.iter().any(|c| c == "journal_type") {
        conn.execute_batch("ALTER TABLE transactions ADD COLUMN journal_type TEXT NOT NULL DEFAULT 'GENERAL';")?;
    }

    // Migration: add is_system column to accounts if not present
    let acct_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(accounts)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !acct_cols.iter().any(|c| c == "is_system") {
        conn.execute_batch("ALTER TABLE accounts ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;")?;
        conn.execute_batch("UPDATE accounts SET is_system = 1 WHERE code IN ('3200', '3500');")?;
    }

    // Migration: add cash flow columns to accounts if not present
    if !acct_cols.iter().any(|c| c == "cash_flow_category") {
        conn.execute_batch("ALTER TABLE accounts ADD COLUMN cash_flow_category TEXT;")?;
    }
    if !acct_cols.iter().any(|c| c == "is_cash_account") {
        conn.execute_batch("ALTER TABLE accounts ADD COLUMN is_cash_account INTEGER NOT NULL DEFAULT 0;")?;
        // Seed: tag Cash, Checking, Savings as cash accounts
        conn.execute_batch("UPDATE accounts SET is_cash_account = 1 WHERE code IN ('1000', '1010', '1020');")?;
    }

    // Migration: add is_reconciled column to journal_entries if not present
    let je_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(journal_entries)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>>>()?;
    if !je_cols.iter().any(|c| c == "is_reconciled") {
        conn.execute_batch("ALTER TABLE journal_entries ADD COLUMN is_reconciled INTEGER NOT NULL DEFAULT 0;")?;
    }

    Ok(())
}

fn seed_default_settings(conn: &Connection, company_name: &str) -> Result<()> {
    let setting_count: i64 = conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))?;
    if setting_count == 0 {
        let defaults = [
            ("company_name", company_name),
            ("fiscal_year_start_month", "1"),
            ("currency_symbol", "$"),
            ("date_format", "YYYY-MM-DD"),
        ];
        for (key, value) in defaults {
            conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2)", params![key, value])?;
        }
    }
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
        ("1000", "Cash", "ASSET"),
        ("1010", "Checking Account", "ASSET"),
        ("1020", "Savings Account", "ASSET"),
        ("1100", "Accounts Receivable", "ASSET"),
        ("1200", "Inventory", "ASSET"),
        ("1300", "Prepaid Expenses", "ASSET"),
        ("1500", "Equipment", "ASSET"),
        ("1510", "Accumulated Depreciation", "ASSET"),
        ("2000", "Accounts Payable", "LIABILITY"),
        ("2100", "Credit Card Payable", "LIABILITY"),
        ("2200", "Wages Payable", "LIABILITY"),
        ("2300", "Sales Tax Payable", "LIABILITY"),
        ("2500", "Notes Payable", "LIABILITY"),
        ("3000", "Owner's Equity", "EQUITY"),
        ("3100", "Owner's Draws", "EQUITY"),
        ("3200", "Retained Earnings", "EQUITY"),
        ("3500", "Opening Balance Equity", "EQUITY"),
        ("4000", "Sales Revenue", "REVENUE"),
        ("4100", "Service Revenue", "REVENUE"),
        ("4200", "Interest Income", "REVENUE"),
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
        let is_system: i64 = if *code == "3200" || *code == "3500" { 1 } else { 0 };
        conn.execute(
            "INSERT INTO accounts (id, code, name, type, normal_balance, is_active, is_system, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7)",
            params![id, code, name, acct_type, nb, is_system, now],
        )?;
    }

    Ok(())
}
