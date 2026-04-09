# Bookkeeping App — Build TODO

## RULES FOR CLAUDE CODE
- Complete and CHECK each phase before starting the next
- Run tests after every phase — do not proceed if tests fail
- All amounts stored as INTEGER CENTS — never floats
- Update the status of each task as you complete it: [ ] → [x]
- If a check fails, fix it before marking complete
- Every new Rust command needs: commands.rs function, api.ts wrapper, MockApi method, and at least one test

---

## PHASES 1–31 ✅ COMPLETE
- Phases 1–8: Scaffold, schema, engine, tests, UI, reports, integration, Tauri migration
- Phases 9–18: App shell, account CRUD, transaction register, editing/voiding, backup, CSV export, settings, period management, report enhancements, file-based .sqlite architecture
- Phase 19: Engine audit bug fixes (5 bugs fixed, 140 tests)
- Phases 20–31: Journal types, retained earnings, fiscal year close, module foundation, cash flow, account hierarchy, Excel-style register, CSV import, recurring transactions, accrual/cash basis, bank feeds, reconciliation
- 194 tests passing at end of Phase 31

---

## PHASES 32–37 ✅ COMPLETE
- Phase 32: Dimensions/tags engine (+17 tests)
- Phase 33: Contact registry (+10 tests)
- Phase 34: General ledger view (+10 tests)
- Phase 35: Document attachments (+8 tests)
- Phase 36: V2 audit fixes (+11 tests)
- Phase 37: Packaging & distribution (app icon, Windows .msi/.exe builds, build fixes)
- 352 tests passing at end of Phase 37

---

## PHASE 38 — Storage Sandbox & Directory Structure (Fix #2, #10) ✅ COMPLETE
**Goal:** Transition from single .sqlite files to company directories. Module storage via SQLite ATTACH. Document directory migration.

### Directory-Based Company Files
- [x] Update `create_book_file` — creates directory with company.sqlite + modules/ + documents/ + backups/ subdirectories
- [x] Update `open_book_file` — detects file vs directory, opens company.sqlite from within directory
- [x] Auto-migration: opening a legacy single .sqlite creates directory structure and moves file into it
- [x] Update recent-files.json to point to directory paths after migration
- [x] Store company directory path in Rust state (not just connection)
- [x] Update `close_book_file` — WAL checkpoint, DETACH all module DBs, clear state

### Module Storage via ATTACH
- [x] `attach_module_db(module_id)` — creates modules/{module_id}.sqlite if needed, ATTACHes as module_{module_id}
- [x] `detach_module_db(module_id)` — DETACHes module database
- [x] `list_attached_modules()` — returns currently attached module IDs
- [x] `module_create_table(module_id, table_name, columns_sql)` — creates table in module's attached DB, validates input
- [x] `module_insert(module_id, table_name, row_json)` — inserts row, returns ID
- [x] `module_query(module_id, table_name, filters_json?)` — structured query (no raw SQL), filter ops: =, !=, <, >, <=, >=, LIKE
- [x] `module_update(module_id, table_name, id, fields_json)` — updates row by ID
- [x] `module_delete(module_id, table_name, id)` — deletes row by ID
- [x] `module_execute_migration(module_id, version, sql)` — DDL against module DB, records in module's _migrations table
- [x] Security: every module storage command validates module_id is attached, sanitizes identifiers, no cross-module access

### Document & Backup Migration
- [x] Update document attachment system to use {company_dir}/documents/ path
- [x] Migrate existing {file}_documents/ to {company_dir}/documents/ on open (handled in resolve_company_paths)
- [x] Update backup system — writes to {company_dir}/backups/. Note: full directory zip deferred (requires `zip` crate dep); current backup is single-file VACUUM INTO of company.sqlite.

### All commands → api.ts + MockApi
- [x] MockApi simulates ATTACH with separate in-memory objects per module_id

### Tests
- [x] 18 new tests added in src/__tests__/module-storage.test.ts
- [x] CHECK: Directory-based files work, module ATTACH/DETACH works, module CRUD works, 370 tests pass (1 skipped), `npm run check` clean

---

