# Bookkeeping App — Build TODO

## RULES FOR CLAUDE CODE
- Complete and CHECK each phase before starting the next
- Run tests after every phase — do not proceed if tests fail
- All amounts stored as INTEGER CENTS — never floats
- Update the status of each task as you complete it: [ ] → [x]
- If a check fails, fix it before marking complete
- Every new Rust command needs: commands.rs function, api.ts wrapper, MockApi method, and at least one test

---

## PHASE 1 — Project Scaffold ✅
- [x] Initialize Tauri + React + TypeScript project
- [x] Install Drizzle ORM + better-sqlite3
- [x] Install Vitest for testing
- [x] Verify dev server runs with no errors
- [x] CHECK: `npm run dev` opens without console errors

## PHASE 2 — Database Schema ✅
- [x] Create schema.ts with accounts, transactions, journal_entries tables
- [x] Add check constraint: SUM(debit) = SUM(credit) per transaction
- [x] All monetary columns are INTEGER (cents), not REAL or FLOAT
- [x] Run Drizzle migration
- [x] Seed default chart of accounts (Assets, Liabilities, Equity, Revenue, Expenses)
- [x] CHECK: Query seeded accounts — confirm at least 20 default accounts exist

## PHASE 3 — Accounting Engine ✅
- [x] Create /src/lib/accounting.ts
- [x] Implement createTransaction() with balance validation
- [x] Implement getAccountBalance() respecting normal balance side
- [x] Implement getTrialBalance()
- [x] Implement getIncomeStatement(startDate, endDate)
- [x] Implement getBalanceSheet(asOfDate)
- [x] CHECK: All functions exported and typed with no TypeScript errors

## PHASE 4 — Engine Unit Tests ✅
- [x] Write test: balanced transaction saves successfully
- [x] Write test: unbalanced transaction throws typed error
- [x] Write test: asset account balance increases on debit
- [x] Write test: liability account balance increases on credit
- [x] Write test: trial balance debits === trial balance credits
- [x] Write test: income statement revenue - expenses = net income
- [x] CHECK: `npx vitest run` — ALL tests must pass before Phase 5

## PHASE 5 — Core UI Components ✅
- [x] AccountsListPage.tsx — list all accounts with current balance
- [x] JournalEntryForm.tsx — multi-row entry with live balance indicator
- [x] Balance indicator turns green only when debits === credits
- [x] Save button disabled until entries balance
- [x] Dollar input converts to cents on submit
- [x] CHECK: Manually enter a sample transaction and verify it saves

## PHASE 6 — Reports ✅
- [x] TrialBalance.tsx — all accounts, debit/credit columns
- [x] IncomeStatement.tsx — date range picker, revenue/expense breakdown
- [x] BalanceSheet.tsx — assets = liabilities + equity verification
- [x] Each report shows "Out of Balance" warning if equation breaks
- [x] CHECK: Reports render with seeded/test data without crashing

## PHASE 7 — Final Integration Check ✅
- [x] Enter 5 real-world transactions (sales, expense, owner equity, bill payment, bank deposit)
- [x] Verify trial balance balances
- [x] Verify balance sheet equation holds
- [x] Verify income statement net income matches equity change
- [x] CHECK: No TypeScript errors (`npx tsc --noEmit`)
- [x] CHECK: All Vitest tests still passing

## PHASE 8 — Architecture Migration (Dexie → rusqlite) ✅
- [x] Add rusqlite to src-tauri/Cargo.toml
- [x] Create src-tauri/src/db.rs (init, tables, seed)
- [x] Create src-tauri/src/commands.rs (10 Tauri commands)
- [x] Balance validation enforced in Rust
- [x] Create src/lib/api.ts (single invoke() layer)
- [x] Rewire all 5 UI components to api.ts
- [x] Replace Dexie tests with MockApi tests
- [x] Remove Dexie and fake-indexeddb
- [x] Verify data persists across app restarts
- [x] CHECK: npm run tauri dev opens as desktop window with data surviving close and reopen

---

## PHASE 9 — App Shell & Navigation
- [x] Add `get_app_metadata` Rust command (version, db path, last backup date)
- [x] Add `get_dashboard_summary` Rust command (totals for assets, liabilities, equity, revenue, expenses, net income)
- [x] Add both commands to api.ts + MockApi
- [x] Create `AppShell.tsx` — fixed left sidebar + main content area
- [x] Sidebar sections: Transactions (Journal Entry, Register), Accounts, Reports (TB, IS, BS), Settings
- [x] Active page highlighted in sidebar
- [x] Create `Dashboard.tsx` — summary cards + last 10 transactions
- [x] Sidebar collapses to icons on narrow windows
- [x] Test: get_dashboard_summary returns correct totals
- [x] Test: summary totals match individual report calculations
- [ ] CHECK: App opens with sidebar, dashboard shows data, all tests pass, `npm run check` clean

