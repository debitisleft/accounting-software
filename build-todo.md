# Bookkeeping App — Build TODO

## RULES FOR CLAUDE CODE
- Complete and CHECK each phase before starting the next
- Run tests after every phase — do not proceed if tests fail
- All amounts stored as INTEGER CENTS — never floats
- Update the status of each task as you complete it: [ ] → [x]
- If a check fails, fix it before marking complete
- Every new Rust command needs: commands.rs function, api.ts wrapper, MockApi method, and at least one test

---

## PHASES 1–18 ✅ COMPLETE
See previous build-todo files for full history.
- Phases 1–8: Scaffold, schema, engine, tests, UI, reports, integration, Tauri migration
- Phases 9–17: App shell, account CRUD, transaction register, editing/voiding, backup, CSV export, settings, period management, report enhancements
- Phase 18: File-based .sqlite architecture (WelcomeScreen, multi-file, recent files)
- 85 tests passing at end of Phase 18

---

## PHASE 19 — Engine Audit Bug Fixes
**Goal:** Fix the 5 bugs found in the engine audit. All fixes in BOTH MockApi and Rust.

- [x] Fix: `createTransaction` must check period locks — reject if date is in locked period (CRITICAL)
- [x] Fix: Cannot void a reversing entry — check `void_of IS NOT NULL` before voiding
- [x] Fix: Cannot edit a voided transaction — check `is_void = 1` in updateTransaction and updateTransactionLines
- [x] Fix: Cannot create transactions referencing deactivated accounts — check `is_active` in createTransaction
- [x] Fix: Duplicate period locks on same end_date prevented — change `>` to `>=` in lock check
- [x] All 5 fixes applied to both Rust and MockApi
- [x] Run full suite: 85 existing + 55 audit tests = 140 total, 0 failures
- [x] CHECK: `npx vitest run` — 140 tests pass, `npx tsc --noEmit` clean

---

## PHASE 20 — Journal Types & Transaction Classification
**Goal:** Add journal type classification to transactions. Required before fiscal year close.

- [x] Add `journal_type TEXT DEFAULT 'GENERAL'` column to transactions table (migration)
  - Valid values: `GENERAL`, `ADJUSTING`, `CLOSING`, `REVERSING`, `OPENING`
- [x] Update `createTransaction` in Rust + api.ts + MockApi to accept optional `journal_type` parameter (defaults to GENERAL)
- [x] Add `auto_reference_number` logic: auto-generate reference if not provided
  - Format: `GJ-0001`, `AJ-0001`, `CJ-0001` by journal type
  - Counter stored in settings table per type
- [x] Update JournalEntryForm: journal type dropdown (default GENERAL, options: General, Adjusting)
  - Users should NOT manually create CLOSING, REVERSING, or OPENING entries — those are system-generated
- [x] Update TransactionRegister: show journal type as badge/tag on each row
- [x] Update income statement + trial balance: add filter toggle "Include adjusting entries" / "Exclude closing entries"
- [x] Test: transaction created with default type is GENERAL
- [x] Test: transaction created with ADJUSTING type is stored correctly
- [x] Test: auto-reference generates sequential numbers per type
- [x] Test: CLOSING and OPENING types cannot be manually created (only via system commands)
- [x] CHECK: Journal types visible in register, filters work, auto-reference works, all tests pass, `npm run check` clean

---

## PHASE 21 — Retained Earnings & Opening Balances
**Goal:** Seed retained earnings account. Build opening balance entry system.

### Retained Earnings
- [x] Add "Retained Earnings" account to seed data (code 3200, type EQUITY, normal_balance CREDIT)
- [x] Add "Opening Balance Equity" account to seed data (code 3500, type EQUITY, normal_balance CREDIT)
- [x] Mark both accounts as system accounts: add `is_system INTEGER DEFAULT 0` column to accounts table
  - System accounts cannot be deactivated, deleted, or have their type changed
- [x] Update deactivation logic: reject deactivation of system accounts

### Opening Balances
- [x] Add `enter_opening_balances` Rust command:
  - Takes: list of { account_id, balance } pairs + effective date
  - Creates a single transaction with journal_type = 'OPENING'
  - For each account: debit if debit-normal with positive balance, credit if credit-normal with positive balance
  - Offset to "Opening Balance Equity" account so transaction balances
  - Validates: total debits = total credits before saving
- [x] Add command to api.ts + MockApi
- [x] Create `OpeningBalancesWizard.tsx`:
  - Shows all accounts with an amount input field
  - User enters current balances for each account
  - "Save Opening Balances" button creates the opening transaction
  - Accessible from Settings or shown on first file open if no transactions exist
- [x] Update balance sheet: show "Opening Balance Equity" in equity section (should eventually be zero after proper setup)

### Tests
- [x] Test: retained earnings account exists in seed data and is system account
- [x] Test: opening balance equity account exists in seed data and is system account
- [x] Test: system accounts cannot be deactivated
- [x] Test: enter_opening_balances creates balanced OPENING transaction
- [x] Test: opening balances reflect correctly in trial balance
- [x] Test: opening balances reflect correctly in balance sheet
- [x] CHECK: Opening balances wizard works, system accounts protected, all tests pass, `npm run check` clean

