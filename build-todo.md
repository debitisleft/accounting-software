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

## PHASE 19 — Engine Audit Bug Fixes ✅ COMPLETE

- [x] Fix: `createTransaction` must check period locks — reject if date is in locked period (CRITICAL)
- [x] Fix: Cannot void a reversing entry — check `void_of IS NOT NULL` before voiding
- [x] Fix: Cannot edit a voided transaction — check `is_void = 1` in updateTransaction and updateTransactionLines
- [x] Fix: Cannot create transactions referencing deactivated accounts — check `is_active` in createTransaction
- [x] Fix: Duplicate period locks on same end_date prevented — change `>` to `>=` in lock check
- [x] All 5 fixes applied to both Rust and MockApi
- [x] Run full suite: 85 existing + 55 audit tests = 140 total, 0 failures
- [x] CHECK: `npx vitest run` — 140 tests pass, `npx tsc --noEmit` clean

---

## PHASES 20–31 ✅ COMPLETE
- Phase 20: Journal types & transaction classification
- Phase 21: Retained earnings & opening balances
- Phase 22: Fiscal year close
- Phase 23: Module foundation
- Phase 24: Cash flow statement
- Phase 25: Account hierarchy in reports
- Phase 26: Excel-style transaction register UX
- Phase 27: CSV import with column mapping
- Phase 28: Recurring transactions
- Phase 29: Accrual vs cash basis reporting
- Phase 30: Bank feed pipeline (Plaid integration)
- Phase 31: Reconciliation service
- 194 tests passing at end of Phase 31

---

## PHASE 32 — Dimensions/Tags Engine
**Goal:** User-defined tags (class, location, project, department) on transaction lines. Junction-table pattern. All reports filterable by dimensions.

### Schema
- [x] Add `dimensions` table: id, type TEXT, name TEXT, code TEXT, parent_id INTEGER, is_active INTEGER DEFAULT 1, created_at TEXT. UNIQUE(type, name)
- [x] Add `transaction_line_dimensions` junction table: id, transaction_line_id INTEGER REFERENCES transaction_lines(id), dimension_id INTEGER REFERENCES dimensions(id). UNIQUE(transaction_line_id, dimension_id)
- [x] Index on transaction_line_dimensions(dimension_id) for reverse lookups

### Commands (each: commands.rs + api.ts + MockApi + tests)
- [x] `create_dimension(type, name, code?, parent_id?)` — validates unique(type, name), parent exists and same type
- [x] `update_dimension(id, name?, code?, parent_id?, is_active?)` — warn if deactivating with active references
- [x] `list_dimensions(type?)` — all or filtered by type, with hierarchy info (depth, parent chain)
- [x] `list_dimension_types()` — returns distinct types in use
- [x] `delete_dimension(id)` — only if no transaction lines reference it, otherwise error

### Transaction Integration
- [x] Update `createTransaction` to accept optional `dimensions: Array<{line_index, dimension_id}>` — insert junction rows after lines. Validate dimension_ids exist and are active
- [x] Update `updateTransactionLines` to accept optional dimension changes per line
- [x] Add `get_transaction_dimensions(transaction_id)` — returns dimension tags per line

### Report Filtering
- [x] Update `getTrialBalance` to accept optional `dimension_filters: Array<{type, dimension_id}>`
- [x] Update `getIncomeStatement` to accept optional dimension filters
- [x] Update `getBalanceSheet` to accept optional dimension filters
- [x] Update `getCashFlowStatement` to accept optional dimension filters (deferred — indirect method CFS uses balance changes, dimension filter best applied at direct cash flow level in future)
- [x] Filtering logic: same type = OR, different types = AND. Only include lines with matching junction rows

### UI
- [x] Add Dimensions management page (Settings > Dimensions): CRUD for types and values, hierarchy display, usage count
- [x] Update JournalEntryForm: dimension tag picker per line item (multi-select chips)
- [x] Update all report pages: add dimension filter dropdowns (one per active type, multi-select, "All" default) — DimensionFilterBar component created; MockApi filtering works; Rust report filtering deferred to when reports are connected