## PHASE 10 — Account Management (CRUD)
- [x] Add `is_active` column to accounts table (ALTER TABLE, default true)
- [x] Add `create_account` Rust command (name, number, type, optional parent_id) with validation
- [x] Add `update_account` Rust command (id, new name, new number — cannot change type)
- [x] Add `deactivate_account` Rust command (rejects if balance ≠ 0)
- [x] Add `reactivate_account` Rust command
- [x] Add all 4 commands to api.ts + MockApi
- [x] Update AccountsListPage: "Add Account" button, edit icon per row, deactivate toggle
- [x] Deactivated accounts in collapsed "Inactive" section
- [x] Account dropdowns filter to active only
- [x] Test: create account with valid data succeeds
- [x] Test: create account with duplicate number fails
- [x] Test: deactivate with zero balance succeeds
- [x] Test: deactivate with non-zero balance fails
- [x] Test: cannot change account type after creation
- [x] Test: deactivated accounts excluded from active queries
- [x] CHECK: Can add, rename, deactivate accounts via UI, all tests pass, `npm run check` clean

## PHASE 11 — Transaction Register (Read-Only)
- [x] Add `list_transactions` Rust command (pagination, sort, filters: date range, account, amount, memo)
- [x] Add `get_transaction` Rust command (single by ID, full detail + audit history)
- [x] Add `count_transactions` Rust command (total matching filters)
- [x] Add all 3 commands to api.ts + MockApi
- [x] Create `TransactionRegister.tsx` — table with Date, Ref, Memo, Accounts, Debit, Credit, Status
- [x] Multi-entry rows show primary account + "(split)" — collapsed by default, click to expand
- [x] Voided transactions: strikethrough + VOID badge
- [x] Pagination controls (prev/next, page size 25/50/100)
- [x] Filter bar: date range, account dropdown, memo search, clear filters
- [x] Add Transaction Register to sidebar
- [x] Test: list_transactions returns correct page
- [x] Test: date range filter works
- [x] Test: account filter returns only matching transactions
- [x] Test: memo search is case-insensitive partial match
- [x] Test: pagination offset/limit correct
- [x] Test: voided transactions included with is_void flag
- [x] CHECK: Register shows all transactions, filters work, expand works, all tests pass, `npm run check` clean

## PHASE 12 — Transaction Editing, Voiding & Audit Trail
- [x] Add `is_void` and `void_of` columns to transactions table
- [x] Verify audit_log table has: id, transaction_id, field_changed, old_value, new_value, changed_at
- [x] Add `update_transaction` Rust command (date, memo, reference — writes audit log, rejects if locked)
- [x] Add `update_transaction_lines` Rust command (replaces lines atomically, validates balance, audit log, rejects if locked)
- [x] Add `void_transaction` Rust command (reversing entry, marks original void, rejects if locked)
- [x] Add `get_audit_log` Rust command (audit trail for a transaction_id)
- [x] Add all 4 commands to api.ts + MockApi
- [x] In expanded transaction: Edit button → inline edit mode (metadata fields become inputs)
- [x] "Edit Amounts" → line items become editable rows with live balance indicator
- [x] Save / Cancel buttons on edit mode
- [x] "Void" button → confirmation dialog → creates reversing entry
- [x] Period-locked rows: greyed out, no edit/void buttons
- [x] "View History" link → collapsible audit trail panel
- [x] Test: edit metadata writes audit log
- [x] Test: edit amounts validates balance
- [x] Test: edit amounts writes audit log with old/new JSON
- [x] Test: void creates correct reversing entry
- [x] Test: void sets is_void on original
- [x] Test: edit locked-period transaction rejected
- [x] Test: void locked-period transaction rejected
- [x] Test: get_audit_log returns correct order
- [x] CHECK: Can edit and void transactions, audit trail visible, locked periods enforced, all tests pass, `npm run check` clean

## PHASE 13 — Backup & Restore
- [x] Add `export_database` Rust command (SQLite backup API to user-chosen path)
- [x] Add `import_database` Rust command (validate, replace, reopen — returns account/transaction counts)
- [x] Add `auto_backup` Rust command (backup to app_data_dir/backups, keep last 5)
- [x] Add `list_backups` Rust command (backup files with dates and sizes)
- [x] Add all 4 commands to api.ts + MockApi
- [x] Settings page: Export button → file dialog, Import button → confirmation → file dialog
- [x] Auto-Backups section: list recent backups, restore from list
- [x] On app startup: call auto_backup silently
- [x] Test: export creates valid SQLite file
- [x] Test: import replaces database and returns correct counts
- [x] Test: import rejects corrupt files
- [x] Test: auto_backup creates file in backups dir
- [x] Test: auto_backup keeps only 5 most recent
- [x] CHECK: Can export/import database, auto-backup works, all tests pass, `npm run check` clean

