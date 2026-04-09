use rusqlite::{Connection, Result, params};
use uuid::Uuid;
use chrono::Utc;
use std::path::{Path, PathBuf};

/// Result of resolving a company file path. Always returns the company directory
/// and the path to company.sqlite inside it.
pub struct CompanyPaths {
    pub company_dir: PathBuf,
    pub company_db: PathBuf,
}

/// Resolve a user-supplied path into a company directory + company.sqlite path.
/// Handles three cases:
///   1. Path is an existing directory → use directly
///   2. Path is an existing legacy .sqlite file → AUTO-MIGRATE to directory format
///   3. Path does not exist → treat as new directory to create
pub fn resolve_company_paths(input_path: &str) -> std::result::Result<CompanyPaths, String> {
    let p = Path::new(input_path);

    if p.is_dir() {
        return Ok(CompanyPaths {
            company_db: p.join("company.sqlite"),
            company_dir: p.to_path_buf(),
        });
    }

    if p.is_file() {
        // Legacy single .sqlite file → migrate to directory format.
        // Convert /path/MyCompany.sqlite → /path/MyCompany/company.sqlite
        let parent = p.parent().ok_or("Cannot determine parent directory")?;
        let stem = p.file_stem().ok_or("Cannot determine file stem")?
            .to_string_lossy().to_string();
        let new_dir = parent.join(&stem);

        std::fs::create_dir_all(&new_dir)
            .map_err(|e| format!("Failed to create company directory: {}", e))?;

        let new_db = new_dir.join("company.sqlite");
        if !new_db.exists() {
            // Move the legacy file. Also move any -wal/-shm sidecar files.
            std::fs::rename(p, &new_db)
                .map_err(|e| format!("Failed to migrate legacy file: {}", e))?;
            let wal = parent.join(format!("{}.sqlite-wal", stem));
            if wal.exists() {
                let _ = std::fs::rename(&wal, new_dir.join("company.sqlite-wal"));
            }
            let shm = parent.join(format!("{}.sqlite-shm", stem));
            if shm.exists() {
                let _ = std::fs::rename(&shm, new_dir.join("company.sqlite-shm"));
            }
        }

        // Migrate legacy {file}_documents/ → {company_dir}/documents/
        let legacy_docs = parent.join(format!("{}_documents", stem));
        let new_docs = new_dir.join("documents");
        if legacy_docs.exists() && !new_docs.exists() {
            let _ = std::fs::rename(&legacy_docs, &new_docs);
        }

        return Ok(CompanyPaths {
            company_db: new_db,
            company_dir: new_dir,
        });
    }

    // Path doesn't exist. Treat as a new directory to create.
    Ok(CompanyPaths {
        company_db: p.join("company.sqlite"),
        company_dir: p.to_path_buf(),
    })
}

/// Ensure the standard subdirectory layout exists inside a company directory.
pub fn ensure_company_subdirs(company_dir: &Path) -> std::result::Result<(), String> {
    for sub in &["modules", "documents", "backups"] {
        std::fs::create_dir_all(company_dir.join(sub))
            .map_err(|e| format!("Failed to create {}: {}", sub, e))?;
    }
    Ok(())
}

/// Create a new company directory with company.sqlite inside, plus standard subdirectories.
pub fn create_book_file(path: &str, company_name: &str) -> std::result::Result<(Connection, PathBuf), String> {
    let paths = resolve_company_paths(path)?;
    std::fs::create_dir_all(&paths.company_dir)
        .map_err(|e| format!("Failed to create company directory: {}", e))?;
    ensure_company_subdirs(&paths.company_dir)?;

    if paths.company_db.exists() {
        return Err(format!("Company file already exists: {}", paths.company_db.display()));
    }

    let conn = Connection::open(&paths.company_db)
        .map_err(|e| format!("Failed to create database: {}", e))?;
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys=ON;").map_err(|e| e.to_string())?;

    create_tables(&conn).map_err(|e| e.to_string())?;
    run_migrations(&conn).map_err(|e| e.to_string())?;
    seed_default_settings(&conn, company_name).map_err(|e| e.to_string())?;
    seed_accounts(&conn).map_err(|e| e.to_string())?;

    Ok((conn, paths.company_dir))
}