## PHASE 39 — Migration Coordinator (Fix #7) ✅ COMPLETE
**Goal:** Per-module versioned migrations with dependency enforcement and failure handling.

### Schema
- [x] Added `migration_log` table (id, module_id, version, description, checksum, applied_at, success, error_message), UNIQUE(module_id, version)
- [x] Added `module_dependencies` table (id, module_id, depends_on_module_id, min_version), UNIQUE
- [x] Added `module_pending_migrations` table to stage registered-but-unapplied migrations

### Commands
- [x] `register_module_migrations(module_id, migrations[])` — stages migrations, rejects checksum mismatch on already-applied versions
- [x] `run_module_migrations(module_id)` — dep check + topo sort + per-version SAVEPOINT, stops on first failure, records success/failure rows
- [x] `get_migration_status(module_id?)` — applied/pending/failed counts + last error
- [x] `register_module_dependency(module_id, depends_on, min_version?)` — rejects self-deps and immediate cycles (rolls back insert)
- [x] `check_dependency_graph()` — DFS topological sort, throws on cycles

### Integration
- [x] init_db retroactively records 8 kernel migrations as module_id='kernel' (idempotent INSERT OR IGNORE)
- [ ] Module-aware startup flow (ATTACH active modules → run pending migrations → disable on failure) — deferred to Phase 40 along with module_registry

### All commands → api.ts + MockApi
- [x] All 5 wrappers + MockApi parity with simulated SAVEPOINT failure via 'FAIL_MIGRATION' marker in SQL

### Tests
- [x] 13 new tests in migration-coordinator.test.ts covering register+run, checksum tampering, version ordering, partial-failure halting, dep enforcement, circular dep rejection, kernel retroactive recording, status counts, idempotent re-runs, cross-module isolation, self-dep rejection
- [x] CHECK: 383 tests pass (1 skipped); typecheck clean; cargo check clean

---

## PHASE 40 — SDK v1 Core & Module Lifecycle (Fix #1, #6)
**Goal:** Module manifest, versioned SDK contract, module registry, install/uninstall lifecycle, service registry.

### Module Manifest (module.json)
- [ ] Define schema: id, name, version, sdk_version, description, author, license, permissions[], dependencies[], entry_point, migrations[]

### Schema
- [ ] Replace/update `modules` table → `module_registry`: id TEXT PK, name, version, sdk_version, description, author, license, permissions (JSON), dependencies (JSON), entry_point, install_path, status (active/disabled/failed/uninstalling), installed_at, updated_at, error_message

### SDK v1 (sdk_v1.rs)
- [ ] Create src-tauri/src/sdk_v1.rs — versioned SDK adapter
- [ ] Ledger API: sdk_create_transaction, sdk_void_transaction, sdk_get_account_balance, sdk_get_trial_balance, sdk_get_journal_entries
- [ ] Account API: sdk_create_account, sdk_update_account, sdk_deactivate_account, sdk_get_chart_of_accounts
- [ ] Contact API: sdk_create_contact, sdk_get_contact, sdk_list_contacts, sdk_get_contact_ledger
- [ ] Document API: sdk_attach_document, sdk_get_documents, sdk_delete_document
- [ ] Report API: sdk_get_income_statement, sdk_get_balance_sheet, sdk_get_cash_flow
- [ ] Storage API: sdk_storage_create_table, sdk_storage_insert, sdk_storage_query, sdk_storage_update, sdk_storage_delete
- [ ] Every method takes module_id as first param (permission checks added in Phase 41)
- [ ] `get_sdk_version()` — returns "1"

### Service Registry (Fix #6)
- [ ] `sdk_register_service(module_id, service_name, handler_info)` — in-memory registry
- [ ] `sdk_call_service(caller_module_id, target_module_id, service_name, params)` — brokered by kernel
- [ ] `sdk_list_services()` — all registered services

### Module Lifecycle
- [ ] `install_module(manifest_json, install_path)` — validate → register → ATTACH → migrate → activate
- [ ] `uninstall_module(module_id, keep_data?)` — DETACH → optionally delete .sqlite → remove from registry
- [ ] `enable_module(module_id)` / `disable_module(module_id)` — toggle status, ATTACH/DETACH
- [ ] `get_module_info(module_id)` / `list_installed_modules()`