---

## PHASE 22 — Fiscal Year Close
**Goal:** Close a fiscal year by zeroing revenue/expense into retained earnings.

- [x] Add `close_fiscal_year` Rust command:
  - Takes: fiscal year end date
  - Validates: all periods through that date should be locked (warn if not, but allow)
  - Creates a CLOSING journal entry:
    - Debits each revenue account for its balance (zeroing it)
    - Credits each expense account for its balance (zeroing it)
    - Net difference goes to Retained Earnings (3200)
  - Marks transaction with journal_type = 'CLOSING'
  - Locks the period through the fiscal year end date
  - Returns: closing entry details + net income transferred
- [x] Add `list_fiscal_year_closes` Rust command — returns history of closed years
- [x] Add both commands to api.ts + MockApi
- [x] Create `FiscalYearClose.tsx` (under Accounts in sidebar):
  - Shows current fiscal year dates (from settings)
  - "Close Year" button → confirmation with preview of closing entry amounts
  - History of previously closed years
  - Warning if periods aren't locked through year-end
- [x] Update balance sheet:
  - Equity section shows: Owner's Equity + Retained Earnings (from closing entries) + Current Year Net Income (unclosed)
  - These are three separate line items, not lumped together
- [x] Update income statement: default date range = current fiscal year (not all-time)
- [x] Reports exclude CLOSING entries by default (toggle to include)

### Tests
- [x] Test: close_fiscal_year creates correct closing entry
- [x] Test: closing entry zeroes all revenue accounts for the period
- [x] Test: closing entry zeroes all expense accounts for the period
- [x] Test: net income transfers to retained earnings
- [x] Test: closing entry has journal_type = 'CLOSING'
- [x] Test: period is locked after closing
- [x] Test: cannot close the same fiscal year twice
- [x] Test: balance sheet shows retained earnings separate from current net income
- [x] Test: income statement excludes closing entries by default
- [x] CHECK: Can close a fiscal year, retained earnings updated, balance sheet correct, all tests pass, `npm run check` clean

---

## PHASE 23 — Module Foundation
**Goal:** Add the modules table and convention. Zero-cost prep for future plugin architecture.

- [x] Add `modules` table to schema
- [x] Add `list_modules`, `get_module` Rust commands
- [x] Add commands to api.ts + MockApi
- [x] Document public API surface: create a `docs/api-contract.md` listing all stable commands with parameters and return types
  - Mark each command as: STABLE (module-safe), INTERNAL (may change), or SYSTEM (never call directly)
- [x] Add module convention to CLAUDE.md (already present)
- [x] Test: modules table exists in fresh database
- [x] Test: list_modules returns empty list on fresh database
- [x] CHECK: Modules table exists, convention documented, API contract written, all tests pass, `npm run check` clean

---

## PHASE 24 — Cash Flow Statement
**Goal:** The third major financial statement.

- [x] Add `cash_flow_category TEXT` column to accounts table (nullable, migration)
  - Values: `OPERATING`, `INVESTING`, `FINANCING`
  - Seed: tag default cash/bank accounts as OPERATING
- [x] Add `is_cash_account INTEGER DEFAULT 0` column to accounts table (migration)
  - Seed: tag Cash (1000), Checking (1010), Savings (1020) as cash accounts
- [x] Add `get_cash_flow_statement` Rust command:
  - Indirect method: starts with net income
  - Adjusts for non-cash items (changes in non-cash balance sheet accounts)
  - Sections: Operating, Investing, Financing
  - Beginning and ending cash balance
- [x] Add command to api.ts + MockApi
- [x] Create `CashFlowStatement.tsx`:
  - Date range picker
  - Three sections with subtotals
  - Net change in cash + beginning/ending balances
- [x] Add to Reports section in sidebar
- [x] Test: cash flow statement beginning + net change = ending balance
- [x] Test: cash flow equals actual change in cash accounts
- [x] Test: net income from income statement matches operating section starting point
- [x] CHECK: Cash flow statement renders correctly, balances tie out, all tests pass, `npm run check` clean

---

## PHASE 25 — Account Hierarchy in Reports
**Goal:** Use parent_id to show account hierarchies with subtotals in reports.

- [x] Update `get_accounts` to return hierarchy information (parent chain, depth level)
- [x] Update AccountsListPage: indent child accounts under parents, show subtotals per group
- [x] Update TrialBalance: indent children, subtotal per parent
- [x] Update BalanceSheet: group accounts under parents with subtotals
- [x] Update IncomeStatement: group accounts under parents with subtotals
- [x] Update account creation UI: parent account dropdown
- [x] Test: child account indented under parent in trial balance
- [x] Test: subtotals at parent level equal sum of children
- [x] Test: account with no parent shows at root level
- [x] CHECK: Hierarchy visible in all reports, subtotals correct, all tests pass, `npm run check` clean

