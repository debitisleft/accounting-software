# Bookkeeping App — Changelog

## STATUS: ALL 17 PHASES COMPLETE

## COMPLETED

### Phase 17 — Report Enhancements (2026-04-05)
- Added `get_account_ledger` Rust command: transactions for one account, running balance, pagination, date filter
- Running balance respects normal balance side (debit normal vs credit normal)
- Created AccountLedger.tsx: date, ref, description, debit, credit, running balance columns with date filter
- Added print-friendly CSS (@media print): hides nav/buttons, adds table borders, clean layout
- TrialBalance: account names are now clickable links that drill down to account ledger
- App.tsx: added ledger routing via state (ledgerAccountId), drill-down from Trial Balance
- All commands in api.ts + MockApi with full type coverage
- 5 new tests: running balance correct, respects normal side, pagination, date filter, metadata
- 75 total tests pass, typecheck clean

### Phase 16 — Period Management UI (2026-04-05)
- Added 3 Rust commands: lock_period_global, unlock_period_global, list_locked_periods_global
- Global lock model: locks everything through a date using account_id='GLOBAL' in reconciliation_periods
- Updated is_transaction_locked() to check global locks first, then per-account locks
- Sequential enforcement: cannot lock a date earlier than existing lock (prevents gaps)
- Created PeriodManagement.tsx: lock date picker, unlock button, periods list, confirmation dialogs
- Integrated into SettingsPage under new "Period Locking" section
- TransactionRegister already shows lock icon for locked transactions (Phase 12)
- All 3 commands in api.ts + MockApi (with isDateLocked helper for UI)
- 5 new tests: lock prevents edits, lock date check, unlock re-enables, no gaps, list order
- 70 total tests pass, typecheck clean

### Phase 15 — Settings & Preferences (2026-04-05)
- Created settings table in db.rs with default seeds: company_name, fiscal_year_start_month, currency_symbol, date_format
- Added 3 Rust commands: get_setting, set_setting, get_all_settings (upsert via INSERT OR REPLACE)
- All 3 in api.ts + MockApi
- Updated SettingsPage.tsx: company name, fiscal year month, currency symbol, date format, save button
- About section shows version + db path
- 5 new tests: get default, get null for unset, set+get roundtrip, get_all complete, overwrite
- 65 total tests pass, typecheck clean

### Phase 14 — CSV Export (2026-04-05)
- Added `export_csv` Rust command supporting 5 export types: ChartOfAccounts, TrialBalance, IncomeStatement, BalanceSheet, TransactionRegister
- All amounts exported as decimal dollars (cents / 100, 2 decimal places) for spreadsheet compatibility
- TransactionRegister export respects current filters (date range, account, memo search)
- Trial Balance export includes TOTAL row; Income Statement includes Net Income row
- Added to api.ts + MockApi with full type coverage
- Created src/lib/download.ts utility for browser CSV download (Blob + anchor)
- Added "Export CSV" button to all 5 data views (3 reports + register + accounts)
- 6 new tests: headers/row count, dollar format, TB balances, date filter, chart of accounts, income statement
- 60 total tests pass, typecheck clean

### Phase 13 — Backup & Restore (2026-04-05)
- Added 4 Rust commands: export_database (VACUUM INTO), import_database (validate + replace), auto_backup (keep 5), list_backups
- export uses SQLite VACUUM INTO for safe backup while db is open
- import validates required tables exist, closes connection, copies file, reopens
- auto_backup creates timestamped backups in app_data_dir/backups/, purges oldest beyond 5
- All 4 commands in api.ts + MockApi
- Created SettingsPage.tsx: About section (version/db path), Export/Import buttons, Auto-Backups list
- Wired SettingsPage into App.tsx replacing placeholder
- 5 new tests: export result, import counts, import rejects corrupt, auto creates, auto keeps 5
- 54 total tests pass, typecheck clean