### Startup Flow
- [ ] Update company open: load registry → ATTACH active modules → run pending migrations → init each → report failures

### All commands → api.ts + MockApi

### Tests
- [ ] Test: install_module with valid manifest succeeds
- [ ] Test: incompatible sdk_version rejected
- [ ] Test: duplicate module ID rejected
- [ ] Test: uninstall removes from registry
- [ ] Test: uninstall with keep_data preserves .sqlite
- [ ] Test: disable/enable toggles status
- [ ] Test: SDK v1 ledger methods call through to engine
- [ ] Test: SDK v1 storage methods call through to module storage
- [ ] Test: service registry round-trip (register + call)
- [ ] Test: call to unregistered service returns error
- [ ] Test: list_installed_modules returns correct statuses
- [ ] Test: get_sdk_version returns "1"
- [ ] CHECK: Module lifecycle works, SDK v1 wraps engine, service registry works, all tests pass, `npm run check` clean

---

## PHASE 41 — Permission Enforcer (Fix #4)
**Goal:** Granular permission checks on every SDK call. Consent UI on install.

### Permission Taxonomy
- [ ] Define all scopes: ledger:read, ledger:read_balances, ledger:write, ledger:write_reversals, accounts:read, accounts:write, contacts:read, contacts:write, reports:read, reports:create_custom, documents:read, documents:write, events:subscribe, hooks:before_write, storage:own, services:register, services:call, ui:nav_item, ui:settings_pane, ui:transaction_action, ui:column_provider

### Schema
- [ ] Add `module_permissions` table: id, module_id REFERENCES module_registry(id), scope TEXT, granted_at. UNIQUE(module_id, scope)

### Enforcement
- [ ] Create src-tauri/src/permissions.rs: check_permission(module_id, scope) → Ok or Err
- [ ] Add permission check to EVERY sdk_v1.rs method (mapping each method to its required scope)
- [ ] Update install_module: insert permissions from manifest into module_permissions
- [ ] Update uninstall_module: delete all permissions for module

### Permission Management
- [ ] `grant_module_permission(module_id, scope)` — admin manual grant
- [ ] `revoke_module_permission(module_id, scope)` — revoke, module starts getting errors
- [ ] `get_module_permissions(module_id)` — list granted scopes

### Consent UI
- [ ] On install: show permission list before proceeding. "This module wants to:" with human-readable descriptions. Allow / Deny.

### All commands → api.ts + MockApi

### Tests
- [ ] Test: SDK method with correct permission succeeds
- [ ] Test: SDK method without permission throws error
- [ ] Test: install grants all manifest permissions
- [ ] Test: uninstall removes all permissions
- [ ] Test: grant adds permission, SDK call now succeeds
- [ ] Test: revoke removes permission, SDK call now fails
- [ ] Test: storage:own only allows own module's tables
- [ ] Test: ledger:read without ledger:write can read but not create
- [ ] Test: module with no permissions can't do anything
- [ ] Test: get_module_permissions returns correct scopes
- [ ] CHECK: Every SDK method checks permissions, consent UI works, all tests pass, `npm run check` clean

---

## PHASE 42 — Hooks and Events (Fix #3)
**Goal:** Sync hooks inside DB transactions (can reject). Async events after commit (fire-and-forget).

### Sync Hook Bus
- [ ] Create src-tauri/src/hooks.rs: in-memory registry, register/unregister, run_hooks with priority ordering
- [ ] Hook types: before_transaction_create, after_transaction_create, before_transaction_void, after_transaction_void, before_account_update, after_account_update
- [ ] Hook response: {allow: true} or {allow: false, reason: "..."} — rejection aborts entire operation
- [ ] Integrate into createTransaction, voidTransaction, updateAccount

### Async Event Bus
- [ ] Create src-tauri/src/events.rs: in-memory subscriber registry, subscribe/unsubscribe, emit
- [ ] Event types: transaction.created, transaction.voided, transaction.updated, account.created, account.updated, account.deactivated, contact.created, contact.updated, period.locked, period.unlocked, module.installed, module.uninstalled, reconciliation.completed, fiscal_year.closed
- [ ] Events fire AFTER commit, errors logged not propagated
- [ ] Integrate emit calls into all relevant engine commands