---

## PHASE 26 — Excel-Style Transaction Register UX
- [x] Hybrid interaction: inline editing for metadata fields (date, memo, ref), panel expansion for amounts
- [x] Edit mode activated by sidebar button — makes all unlocked rows editable at once
- [x] Multi-entry transactions always collapsed until explicitly clicked, even in edit mode
- [x] Period-locked and reconciled rows greyed out and non-editable at both UI and engine level
- [x] Silent audit logging — no confirmation dialog per edit, changes logged automatically
- [x] Tab key moves between editable cells (left→right, then next row)
- [x] Escape cancels current cell edit, restores previous value
- [x] Unsaved changes indicator (dot or color change) on modified rows
- [x] "Save All Changes" button when in edit mode (batch commit)
- [x] CHECK: Can enter edit mode, modify multiple transactions inline, save all, audit log reflects changes, `npm run check` clean

## PHASE 27 — CSV Import with Column Mapping
- [x] Upload CSV → preview first 10 rows in table
- [x] Column mapping UI: drag/assign CSV columns to fields (date, memo, account, debit, credit)
- [x] Validation pass: show errors per row (missing fields, unparseable dates, unknown accounts)
- [x] "Import" creates transactions for valid rows, skips invalid
- [x] Duplicate detection: date + amount + memo match → flag as potential duplicate
- [x] Import summary: X imported, Y skipped, Z duplicates
- [x] Test: valid CSV imports correctly
- [x] Test: invalid rows rejected with error messages
- [x] Test: duplicate detection flags matches
- [x] CHECK: Can import a bank CSV, map columns, review errors, import clean rows, `npm run check` clean

## PHASE 28 — Recurring Transactions
- [x] Create `recurring_templates` table (inside each .sqlite file): template of line items + recurrence rule
- [x] Add `create_recurring`, `list_recurring`, `update_recurring`, `pause_recurring`, `delete_recurring` Rust commands
- [x] Recurrence rules: weekly, monthly, quarterly, yearly, with start date and optional end date
- [x] On app open: check for due recurring transactions → show prompt "X recurring entries are due. Generate?"
- [x] "Generate" creates actual transactions from templates
- [x] Recurring management page: list all templates, edit, pause, delete
- [x] Add all commands to api.ts + MockApi
- [x] Test: recurring template generates correct transaction on due date
- [x] Test: paused template does not generate
- [x] Test: generated transaction has correct accounts and amounts
- [x] CHECK: Can create recurring template, generate due entries, pause/resume, `npm run check` clean

## PHASE 29 — Accrual vs Cash Basis Reporting
- [x] Add reporting basis toggle to income statement: Accrual (default) / Cash
- [x] Cash basis logic: only include revenue/expense entries where the transaction also has an entry to a cash account
- [x] Add toggle to balance sheet (optional — less common)
- [x] Toggle persisted in settings (default_reporting_basis)
- [x] Test: accrual income statement includes all revenue/expense
- [x] Test: cash basis income statement excludes entries without cash leg
- [x] Test: switching basis changes totals correctly
- [x] CHECK: Both bases render correctly, toggle works, all tests pass, `npm run check` clean

## PHASE 30 — Bank Feed Pipeline (Plaid Integration)
- [ ] Add Plaid API credentials to app-level config (not per-file)
- [ ] Create `pending_bank_transactions` table (inside each .sqlite file)
- [ ] Plaid API → normalize → deduplicate → insert into pending_bank_transactions
- [ ] UI: pending transactions list with "Approve" flow
- [ ] Approve: user selects account → createTransaction() fires → removes from pending
- [ ] Dismiss: marks pending transaction as ignored
- [ ] Auto-match: suggest account based on previous categorizations of same payee
- [ ] Add all commands to api.ts + MockApi
- [ ] Test: Plaid data normalizes to expected schema
- [ ] Test: approval creates valid balanced transaction
- [ ] Test: dismissal marks as ignored without creating transaction
- [ ] CHECK: Can connect bank, pull transactions, approve/dismiss, all balanced, `npm run check` clean

## PHASE 31 — Reconciliation Service
- [ ] Book balance vs statement balance comparison per account per period
- [ ] Match transactions to bank feed items (auto-match + manual match)
- [ ] Reconciliation report: matched, unmatched, adjustments needed
- [ ] Lock period when reconciled (uses period locking)
- [ ] Reconciliation history: past reconciliations with dates and balances
- [ ] Test: reconciliation identifies matched and unmatched items
- [ ] Test: completing reconciliation locks the period
- [ ] Test: locked reconciled period prevents edits
- [ ] CHECK: Can reconcile an account, lock period, view history, `npm run check` clean

---

## CURRENT PHASE: 30
## LAST COMPLETED CHECK: Phase 29 — accrual vs cash basis reporting, 185 tests pass (2026-04-05)
## BLOCKING ISSUES: None

## FUTURE PHASES (not scheduled)
- Phase 32: Packaging & distribution (installer, app icon, auto-update)
- Phase 33: Multi-currency support