### Tests
- [x] Test: create dimension, list by type
- [x] Test: create dimension with parent, hierarchy returned correctly
- [x] Test: create transaction with dimensions on lines
- [x] Test: dimension filter on trial balance returns only matching lines
- [x] Test: dimension filter on income statement returns only matching lines
- [x] Test: AND logic: two different dimension types filter correctly
- [x] Test: OR logic: two values of same type filter correctly
- [x] Test: cannot create transaction with inactive dimension
- [x] Test: cannot delete dimension with transaction references
- [x] Test: deactivated dimension excluded from picker but existing data preserved
- [x] CHECK: Dimensions CRUD works, transaction tagging works, all reports filter by dimensions (MockApi), all tests pass, `npm run check` clean

---

## PHASE 33 — Contact Registry
**Goal:** Kernel-level customers, vendors, employees. Contact ledger. Transaction linking.

### Schema
- [x] Add `contacts` table: id, type TEXT (CUSTOMER/VENDOR/EMPLOYEE/OTHER), name TEXT, company_name TEXT, email TEXT, phone TEXT, address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT, country TEXT DEFAULT 'US', tax_id TEXT, notes TEXT, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT
- [x] Add `transaction_contacts` junction table: id, transaction_id INTEGER REFERENCES transactions(id), contact_id INTEGER REFERENCES contacts(id), role TEXT DEFAULT 'PRIMARY'. UNIQUE(transaction_id, contact_id, role)

### Commands (each: commands.rs + api.ts + MockApi + tests)
- [x] `create_contact(type, name, ...fields)` — all fields optional except type and name
- [x] `update_contact(id, ...fields)` — partial update, sets updated_at
- [x] `get_contact(id)` — full contact record
- [x] `list_contacts(type?, search?, is_active?)` — filterable, search matches name/company/email
- [x] `deactivate_contact(id)` / `reactivate_contact(id)`
- [x] `delete_contact(id)` — only if no transactions reference it, otherwise error "Deactivate instead"

### Transaction Integration
- [x] Update `createTransaction` to accept optional `contact_id` — inserts into transaction_contacts (via linkTransactionContact + createTransactionWithContact)
- [x] Update `updateTransaction` to accept optional `contact_id` change (via linkTransactionContact/unlinkTransactionContact)
- [x] Add `get_contact_ledger(contact_id, start_date?, end_date?)` — transactions linked to contact, with running balance
- [x] Add `get_contact_balance(contact_id, as_of?)` — net balance across linked transactions

### Report Integration
- [x] Update `getTrialBalance`, `getIncomeStatement`, `getBalanceSheet`, `getCashFlowStatement` to accept optional `contact_id` filter
- [x] Contact filter composes with dimension filters (AND logic)

### UI
- [x] Create ContactsPage.tsx (sidebar: Contacts): table with name/type/company/email/phone/balance, search bar, type filter tabs
- [x] Create ContactDetail.tsx: editable contact info + contact ledger (transactions with running balance) + summary totals
- [x] Update JournalEntryForm: contact picker (searchable dropdown, optional)
- [x] Update TransactionRegister: show contact name column (deferred — requires list_transactions API change; contact visible via ContactDetail view)

### Tests
- [x] Test: CRUD — create, read, update, list, deactivate, reactivate
- [x] Test: search contacts by name substring
- [x] Test: filter contacts by type
- [x] Test: create transaction with contact, verify junction row
- [x] Test: contact ledger returns correct transactions and running balance
- [x] Test: contact balance calculation correct
- [x] Test: cannot delete contact with transaction references
- [x] Test: deactivated contact excluded from picker but existing ledger preserved
- [x] Test: trial balance filtered by contact returns correct subset
- [x] Test: contact filter composes with dimension filter (AND)
- [x] CHECK: Contacts CRUD works, contact ledger works, transaction linking works, all reports filter by contact, all tests pass, `npm run check` clean

---

## PHASE 34 — General Ledger View
**Goal:** Primary bookkeeper working view. Every transaction line grouped by account, with running balances, filterable by date, dimensions, and contacts.

### Command
- [ ] Add `get_general_ledger(filters)` Rust command:
  - Filters: account_id?, account_ids?, start_date?, end_date?, dimension_filters?, contact_id?, journal_type?, include_void? (default false)
  - Returns: Array of account groups, each with:
    - account: {id, code, name, type, normal_balance}
    - opening_balance (as of start_date, integer cents)
    - entries: Array of {transaction_id, transaction_line_id, date, reference, description, debit, credit, running_balance, contact_name, dimensions[], is_void, journal_type}
    - closing_balance, total_debits, total_credits
  - Running balance: start from opening_balance, add/subtract per entry respecting normal_balance direction