/// Open an existing company file (directory or legacy .sqlite). Validates schema.
/// Returns (connection, company_directory_path).
pub fn open_book_file(path: &str) -> std::result::Result<(Connection, PathBuf), String> {
    if !Path::new(path).exists() {
        return Err(format!("File not found: {}", path));
    }

    let paths = resolve_company_paths(path)?;
    ensure_company_subdirs(&paths.company_dir)?;

    if !paths.company_db.exists() {
        return Err(format!("Company database not found: {}", paths.company_db.display()));
    }

    let conn = Connection::open(&paths.company_db)
        .map_err(|e| format!("Failed to open database: {}", e))?;
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

    Ok((conn, paths.company_dir))
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

        CREATE TABLE IF NOT EXISTS dimensions (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            name TEXT NOT NULL,
            code TEXT,
            parent_id TEXT REFERENCES dimensions(id),
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(type, name)
        );

        CREATE TABLE IF NOT EXISTS transaction_line_dimensions (
            id TEXT PRIMARY KEY,
            transaction_line_id TEXT NOT NULL REFERENCES journal_entries(id),
            dimension_id TEXT NOT NULL REFERENCES dimensions(id),
            UNIQUE(transaction_line_id, dimension_id)
        );

        CREATE INDEX IF NOT EXISTS idx_tld_dimension_id ON transaction_line_dimensions(dimension_id);

        CREATE TABLE IF NOT EXISTS contacts (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('CUSTOMER','VENDOR','EMPLOYEE','OTHER')),
            name TEXT NOT NULL,
            company_name TEXT,
            email TEXT,
            phone TEXT,
            address_line1 TEXT,
            address_line2 TEXT,
            city TEXT,
            state TEXT,
            postal_code TEXT,
            country TEXT DEFAULT 'US',
            tax_id TEXT,
            notes TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS transaction_contacts (
            id TEXT PRIMARY KEY,
            transaction_id TEXT NOT NULL REFERENCES transactions(id),
            contact_id TEXT NOT NULL REFERENCES contacts(id),
            role TEXT NOT NULL DEFAULT 'PRIMARY',
            UNIQUE(transaction_id, contact_id, role)
        );

        CREATE INDEX IF NOT EXISTS idx_tc_contact_id ON transaction_contacts(contact_id);
        CREATE INDEX IF NOT EXISTS idx_tc_transaction_id ON transaction_contacts(transaction_id);

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL CHECK(entity_type IN ('TRANSACTION','CONTACT','ACCOUNT')),
            entity_id TEXT NOT NULL,
            filename TEXT NOT NULL,
            stored_filename TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            file_size_bytes INTEGER NOT NULL DEFAULT 0,
            description TEXT,
            uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
            uploaded_by TEXT NOT NULL DEFAULT 'user'
        );

        CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);

        CREATE TABLE IF NOT EXISTS migration_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            description TEXT,
            checksum TEXT,
            applied_at TEXT NOT NULL DEFAULT (datetime('now')),
            success INTEGER NOT NULL DEFAULT 1,
            error_message TEXT,
            UNIQUE(module_id, version)
        );

        CREATE INDEX IF NOT EXISTS idx_migration_log_module ON migration_log(module_id);

        CREATE TABLE IF NOT EXISTS module_dependencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            depends_on_module_id TEXT NOT NULL,
            min_version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(module_id, depends_on_module_id)
        );

        CREATE TABLE IF NOT EXISTS module_registry (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            version TEXT NOT NULL,
            sdk_version TEXT NOT NULL,
            description TEXT,
            author TEXT,
            license TEXT,
            permissions TEXT NOT NULL DEFAULT '[]',
            dependencies TEXT NOT NULL DEFAULT '[]',
            entry_point TEXT,
            install_path TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled','failed','uninstalling')),
            installed_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS module_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL REFERENCES module_registry(id) ON DELETE CASCADE,
            scope TEXT NOT NULL,
            granted_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(module_id, scope)
        );

        CREATE INDEX IF NOT EXISTS idx_module_permissions_module ON module_permissions(module_id);

        CREATE TABLE IF NOT EXISTS module_pending_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            description TEXT,
            sql TEXT NOT NULL,
            checksum TEXT NOT NULL,
            registered_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(module_id, version)
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

    // Phase 39: Retroactively record kernel migrations in migration_log
    // (only after the migration_log table itself exists). We treat the kernel
    // schema as a single "version 1" baseline. Future kernel changes will add
    // new versioned rows here.
    let log_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='migration_log'",
        [], |row| row.get(0),
    ).unwrap_or(false);
    if log_exists {
        let kernel_migrations: &[(i64, &str)] = &[
            (1, "Initial kernel schema (accounts, transactions, journal_entries, settings)"),
            (2, "Add is_void/void_of to transactions"),
            (3, "Add transaction_id to audit_log"),
            (4, "Add journal_type to transactions"),
            (5, "Add is_system to accounts"),
            (6, "Add cash_flow_category and is_cash_account to accounts"),
            (7, "Add is_reconciled to journal_entries"),
            (8, "Add migration_log, module_dependencies, module_pending_migrations"),
            (9, "Add module_registry (Phase 40 SDK v1)"),
            (10, "Add module_permissions (Phase 41 enforcer)"),
        ];
        for (version, description) in kernel_migrations {
            conn.execute(
                "INSERT OR IGNORE INTO migration_log (module_id, version, description, checksum, success)
                 VALUES ('kernel', ?1, ?2, ?3, 1)",
                params![version, description, format!("kernel-v{}", version)],
            )?;
        }
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