### Phase 12 — Transaction Editing, Voiding & Audit Trail (2026-04-05)
- Added 4 Rust commands: update_transaction, update_transaction_lines, void_transaction, get_audit_log
- Added transaction_id column to audit_log table (migration in db.rs)
- update_transaction: edits date/description/reference, writes audit log per field, rejects if period locked
- update_transaction_lines: atomic line replacement, validates balance, audit logs old/new entries
- void_transaction: creates reversing entry (debit↔credit swap), marks original is_void=1, rejects if locked
- get_audit_log: returns audit trail for a transaction ordered by changed_at desc
- Added helper functions: is_transaction_locked(), write_audit_log()
- TransactionRegister expanded view now has: Edit (metadata), Edit Amounts (inline lines with balance indicator), Void (with confirm), View History (audit trail panel)
- Period-locked rows show lock icon, edit/void buttons hidden
- MockApi: added auditLog storage, lockPeriods, isTransactionLocked check, all 4 methods
- 8 new tests: edit metadata/amounts/audit, void creates reversal, void sets flag, locked rejects, audit order
- 49 total tests pass, typecheck clean

### Phase 11 — Transaction Register (2026-04-05)
- Added 3 Rust commands: list_transactions (pagination + filters), get_transaction_detail, count_transactions
- Added is_void and void_of columns to transactions table (migration pattern in db.rs)
- Updated TransactionWithEntries struct to include is_void/void_of in Rust, api.ts, MockApi
- list_transactions supports: date range, account filter, case-insensitive memo search, offset/limit pagination
- Created TransactionRegister.tsx: table with expand-to-see-entries, filter bar, pagination, VOID badges
- Multi-entry transactions show "primary account (split N)" collapsed, click to expand
- All 3 commands in api.ts + MockApi with full type coverage
- 8 new tests: pagination, date filter, account filter, memo search, void flag, detail, count
- 41 total tests pass, typecheck clean

### Phase 10 — Account Management CRUD (2026-04-05)
- Added 4 Rust commands: create_account, update_account, deactivate_account, reactivate_account
- All 4 commands added to api.ts + MockApi with matching validation logic
- create_account validates: non-empty name/code, unique code, valid type enum
- update_account: can change name/code but NOT type (preserves historical balances)
- deactivate_account: rejects if balance != 0, sets is_active=0
- get_accounts already filters to is_active=1 (deactivated hidden from dropdowns)
- Updated AccountsListPage: Add Account form, inline edit (name + code), deactivate button (disabled if balance != 0)
- 9 new tests: create valid, duplicate code, deactivate zero/non-zero, type immutable, inactive excluded, reactivate, update, dup code on update
- 33 total tests pass, typecheck clean

### Phase 9 — App Shell & Navigation (2026-04-05)
- Added `get_app_metadata` Rust command (version, db path, last backup date)
- Added `get_dashboard_summary` Rust command (totals for all 5 account types + net income + recent 10 txs)
- Both commands added to api.ts + MockApi with full type coverage
- Created `AppShell.tsx` — fixed left sidebar with sections: Overview, Transactions, Accounts, Reports, Settings
- Active page highlighted with left border accent; sidebar collapses to short labels via toggle button
- Created `Dashboard.tsx` — summary cards (assets, liabilities, equity, net income, revenue, expenses, tx count) + recent transactions table
- Replaced tab navigation in App.tsx with AppShell layout
- Updated `DbState` struct to store db_path alongside connection
- 4 new tests: metadata, dashboard totals, totals-match-reports, empty-dashboard
- 24 total tests pass, typecheck clean

### Architecture Migration: Dexie/IndexedDB → Tauri + rusqlite (2026-04-05)
**Why:** Dexie/IndexedDB is browser-only ephemeral storage. A desktop bookkeeping app
needs persistent SQLite on disk that survives app restarts and can be backed up.