## PHASE 14 — CSV Export
- [x] Add `export_csv` Rust command (type enum: TransactionRegister, TrialBalance, IncomeStatement, BalanceSheet, ChartOfAccounts)
- [x] Amounts exported as decimal dollars (cents / 100, 2 decimal places)
- [x] Add command to api.ts + MockApi
- [x] "Export CSV" button on each report component + TransactionRegister + AccountsListPage
- [x] Each button → Tauri save file dialog → write CSV → success toast
- [x] Test: CSV has correct headers and row count
- [x] Test: amounts formatted as decimal dollars
- [x] Test: trial balance CSV debits === credits
- [x] Test: date filter applies to export
- [x] CHECK: All report types export to valid CSV, amounts correct, all tests pass, `npm run check` clean

## PHASE 15 — Settings & Preferences
- [x] Create `settings` table: key TEXT PRIMARY KEY, value TEXT
- [x] Seed defaults: company_name, fiscal_year_start_month, currency_symbol, date_format
- [x] Add `get_setting`, `set_setting`, `get_all_settings` Rust commands
- [x] Add all 3 commands to api.ts + MockApi
- [x] Create `SettingsPage.tsx`: company name, fiscal year month, currency symbol, date format, save button
- [x] About section: app version, db path, db size
- [x] Apply settings throughout app: currency symbol in amounts, date format in displays, company name in header
- [x] Fiscal year start month used in income statement default range
- [x] Test: get_setting returns default for unset key
- [x] Test: set + get roundtrips correctly
- [x] Test: get_all_settings returns complete map
- [x] CHECK: Settings save/persist, currency and dates reflected in app, all tests pass, `npm run check` clean

## PHASE 16 — Period Management UI
- [ ] Add `lock_period` Rust command (end_date, validates sequential)
- [ ] Add `unlock_period` Rust command (removes most recent lock, writes audit log)
- [ ] Add `list_locked_periods` Rust command
- [ ] Add all 3 commands to api.ts + MockApi
- [ ] Create `PeriodManagement.tsx` (under Settings): locked periods list, lock date picker, unlock button
- [ ] Confirmation dialogs for lock and unlock actions
- [ ] Lock icon + grey styling on locked transactions in TransactionRegister
- [ ] JournalEntryForm date picker prevents locked dates
- [ ] Dashboard shows locked-through date
- [ ] Test: lock prevents edits in range
- [ ] Test: lock prevents new transactions in range
- [ ] Test: unlock re-enables editing
- [ ] Test: cannot create gap in locked periods
- [ ] CHECK: Lock/unlock works via UI, visual indicators correct, all tests pass, `npm run check` clean

## PHASE 17 — Report Enhancements
- [ ] Add `get_account_ledger` Rust command (transactions for one account, running balance, pagination)
- [ ] Add command to api.ts + MockApi
- [ ] Apply currency symbol and date format from settings to all reports
- [ ] Add print-friendly CSS to all reports (@media print)
- [ ] TrialBalance: clickable account names → drill down to account ledger
- [ ] Create `AccountLedger.tsx` — Date, Ref, Memo, Debit, Credit, Running Balance
- [ ] Account ledger: date range picker, links to full transaction in register
- [ ] Income Statement: percentage column (each line as % of total revenue)
- [ ] Test: get_account_ledger returns correct running balance
- [ ] Test: running balance respects normal balance side
- [ ] Test: pagination works on account ledger
- [ ] CHECK: Drill-down works, running balance correct, print styles work, all tests pass, `npm run check` clean

---

## CURRENT PHASE: 16
## LAST COMPLETED CHECK: Phase 15 — settings, 65 tests pass (2026-04-05)
## BLOCKING ISSUES: None

## FUTURE PHASES (scoped, not scheduled)
- Phase 18: Excel-style transaction register UX (inline edit, sidebar edit mode)
- Phase 19: CSV import with column mapping UI
- Phase 20: Recurring transactions (templates + recurrence rules)
- Phase 21: Bank feed pipeline (Plaid API integration)
- Phase 22: Reconciliation service (book vs statement balance)
- Phase 23: Packaging & distribution (installer, auto-update)
