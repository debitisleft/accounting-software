# Bookkeeping App — Build Plan v2

## CONTEXT
Phases 1–8 are complete. We have a working Tauri + React + TypeScript + rusqlite app with:
- Double-entry accounting engine (create transactions, balance validation, 5 report types)
- 5 UI components (AccountsList, JournalEntryForm, TrialBalance, IncomeStatement, BalanceSheet)
- Tab navigation in App.tsx
- 10 Tauri commands in Rust, api.ts IPC layer
- 19 tests via MockApi, all passing
- Audit log table exists, period locking infrastructure exists

## WHAT'S MISSING (why "basics first")
The engine can create transactions but can't edit, void, or search them. There's no transaction history view — you enter a journal entry and it disappears into the ledger. Accounts are seeded but can't be added or modified. There's no backup, no export, no settings. The app shell is bare tabs. None of this is ready for the Excel-style register UX or bank feeds — those are complex features that need a solid foundation underneath.

## DESIGN PRINCIPLES
1. **Engine before UI** — every feature starts in Rust (commands.rs), gets a TypeScript API wrapper (api.ts), gets a MockApi test, THEN gets a React component
2. **Never delete financial data** — edits create audit log entries, "deletes" are voids (reversing entries)
3. **Integer cents everywhere** — all amounts are i64 in Rust, number in TypeScript, stored as INTEGER in SQLite
4. **Period locks are hard** — once a period is locked, no Rust command will modify transactions in that period, regardless of what the UI sends
5. **Collapsed by default** — multi-entry transactions stay collapsed until explicitly clicked, including in edit mode

## ARCHITECTURE REMINDER
```
React UI → api.ts → invoke() → Tauri IPC → commands.rs → rusqlite → bookkeeping.db
Tests    → MockApi (same interface, in-memory JS objects)
```