**What changed:**
- **Rust backend** (src-tauri/src/): db.rs (init, tables, seed), commands.rs (10 Tauri commands), lib.rs (wiring)
- **TypeScript API layer** (src/lib/api.ts): single invoke() point, all types matching Rust structs
- **All 5 UI components**: rewired from Dexie → api.ts (Tauri IPC)
- **Tests**: MockApi in-memory JS mock implementing same logic as Rust backend
- **Removed**: Dexie, fake-indexeddb, DatabaseProvider, src/db/, src/lib/accounting.ts

**Where bookkeeping.db lives:** `{app_data_dir}/bookkeeping.db` (Tauri's app data directory)
  - Windows: `%APPDATA%/com.tauri.dev/bookkeeping.db`
  - SQLite WAL mode, foreign keys ON, bundled via rusqlite

**Architecture:**
```
React UI → api.ts → invoke() → Tauri IPC → commands.rs → rusqlite → bookkeeping.db
Tests    → MockApi (same logic, in-memory JS objects)
```

**Key decisions:**
- Balance validation enforced in Rust (commands.rs), not just UI
- Audit log written automatically on journal entry edits
- Period locking prevents edits to reconciled periods
- All amounts INTEGER CENTS throughout (Rust i64, TypeScript number)
- UUIDs for all primary keys (uuid v4)
- 19 tests pass in 328ms via MockApi

### Phase 7 — Final Integration Check (2026-04-05)
- Created `src/__tests__/integration.test.ts` with 5 real-world transactions:
  1. Owner invests $10,000 cash (EQUITY → ASSET)
  2. Cash sale of goods $2,500 (REVENUE → ASSET)
  3. Pay rent $1,200 (ASSET → EXPENSE)
  4. Receive repair bill $800 on credit (LIABILITY → EXPENSE)
  5. Bank deposit from customer $3,000 (REVENUE → ASSET)
- Verified: trial balance debits === credits ($17,500)
- Verified: balance sheet A ($14,300) = L ($800) + E ($13,500) ✓
- Verified: income statement net income ($3,500) matches equity change
- Verified: all amounts are integer cents (no floating point)
- 19 total tests, all passing, zero TypeScript errors

### Phase 6 — Reports (2026-04-05)
- Created `src/components/TrialBalance.tsx` — all accounts with debit/credit columns, totals
- Created `src/components/IncomeStatement.tsx` — date range picker, revenue/expense breakdown, net income
- Created `src/components/BalanceSheet.tsx` — assets, liabilities, equity with equation verification
- All reports show "Out of Balance" warning if equation breaks
- Updated App.tsx: replaced single Reports tab with 3 separate report tabs
- All 14 tests still pass, typecheck clean

### Phase 5 — Core UI Components (2026-04-05)
- Created `src/db/browser-connection.ts` using sql.js (WASM SQLite) for in-browser database
- Created `src/db/DatabaseProvider.tsx` — React context providing db + refresh/version for re-renders
- Created `src/components/AccountsListPage.tsx` — lists all 26 accounts grouped by type with balances
- Created `src/components/JournalEntryForm.tsx` — multi-row entry with live balance indicator
- Balance indicator: green when balanced, red when unbalanced, grey when empty
- Save button disabled until entries balance AND all fields filled
- Dollar input → cents conversion using Math.round(amount * 100)
- Updated App.tsx with tab navigation (Accounts, Journal Entry, Reports)
- Decision: used sql.js (WASM) instead of better-sqlite3 for browser compatibility
- AppDatabase type changed to BaseSQLiteDatabase to support both drivers

### Phase 4 — Engine Unit Tests (2026-04-05)
- Created `src/__tests__/accounting.test.ts` with 7 tests covering all required accounting rules
- Tests: balanced saves, unbalanced throws, asset debit increases, liability credit increases
- Tests: trial balance balances, income statement net income, balance sheet equation (A = L + E)
- All tests use in-memory SQLite — no production DB needed
- All 14 total tests pass (7 db + 7 accounting)

### Phase 3 — Accounting Engine (2026-04-05)
- Created `src/lib/accounting.ts` with 5 core functions
- `createTransaction()`: validates SUM(debit) === SUM(credit), throws typed `UnbalancedTransactionError`
- `getAccountBalance()`: respects normal balance side (ASSET/EXPENSE = debit, LIABILITY/EQUITY/REVENUE = credit)
- `getTrialBalance()`: all accounts with debit/credit columns, filtered to non-zero
- `getIncomeStatement(start, end)`: revenue - expenses = net income for date range
- `getBalanceSheet(asOfDate)`: assets = liabilities + equity (includes net income in equity)
- All amounts INTEGER cents, all functions strongly typed, no `any`

### Phase 2 — Database Schema (2026-04-05)
- Created `src/db/schema.ts` with accounts, transactions, journal_entries tables using Drizzle ORM
- All monetary columns (debit, credit) are INTEGER (cents) — never float
- CHECK constraints enforce non-negative debit/credit values
- Created `src/db/migrate.ts` for table creation from raw SQL (IF NOT EXISTS)
- Created `src/db/connection.ts` for database connection factory
- Created `src/db/seed.ts` with 26 default accounts across all 5 types
- 7 tests pass including seed verification, integer cents validation, CHECK constraint enforcement
- Fix: `accounts._.name` Drizzle internal API doesn't work; switched to `getTableName()` utility

### Phase 1 — Project Scaffold (2026-04-05)
- Scaffolded Vite + React + TypeScript project, then added Tauri v2 on top
- `create-tauri-app` CLI failed (requires interactive terminal), so used `create-vite` + `tauri init` instead
- Installed: drizzle-orm, better-sqlite3, @types/better-sqlite3, drizzle-kit, vitest, @vitest/ui
- Added scripts: test, test:log, typecheck, check
- Created .logs/ directory for verbose output
- Created placeholder test to verify vitest works
- Dev server confirmed running on localhost:5173
- `npm run check` passes (typecheck + tests)

## FAILED APPROACHES
- `npm create tauri-app@latest` fails in non-interactive terminal — use `create-vite` + `tauri init` instead
- `accounts._.name` Drizzle internal API doesn't exist in drizzle-orm — use `getTableName()` from `drizzle-orm` instead
- sql.js CJS module cannot be cleanly imported via Vite ESM — replaced with Dexie.js entirely
- Dexie/IndexedDB is ephemeral browser storage, wrong for desktop app — replaced with Tauri + rusqlite

### Fix: sql.js WASM loading error (2026-04-05)
- Copied `sql-wasm.wasm` from `node_modules/sql.js/dist/` to `public/`
- Changed `locateFile` from external CDN to local: `(file) => \`/${file}\``
- Added `optimizeDeps.exclude: ['sql.js']` to vite.config.ts
- Root cause: browser couldn't fetch WASM from sql.js.org CDN

### Fix: sql.js ESM import / COOP-COEP headers (2026-04-05)
- Replaced `server.headers` with middleware plugin for COOP/COEP headers (more reliable)
- Added `include: []` to optimizeDeps to prevent Vite pre-bundling sql.js CJS as ESM
- Root cause: Vite pre-bundling converted sql.js CJS into broken ESM with no default export

### Fix: Replace sql.js with Dexie.js (2026-04-05)
- sql.js WASM/ESM issues were unfixable in Vite — replaced entirely with Dexie.js (IndexedDB)
- Dexie is a proper ESM module, zero WASM config needed, works natively in all browsers
- Rewrote: db/index.ts (Dexie schema), seed.ts, accounting.ts (all async), DatabaseProvider.tsx
- Rewrote all 5 UI components for async Dexie API (useEffect + state instead of useMemo)
- Rewrote all 19 tests using fake-indexeddb for in-memory IndexedDB in Node
- Removed: browser-connection.ts, migrate.ts, schema.ts, connection.ts, public/sql-wasm.wasm
- Removed: vite.config.ts WASM/COOP/COEP config (no longer needed)
- Added tables: auditLog, reconciliationPeriods, categorizationRules (for future phases)
- Dev server startup: 278ms (was ~1400ms with WASM)

## KNOWN ISSUES
(none)