### SDK Methods
- [ ] sdk_register_hook, sdk_unregister_hook (requires hooks:before_write)
- [ ] sdk_subscribe_event, sdk_unsubscribe_event (requires events:subscribe)
- [ ] sdk_emit_event — modules can emit custom events

### All commands → api.ts + MockApi

### Tests
- [ ] Test: hook receives context with transaction data
- [ ] Test: before_transaction_create rejection prevents transaction creation
- [ ] Test: after_transaction_create rejection rolls back transaction
- [ ] Test: multiple hooks run in priority order
- [ ] Test: hook without permission rejected
- [ ] Test: event fires with correct payload after transaction created
- [ ] Test: event subscriber error doesn't prevent other subscribers
- [ ] Test: event subscriber error doesn't roll back transaction
- [ ] Test: unsubscribe stops events
- [ ] Test: module can emit custom events
- [ ] Test: transaction.voided event fires after void
- [ ] Test: period.locked event fires after lock
- [ ] CHECK: Hooks validate/reject inside transactions, events fire after commit, permissions enforced, all tests pass, `npm run check` clean

---

## PHASE 43 — UI Isolation & Module Frame (Fix #5)
**Goal:** Sandboxed iframe for module UI. postMessage bridge. UI Extension API for nav items, settings, transaction actions.

### ModuleFrame Component
- [ ] Create ModuleFrame.tsx: renders iframe with sandbox="allow-scripts" (NO allow-same-origin)
- [ ] postMessage handler: validates module_id, checks permissions, executes SDK call, returns result
- [ ] Error handling: failed calls return error to iframe, crashed iframe shows error boundary
- [ ] 30-second timeout on SDK calls from iframe

### Module-Side SDK Bridge
- [ ] Create src/module-sdk/sdk.js: clean API surface (sdk.ledger.*, sdk.accounts.*, sdk.storage.*, etc.)
- [ ] Internal call() function: postMessage to parent, returns Promise, timeout handling
- [ ] Create src/module-sdk/theme.css: CSS variables for design tokens

### UI Extension Registry
- [ ] Create src/lib/ui-extensions.ts: in-memory registry
- [ ] registerNavItem(module_id, label, icon) / getNavItems()
- [ ] registerSettingsPane(module_id, label) / getSettingsPanes()
- [ ] registerTransactionAction(module_id, label) / getTransactionActions()
- [ ] SDK methods: sdk_register_nav_item, sdk_register_settings_pane, sdk_register_transaction_action

### AppShell Integration
- [ ] Sidebar: render module nav items after hardcoded items, separated by "Modules" divider
- [ ] Settings: render module settings panes
- [ ] TransactionRegister: include module transaction actions
- [ ] Module page routes: /module/{module_id} → ModuleFrame

### First-Party Exception
- [ ] trusted: true flag in module_registry — trusted modules render React directly (no iframe)