Every new Rust command needs:
1. A function in commands.rs (with #[tauri::command])
2. A matching function in api.ts
3. A matching function in MockApi
4. At least one test

---

# PHASE 9 — App Shell & Navigation

**Goal:** Replace tab navigation with a proper app layout that can scale to 15+ views without becoming unusable.

### Rust/Backend
- [ ] Add `get_app_metadata` command — returns app version, db path, last backup date
- [ ] Add `get_dashboard_summary` command — returns total assets, total liabilities, total equity, total revenue, total expenses, net income (current fiscal year)

### UI
- [ ] Create `AppShell.tsx` — fixed left sidebar + main content area
- [ ] Sidebar sections: **Transactions** (Journal Entry, Transaction Register), **Accounts** (Chart of Accounts), **Reports** (Trial Balance, Income Statement, Balance Sheet), **Settings** (at bottom)
- [ ] Active page highlighted in sidebar, clicking navigates (React state, no router needed yet)
- [ ] Create `Dashboard.tsx` — landing page showing summary cards (total assets, liabilities, equity, net income) and recent transactions list (last 10)
- [ ] Responsive: sidebar collapses to icons on narrow windows

### Tests
- [ ] Test: `get_dashboard_summary` returns correct totals after seeding + sample transactions
- [ ] Test: summary totals match individual report calculations

### CHECK
- [ ] App opens with sidebar navigation, dashboard shows summary data
- [ ] All existing tests still pass
- [ ] `npm run check` clean

---

# PHASE 10 — Account Management (CRUD)

**Goal:** Users can add, edit, and deactivate accounts. No account is ever hard-deleted (referential integrity).

### Rust/Backend
- [ ] Add `create_account` command — takes name, account_number, account_type, optional parent_id
  - Validates: name not empty, account_number unique, type is valid enum
- [ ] Add `update_account` command — takes account_id, new name, new account_number
  - Cannot change account_type after creation (would break historical balances)
  - Cannot edit if account is in a locked period's transactions
- [ ] Add `deactivate_account` command — sets `is_active = false`
  - Cannot deactivate if account has non-zero balance
  - Deactivated accounts hidden from dropdowns but visible in reports
- [ ] Add `reactivate_account` command — sets `is_active = true`
- [ ] Add `is_active` column to accounts table (migration: ALTER TABLE, default true)

### UI
- [ ] Update `AccountsListPage.tsx`:
  - "Add Account" button → modal form (name, number, type dropdown)
  - Each account row gets an edit icon → inline edit or modal for name/number
  - Each account row gets a deactivate toggle (greyed out if balance ≠ 0)
  - Deactivated accounts shown in a collapsed "Inactive" section at bottom
- [ ] Account dropdowns throughout app filter to active accounts only

### Tests
- [ ] Test: create account with valid data succeeds
- [ ] Test: create account with duplicate number fails
- [ ] Test: deactivate account with zero balance succeeds
- [ ] Test: deactivate account with non-zero balance fails
- [ ] Test: cannot change account type after creation
- [ ] Test: deactivated accounts excluded from active account queries

### CHECK
- [ ] Can add, rename, and deactivate accounts through the UI
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 11 — Transaction Register (Read-Only List View)

**Goal:** A scrollable list of all transactions with sorting and basic filtering. This is the READ view — editing comes in Phase 12.

### Rust/Backend
- [ ] Add `list_transactions` command — returns transactions with:
  - Pagination: `offset` + `limit` (default 50)
  - Sort: by date (default desc), by amount, by account
  - Filters: date range, account_id, min/max amount, memo search (LIKE)
  - Each transaction includes: id, date, memo, reference, line items (account name, debit, credit), is_void, created_at
- [ ] Add `get_transaction` command — single transaction by ID with full detail + audit history
- [ ] Add `count_transactions` command — total count matching current filters (for pagination UI)

### UI
- [ ] Create `TransactionRegister.tsx`:
  - Table columns: Date | Reference | Memo | Accounts | Debit Total | Credit Total | Status
  - Multi-entry transactions show primary account + "(split)" or account count
  - Collapsed by default — click row to expand and see all line items
  - Voided transactions shown with strikethrough + "VOID" badge
  - Pagination controls at bottom (prev/next, page size selector: 25/50/100)
- [ ] Filter bar at top:
  - Date range picker (from/to)
  - Account dropdown filter
  - Memo search text input
  - "Clear filters" button
- [ ] Click transaction row → expand to show all line items (not a new page)
- [ ] Add "Transaction Register" to sidebar under Transactions

### Tests
- [ ] Test: list_transactions returns correct page of results
- [ ] Test: date range filter works correctly
- [ ] Test: account filter returns only transactions touching that account
- [ ] Test: memo search is case-insensitive partial match
- [ ] Test: pagination offset/limit returns correct slices
- [ ] Test: voided transactions included with is_void flag

### CHECK
- [ ] Transaction register shows all transactions with pagination working
- [ ] Filters narrow results correctly
- [ ] Expanding a row shows all line items
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 12 — Transaction Editing, Voiding & Audit Trail

**Goal:** Users can edit transaction metadata and amounts, or void transactions entirely. Every change is audit-logged. Period-locked transactions are untouchable.

### Rust/Backend
- [ ] Add `update_transaction` command:
  - Editable fields: date, memo, reference
  - Writes audit_log entry: transaction_id, field_changed, old_value, new_value, changed_at
  - Rejects if any line item falls in a locked period
- [ ] Add `update_transaction_lines` command:
  - Replaces all line items atomically (delete old, insert new)
  - Validates SUM(debit) = SUM(credit) before committing
  - Writes audit_log entry with old and new line items (JSON)
  - Rejects if transaction is in a locked period
- [ ] Add `void_transaction` command:
  - Creates a reversing entry (same accounts, debits↔credits swapped)
  - Marks original transaction as `is_void = true`
  - Links reversing entry to original via `void_of` foreign key
  - Writes audit_log entry
  - Rejects if transaction is in a locked period
- [ ] Add `get_audit_log` command — returns audit trail for a transaction_id, ordered by changed_at desc

### Schema Changes
- [ ] Add `is_void BOOLEAN DEFAULT false` to transactions table
- [ ] Add `void_of UUID REFERENCES transactions(id)` to transactions table (nullable)
- [ ] Verify audit_log table has: id, transaction_id, field_changed, old_value, new_value, changed_at, user_note

### UI
- [ ] In expanded transaction row (from Phase 11), add:
  - "Edit" button → opens inline edit mode for that transaction
  - Metadata fields (date, memo, reference) become editable inputs
  - "Edit Amounts" button → expands line items into editable rows (same UX as JournalEntryForm)
  - Live balance indicator on amount edits (green/red)
  - "Save" / "Cancel" buttons
  - "Void" button → confirmation dialog ("This will create a reversing entry. Continue?")
- [ ] Greyed-out rows for period-locked transactions — no edit/void buttons shown
- [ ] "View History" link → shows audit trail in a collapsible panel below the transaction
- [ ] Voided transactions: strikethrough styling, "VOID" badge, link to reversing entry

### Tests
- [ ] Test: edit metadata writes audit log entry
- [ ] Test: edit amounts validates balance before saving
- [ ] Test: edit amounts writes audit log with old/new JSON
- [ ] Test: void creates correct reversing entry
- [ ] Test: void sets is_void flag on original
- [ ] Test: editing locked-period transaction is rejected
- [ ] Test: voiding locked-period transaction is rejected
- [ ] Test: get_audit_log returns entries in correct order

### CHECK
- [ ] Can edit a transaction's date, memo, and amounts through the UI
- [ ] Can void a transaction and see the reversing entry
- [ ] Audit trail visible for edited transactions
- [ ] Period-locked transactions cannot be modified
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 13 — Backup & Restore

**Goal:** Users can manually export/import the database file. Auto-backup on app launch.

### Rust/Backend
- [ ] Add `export_database` command:
  - Takes destination path (from Tauri file dialog)
  - Copies bookkeeping.db to destination using SQLite backup API (not raw file copy — safe even if db is open)
  - Returns success + file size
- [ ] Add `import_database` command:
  - Takes source path (from Tauri file dialog)
  - Validates it's a valid SQLite database with expected tables
  - Closes current connection, replaces bookkeeping.db, reopens
  - Returns success + account count + transaction count (as sanity check)
- [ ] Add `auto_backup` command:
  - Runs on app startup
  - Copies to `{app_data_dir}/backups/bookkeeping-{YYYY-MM-DD-HHmmss}.db`
  - Keeps last 5 backups, deletes older ones
  - Returns backup path + count of existing backups
- [ ] Add `list_backups` command — returns list of backup files with dates and sizes

### UI
- [ ] Add to Settings page:
  - "Export Database" button → Tauri save file dialog → progress indicator → success toast
  - "Restore from Backup" button → Tauri open file dialog → confirmation dialog ("This will replace all current data. Continue?") → progress → success toast + app refresh
  - "Auto-Backups" section showing list of recent backups with dates
  - "Restore from Auto-Backup" picks from list instead of file dialog
- [ ] On app startup: call auto_backup silently, log result to console

### Tests
- [ ] Test: export creates valid SQLite file at destination
- [ ] Test: import replaces database and returns correct counts
- [ ] Test: import rejects invalid/corrupt files
- [ ] Test: auto_backup creates file in backups directory
- [ ] Test: auto_backup keeps only 5 most recent

### CHECK
- [ ] Can export database to desktop, reimport it, and see same data
- [ ] Auto-backup creates file on app launch
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 14 — CSV Export

**Goal:** Export reports and transaction register to CSV for accountants and spreadsheets.

### Rust/Backend
- [ ] Add `export_csv` command — takes export_type enum + parameters:
  - `TransactionRegister` — same filters as list_transactions, outputs: Date, Reference, Memo, Account, Debit, Credit
  - `TrialBalance` — as-of date, outputs: Account Number, Account Name, Debit, Credit
  - `IncomeStatement` — date range, outputs: Account Name, Type, Amount
  - `BalanceSheet` — as-of date, outputs: Account Name, Type, Amount
  - `ChartOfAccounts` — outputs: Account Number, Account Name, Type, Active, Balance
- [ ] All amounts exported as decimal dollars (cents / 100, 2 decimal places) for human readability
- [ ] Returns CSV string — UI handles save-to-file via Tauri dialog

### UI
- [ ] Add "Export CSV" button to each report component (TrialBalance, IncomeStatement, BalanceSheet)
- [ ] Add "Export CSV" button to TransactionRegister (exports current filtered view)
- [ ] Add "Export Chart of Accounts" button to AccountsListPage
- [ ] All export buttons → Tauri save file dialog → write CSV → success toast

### Tests
- [ ] Test: transaction register CSV has correct headers and row count
- [ ] Test: CSV amounts are formatted as decimal dollars (not cents)
- [ ] Test: trial balance CSV debits === credits
- [ ] Test: date range filter applies to CSV export

### CHECK
- [ ] Can export each report type to CSV and open in a spreadsheet
- [ ] Amounts display correctly as dollars (not cents)
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 15 — Settings & Preferences

**Goal:** Persistent app settings stored in a settings table.

### Rust/Backend
- [ ] Create `settings` table: key TEXT PRIMARY KEY, value TEXT
- [ ] Add `get_setting` command — returns value for key (or default)
- [ ] Add `set_setting` command — upserts key/value pair
- [ ] Add `get_all_settings` command — returns all settings as key/value map
- [ ] Default settings (seeded on first run):
  - `company_name`: "My Company"
  - `fiscal_year_start_month`: "1" (January)
  - `currency_symbol`: "$"
  - `date_format`: "MM/DD/YYYY"

### UI
- [ ] Create `SettingsPage.tsx`:
  - Company name text input
  - Fiscal year start month dropdown (Jan–Dec)
  - Currency symbol input
  - Date format dropdown (MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD)
  - "Save" button → saves all changed settings
  - "About" section: app version, database path, database size
- [ ] Settings applied throughout app:
  - Company name shown in app header/sidebar
  - Currency symbol used in all amount displays
  - Date format used in all date displays and pickers
  - Fiscal year start month used in income statement default date range

### Tests
- [ ] Test: get_setting returns default for unset key
- [ ] Test: set_setting + get_setting roundtrips correctly
- [ ] Test: get_all_settings returns complete map

### CHECK
- [ ] Settings page saves and persists across app restarts
- [ ] Currency symbol and date format reflected throughout app
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 16 — Period Management UI

**Goal:** UI for the period locking infrastructure that already exists in the engine.

### Rust/Backend
- [ ] Add `lock_period` command — takes end_date, locks all transactions on or before that date
  - Validates: no unlocked period exists after this date (periods must be sequential)
  - Writes to reconciliation_periods table
- [ ] Add `unlock_period` command — removes the most recent lock only
  - Writes audit_log entry
- [ ] Add `list_locked_periods` command — returns all locked periods with dates

### UI
- [ ] Create `PeriodManagement.tsx` (under Settings):
  - List of locked periods with lock dates
  - "Lock Period Through" date picker + "Lock" button
  - Confirmation dialog: "This will prevent editing all transactions through {date}. Continue?"
  - "Unlock Most Recent" button → confirmation → removes last lock
  - Visual indicator in TransactionRegister for locked transactions (lock icon + greyed out)
- [ ] JournalEntryForm: date picker prevents selecting dates in locked periods
- [ ] Dashboard: shows current locked-through date if any

### Tests
- [ ] Test: lock_period prevents transaction edits in that range
- [ ] Test: lock_period prevents new transactions with dates in that range
- [ ] Test: unlock_period re-enables editing for that range
- [ ] Test: cannot lock a period that would create a gap (sequential enforcement)

### CHECK
- [ ] Can lock and unlock periods through the UI
- [ ] Locked transactions are visually indicated and non-editable
- [ ] New journal entries cannot use locked dates
- [ ] All tests pass
- [ ] `npm run check` clean

---

# PHASE 17 — Report Enhancements

**Goal:** Polish reports with the settings from Phase 15 and add account drill-down.

### Rust/Backend
- [ ] Add `get_account_ledger` command — returns all transactions for an account in date range
  - Running balance column (calculated per row)
  - Pagination support

### UI
- [ ] All reports: apply currency symbol and date format from settings
- [ ] All reports: add print-friendly CSS (@media print)
- [ ] TrialBalance: clickable account names → drill down to account ledger
- [ ] Create `AccountLedger.tsx` — shows all transactions for one account with running balance
  - Date | Reference | Memo | Debit | Credit | Running Balance
  - Date range picker
  - Links back to full transaction in TransactionRegister
- [ ] BalanceSheet: comparative mode (this period vs last period) — optional stretch goal
- [ ] Income Statement: add percentage column (each line as % of total revenue)

### Tests
- [ ] Test: get_account_ledger returns correct running balance
- [ ] Test: running balance respects normal balance side (assets start positive on debits)
- [ ] Test: account ledger pagination works correctly

### CHECK
- [ ] Reports use configured currency symbol and date format
- [ ] Account drill-down works from trial balance
- [ ] Running balance is correct in account ledger
- [ ] All tests pass
- [ ] `npm run check` clean

---

# FUTURE PHASES (scoped, not yet scheduled)

These phases depend on the foundation above being solid.

### Phase 18 — Excel-Style Transaction Register UX
_Decisions already made:_
- Hybrid interaction: inline editing for metadata, panel expansion for amounts
- Edit mode activated by sidebar button, not per-row
- Multi-entry transactions always collapsed until clicked (even in edit mode)
- Period-locked and reconciled rows greyed out at UI and engine level
- Silent audit logging (no confirmation dialogs per edit)
_Depends on:_ Phases 11, 12

### Phase 19 — CSV Import with Mapping UI
- Upload CSV → preview table → map columns to fields → validate → create transactions
- Duplicate detection (date + amount + memo match)
- Error report for rejected rows
_Depends on:_ Phase 14

### Phase 20 — Recurring Transactions
- Save transaction as template
- Recurrence rules (weekly, monthly, quarterly, yearly)
- Auto-generate or prompt on due date
- Manage/edit/pause recurring entries
_Depends on:_ Phase 12

### Phase 21 — Bank Feed Pipeline (Plaid Integration)
_Architecture already designed:_
- Plaid API → normalize → deduplicate → pending_bank_transactions table
- Approval flow: user matches pending item to account → createTransaction() fires
- Separate from accounting engine — touch point is only at approval
_Depends on:_ Phases 11, 12, 18

### Phase 22 — Reconciliation Service
- Book balance vs statement balance comparison
- Match transactions to bank feed items
- Lock period when reconciled
- Reconciliation report
_Depends on:_ Phases 16, 21

### Phase 23 — Packaging & Distribution (out of scope per user)
- App icon, installer (MSI/DMG/AppImage), auto-update via Tauri

---

# UPDATED CLAUDE.md ADDITIONS

When work begins, add these to CLAUDE.md:

```
## NEW COMMANDS (Phase 9+)
Each new Rust command must have:
1. Function in commands.rs with #[tauri::command]
2. Matching function in api.ts
3. Matching function in MockApi
4. At least one test

## MIGRATION PATTERN
Schema changes use raw SQL in db.rs init_db():
- Always use IF NOT EXISTS / ALTER TABLE IF NOT EXISTS
- Never drop tables — append migrations
- Test migrations against both fresh and existing databases

## UI PATTERN
New pages follow this structure:
1. Component in src/components/
2. Registered in AppShell.tsx sidebar
3. Data fetched via api.ts in useEffect
4. Loading state while data fetches
5. Error state with retry button
```

---

# SUMMARY

| Phase | What | New Rust Commands | New UI Components | Est. Tests |
|-------|------|------------------|-------------------|------------|
| 9 | App Shell & Navigation | 2 | AppShell, Dashboard | 2 |
| 10 | Account Management | 4 | AccountsListPage updates | 6 |
| 11 | Transaction Register | 3 | TransactionRegister | 6 |
| 12 | Editing & Voiding | 4 | Inline edit, void flow | 8 |
| 13 | Backup & Restore | 4 | Settings backup section | 5 |
| 14 | CSV Export | 1 | Export buttons on reports | 4 |
| 15 | Settings | 3 | SettingsPage | 3 |
| 16 | Period Management | 3 | PeriodManagement | 4 |
| 17 | Report Enhancements | 1 | AccountLedger + polish | 3 |
| **Total** | | **25 commands** | **~8 new components** | **~41 tests** |

This brings the app from "proof of concept with an engine" to "usable bookkeeping tool" — the foundation the Excel-style UX and bank feeds need underneath them.