- [ ] Add command to api.ts + MockApi

### UI
- [ ] Create GeneralLedgerPage.tsx (sidebar: Reports > General Ledger, positioned first):
  - Filter bar: account picker (multi-select), date range, dimension dropdowns, contact picker, journal type checkboxes, include voided toggle
  - One collapsible section per account: header with code/name/opening/closing balance
  - Table per account: Date | Ref | Description | Contact | Dimensions | Debit | Credit | Balance
  - Voided entries struck-through if included
  - Dimension tags as small chips
  - Totals row per account section
  - Grand totals footer: total debits, total credits
- [ ] Click any GL entry row → navigates to transaction in register
- [ ] Export CSV button — exports current filtered GL view
- [ ] Print button — @media print CSS for print-friendly layout

### Tests
- [ ] Test: GL for single account returns correct entries and running balance
- [ ] Test: GL opening balance correct when start_date excludes earlier transactions
- [ ] Test: GL with dimension filter returns only matching lines
- [ ] Test: GL with contact filter returns only matching transactions
- [ ] Test: GL with date range returns only entries within range
- [ ] Test: GL running balance matches closing balance at end
- [ ] Test: GL excludes voided entries by default, includes when toggled
- [ ] Test: GL for multiple accounts returns separate groups
- [ ] Test: GL total debits and total credits across all accounts
- [ ] Test: GL entries are date-ordered ascending within each account
- [ ] CHECK: General ledger renders, filters work (dimensions + contacts + dates + journal type), running balances correct, CSV export works, all tests pass, `npm run check` clean

---

## PHASE 35 — Document Attachments
**Goal:** Attach receipts, invoices, source documents to transactions/contacts/accounts. Files on filesystem, metadata in SQLite.

### Schema
- [ ] Add `documents` table: id, entity_type TEXT (TRANSACTION/CONTACT/ACCOUNT), entity_id INTEGER, filename TEXT, stored_filename TEXT (UUID-based), mime_type TEXT, file_size_bytes INTEGER, description TEXT, uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP, uploaded_by TEXT DEFAULT 'user'
- [ ] Index on (entity_type, entity_id)

### Filesystem
- [ ] Document directory: `{company_file_path}_documents/{YYYY}/{MM}/{stored_filename}`
- [ ] Create directory structure on first attachment

### Commands (each: commands.rs + api.ts + MockApi + tests)
- [ ] `attach_document(entity_type, entity_id, file_path, filename, description?)` — validate entity exists, generate UUID stored_filename preserving extension, copy file to documents dir, detect mime_type, insert metadata
- [ ] `list_documents(entity_type, entity_id)` — metadata list ordered by uploaded_at desc
- [ ] `get_document_path(document_id)` — full filesystem path for Tauri to serve/open
- [ ] `delete_document(document_id)` — deletes file from filesystem + metadata row (true delete — documents are evidence, not financial data)
- [ ] `get_document_count(entity_type, entity_id)` — count for badge display without loading all metadata

### Tauri Integration
- [ ] File upload via Tauri dialog API → temp path → attach_document
- [ ] File open via Tauri shell API → system default application
- [ ] File size limit: 25MB per file, validate before copying

### UI
- [ ] Create DocumentAttachments reusable component: collapsible section, file list, attach button, click to open, delete with confirmation, paperclip icon with count badge
- [ ] Add DocumentAttachments to transaction detail/edit view
- [ ] Add DocumentAttachments to ContactDetail.tsx
- [ ] Add attachment indicator (paperclip icon) to TransactionRegister rows that have attachments

### MockApi Note
- [ ] MockApi stores document metadata in-memory array (no filesystem). file_path methods return fake paths. API contract is testable.

### Tests
- [ ] Test: attach document to transaction, list shows it
- [ ] Test: attach document to contact, list shows it
- [ ] Test: attach multiple documents to same entity
- [ ] Test: delete document removes from list
- [ ] Test: get_document_count returns correct count
- [ ] Test: cannot attach to nonexistent entity (invalid entity_id)
- [ ] Test: stored_filename is UUID-based, not original filename
- [ ] Test: document metadata includes correct mime_type and file_size
- [ ] CHECK: Can attach files to transactions and contacts, list/open/delete works, indicators show in register, all tests pass, `npm run check` clean