### Module File Serving
- [ ] get_module_file(module_id, file_path) command OR custom protocol handler (module://)

### All commands → api.ts + MockApi

### Tests
- [ ] Test: ModuleFrame renders iframe with correct sandbox
- [ ] Test: SDK call from iframe → postMessage → kernel → response
- [ ] Test: SDK call without permission returns error
- [ ] Test: invalid module_id rejected
- [ ] Test: registerNavItem adds to sidebar
- [ ] Test: registerSettingsPane adds to settings
- [ ] Test: registerTransactionAction adds to register
- [ ] Test: module page route renders ModuleFrame
- [ ] Test: SDK bridge timeout after 30 seconds
- [ ] Test: trusted module renders without iframe
- [ ] CHECK: Module UI in sandboxed iframes, postMessage bridge works, UI extensions in sidebar, all tests pass, `npm run check` clean

---

## PHASE 44 — Health Monitor & Error Boundaries (Fix #8)
**Goal:** Error counting, auto-disable, graceful degradation. App ALWAYS boots.

### Schema
- [ ] Add `module_health_log` table: id, module_id, event_type (error/recovery/auto_disable/manual_disable/manual_enable), message, error_count, timestamp

### Health Monitor
- [ ] Create src-tauri/src/health.rs: per-module in-memory state (status, error_count, window_start)
- [ ] record_error(module_id, message) — increment count, auto-disable at threshold (10 errors / 5 min)
- [ ] record_success(module_id) — reset degraded state
- [ ] get_health_status(module_id) / get_all_health_statuses()
- [ ] get_health_history(module_id, limit?)

### Integration
- [ ] Wrap every SDK call: on success → record_success, on error → record_error
- [ ] Wrap hook/event handlers: errors → record_error
- [ ] Auto-disable: DETACH DB, unregister hooks/events/UI, set status FAILED
- [ ] Module init wrapped in try/catch: failure → FAILED status, app continues

### UI
- [ ] ModuleErrorBoundary.tsx: wraps ModuleFrame, shows fallback on crash, Retry/Disable buttons
- [ ] Sidebar health indicators: green/yellow/red/grey dots next to module nav items
- [ ] Global notification on auto-disable
- [ ] ModuleHealthPage.tsx (Settings > Module Health): status table, health log, Enable/Disable/Retry/Uninstall actions

### Settings
- [ ] module_error_threshold (default 10), module_error_window_minutes (default 5) — configurable

### All commands → api.ts + MockApi

### Tests
- [ ] Test: record_error increments count
- [ ] Test: 11 errors in 5 minutes triggers auto-disable
- [ ] Test: errors in different windows don't accumulate
- [ ] Test: auto-disabled module's hooks unregistered
- [ ] Test: auto-disabled module's events unsubscribed
- [ ] Test: auto-disabled module's UI extensions hidden
- [ ] Test: record_success resets degraded state
- [ ] Test: module init failure → FAILED, app continues
- [ ] Test: get_health_history returns correct entries
- [ ] Test: manual disable/enable works
- [ ] CHECK: Health monitor tracks errors, auto-disables at threshold, app always boots, all tests pass, `npm run check` clean

---

## PHASE 45 — Distribution & Install Flow (Fix #9)
**Goal:** .zip package format, 10-step install flow, validation, optional signature verification, module manager UI.

### Package Format
- [ ] Define .zip structure: module.json (required), module.sig (optional), frontend/ (index.html + JS/CSS), migrations/ (SQL files)

### Install Flow (10 steps)
- [ ] `install_module_from_zip(zip_path)`: Extract → Validate → Verify sig → Compat check → Conflict check → Consent (handled by UI) → Copy to modules/{id}/ → Register → Migrate → Init
- [ ] Each step can fail with clear error. Cleanup on failure after Copy step.
- [ ] `validate_module_package(zip_path)` — steps 1-5 without installing (preview)
- [ ] `export_module_package(module_id, output_path)` — re-package installed module
- [ ] `check_module_updates(module_id, new_zip_path)` — version comparison
- [ ] `update_module(module_id, zip_path)` — validate → run new migrations → replace frontend → update registry (preserves data)

### Signature Verification
- [ ] Ed25519 support: if module.sig exists, verify against trusted-keys.json
- [ ] Verification failure → abort. Missing sig → warn "unsigned module"
- [ ] `add_trusted_key(author_id, public_key)`

### Module Manager UI
- [ ] ModuleManagerPage.tsx (Settings > Modules): installed modules list, status, health
- [ ] "Install from File" → file picker → validation → signature check → consent → progress → result
- [ ] Per-module: Disable, Enable, Uninstall (with keep_data option), Update, Export

### All commands → api.ts + MockApi

### Tests
- [ ] Test: install from valid .zip succeeds through all 10 steps
- [ ] Test: invalid manifest fails at validation
- [ ] Test: incompatible sdk_version fails at compat
- [ ] Test: duplicate ID fails at conflict check
- [ ] Test: install creates correct directory structure
- [ ] Test: install runs migrations
- [ ] Test: uninstall removes registry, optionally deletes files
- [ ] Test: keep_data preserves .sqlite on uninstall
- [ ] Test: update upgrades version, runs new migrations, preserves data
- [ ] Test: validate_module_package returns report without installing
- [ ] Test: export creates valid zip
- [ ] Test: unsigned module shows warning
- [ ] Test: failed install at migration step cleans up
- [ ] CHECK: Full install flow works, module manager UI works, all tests pass, `npm run check` clean

---

## PHASE 46 — Invoicing & AR Module (First Real Module)
**Goal:** First module built entirely on the plugin SDK. Proves every layer works. Uses ONLY SDK methods — no backdoors.

### Module Manifest
- [ ] Create module.json for com.bookkeeping.invoicing with all required permissions

### Module Storage (via SDK Storage API)
- [ ] Migration 001_init.sql: invoices table (id, invoice_number, customer_contact_id, status, dates, amounts, transaction_id, payment_transaction_ids)
- [ ] Migration 001_init.sql: invoice_lines table (id, invoice_id, description, quantity, unit_price, amount, account_id, sort_order)
- [ ] Migration 001_init.sql: invoice_settings table (key/value: next_number, default_terms, default_ar_account, company info)

### Module Frontend (iframe)
- [ ] Create src/modules/invoicing/frontend/: index.html, bundle.js, style.css
- [ ] Invoice List page: status badges, sort/filter
- [ ] Create Invoice form: customer picker (sdk.contacts.list), line items, terms, dates
- [ ] Invoice Detail: view, status history, payments, documents
- [ ] Record Payment: partial/full, creates ledger transaction via SDK
- [ ] Invoice Settings: default terms, AR account, company info

### Accounting Integration (via SDK only)
- [ ] Finalize invoice (→ sent): sdk.ledger.createTransaction — debit AR, credit revenue per line
- [ ] Record payment: sdk.ledger.createTransaction — debit cash, credit AR
- [ ] Full payment → status 'paid', partial → status 'partial'
- [ ] Void invoice: sdk.ledger.voidTransaction on invoice's transaction_id

### Hooks and Events
- [ ] Hook: before_transaction_void — warn if transaction has linked invoice
- [ ] Event: contact.updated — refresh invoice display
- [ ] Event: period.locked — prevent edits to invoices in locked periods

### UI Extensions (via SDK)
- [ ] registerNavItem: "Invoices" with receipt icon
- [ ] registerSettingsPane: "Invoicing Settings"
- [ ] registerTransactionAction: "Create Invoice from Transaction"

### AR Aging Report
- [ ] Current, 1-30, 31-60, 61-90, 90+ day buckets
- [ ] Per customer and totals
- [ ] Uses sdk.storage.query + sdk.contacts.list

### Default Setup
- [ ] On install: check for AR account (1100), set as default or create via SDK
- [ ] Auto-install on new company creation (user can uninstall)

### Package
- [ ] Package as invoicing-1.0.0.zip following Phase 45 format

### Tests (all through SDK — no direct DB access)
- [ ] Test: install invoicing module via install_module_from_zip
- [ ] Test: migrations create tables in module storage
- [ ] Test: create invoice stored via storage API
- [ ] Test: finalize invoice creates AR transaction via SDK
- [ ] Test: AR transaction debits AR, credits revenue
- [ ] Test: payment creates transaction via SDK
- [ ] Test: full payment → status 'paid'
- [ ] Test: partial payment → status 'partial'
- [ ] Test: void invoice → voids ledger transaction
- [ ] Test: AR aging report calculates buckets correctly
- [ ] Test: module cannot access kernel tables directly
- [ ] Test: module uses only SDK (no direct SQL on company.sqlite)
- [ ] Test: invoice_number auto-increments
- [ ] Test: multi-line invoice totals correctly
- [ ] Test: "Invoices" appears in sidebar
- [ ] CHECK: Invoicing installs via .zip, posts to ledger via SDK, records payments, renders in iframe, all tests pass, `npm run check` clean

---

## CURRENT PHASE: 40
## LAST COMPLETED CHECK: Phase 39 — migration coordinator, 383 tests pass (2026-04-09)
## BLOCKING ISSUES: None

## FUTURE PHASES (not scheduled)
- Phase 47: Bills & AP module (second module, proves multi-module)
- Phase 48: Multi-currency support (kernel currency engine)
- Phase 49: Budget engine (kernel capability)
- Phase 50: GitHub registry (Tier 2 distribution — static registry.json)