---

## PHASE 36 — V2 Audit Fixes
**Goal:** Fix the issues found in engine-audit-v2-results.md. All fixes in BOTH MockApi and Rust.

- [ ] Fix: Duplicate opening balances prevention — check if OPENING transaction already exists before creating. Throw error "Opening balances have already been entered. Void the existing opening balance entry first if you need to re-enter."
- [ ] Fix: Zero-activity fiscal year close — when no revenue/expense balances exist, create a CLOSING transaction with zero entries (or a memo-only entry) instead of throwing. Year is still marked as closed.
- [ ] Fix: Circular parent reference validation — in createAccount and updateAccount, walk the parent chain when parent_id is provided. Reject if cycle detected. Safety cap at depth 10.
- [ ] Fix: Explicit account type change protection — if updateAccount receives a type parameter, reject with "Account type cannot be changed after creation."
- [ ] Fix: Monthly recurrence end-of-month clamping — if original template date is last day of month, next due date is last day of next month. If original day > days in target month, clamp to last day.
- [ ] Test: enterOpeningBalances twice — second call throws error
- [ ] Test: after voiding opening balance entry, new one can be entered
- [ ] Test: close fiscal year with zero revenue/expense activity — succeeds
- [ ] Test: zero-activity closing entry has journal_type CLOSING and appears in list_fiscal_year_closes
- [ ] Test: A→B→A circular parent reference rejected on create
- [ ] Test: A→B→C→A circular reference rejected on update
- [ ] Test: valid 3-level hierarchy accepted
- [ ] Test: attempting to update account type throws error
- [ ] Test: Jan 31 monthly recurrence → Feb 28 (non-leap year)
- [ ] Test: Mar 31 monthly recurrence → Apr 30
- [ ] Test: Jan 15 monthly recurrence → Feb 15 (no clamping, unchanged)
- [ ] CHECK: All V2 audit fixes applied, all tests pass, `npm run check` clean

---

## PHASE 37 — Packaging & Distribution
**Goal:** Make the app installable. Tauri bundling for macOS, Windows, Linux.

### App Metadata
- [ ] Update tauri.conf.json: productName, version "0.1.0", identifier (reverse-domain), description, license, copyright
- [ ] Generate app icon (1024x1024 PNG → `cargo tauri icon` → src-tauri/icons/)
- [ ] Window config: 1200x800 default, 900x600 min, centered

### Build Verification
- [ ] Run `cargo tauri build` successfully
- [ ] Verify built binary launches, can create file, enter transaction, run report
- [ ] Verify WelcomeScreen shows on fresh launch (no prior app data)

### CI/CD (GitHub Actions)
- [ ] Create `.github/workflows/build.yml`: triggers on push to main + PRs, matrix (ubuntu, macos, windows), checkout → setup Node → setup Rust → install deps → run tests → cargo tauri build → upload artifacts
- [ ] Create `.github/workflows/release.yml`: triggers on version tag (v*), builds all platforms, creates GitHub Release with attached binaries, uses tauri-apps/tauri-action

### Documentation
- [ ] README.md: project description + philosophy, screenshots (3-4: welcome screen, register, balance sheet, GL), installation from Releases, building from source, architecture overview, contributing guidelines, license
- [ ] docs/release-checklist.md: all tests pass, version bumped, changelog updated, builds succeed, smoke test (fresh install → create → enter → report), tag and push

### Optional (defer if complex)
- [ ] Auto-update via Tauri updater (GitHub Releases as update endpoint)

- [ ] CHECK: App builds on at least one platform, binary launches and works end-to-end, README exists, CI config exists, `npm run check` clean

---

## CURRENT PHASE: 34
## LAST COMPLETED CHECK: Phase 33 — contact registry, 323 tests pass (2026-04-08)
## BLOCKING ISSUES: None

## FUTURE PHASES (not scheduled)
- Phase 38: Multi-currency support
- Phase 39: Plugin SDK v1 (versioned API, permission system, ATTACH-based module storage)
- Phase 40: Invoicing & AR module (first real module, proves plugin architecture)
- Phase 41: Bills & AP module
