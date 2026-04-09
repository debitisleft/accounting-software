# Bookkeeping App — Changelog

## STATUS: Phase 44 Complete — Health Monitor & Error Boundaries

## CURRENT STATE (2026-04-09)
- 44 phases complete, 462 tests passing (1 skipped)
- Plugin architecture: directory format + ATTACH + migration coordinator +
  module_registry + frozen SDK v1 + service registry + permissions enforcer
  + sync hooks + async events + sandboxed iframe UI + UI extensions +
  per-module health monitor with auto-disable

## COMPLETED

### Phase 44 — Health Monitor & Error Boundaries (2026-04-09)
Per-module error counters with a sliding time window. When a module exceeds
the configured error threshold within the window, it's auto-disabled: detached,
hooks/events/UI/services stripped, registry status set to FAILED. The app
ALWAYS boots — module failures never take down core bookkeeping. Fix #8.

**Schema:** new `module_health_log` table — id, module_id, event_type
('error' | 'recovery' | 'auto_disable' | 'manual_disable' | 'manual_enable' |
'init_failed'), message, error_count, timestamp. Two new default settings
seeded on file create: `module_error_threshold` (10) and
`module_error_window_minutes` (5). Recorded as kernel migration v12.

**Health states:**
- HEALTHY — all calls succeeding
- DEGRADED — at least one error in the current window, below threshold
- FAILED — auto-disabled or init-failed
- DISABLED — user-disabled

**src-tauri/src/health.rs (NEW):** in-memory `HealthMonitor` on DbState
keyed by module_id. Each entry tracks status, error_count, last_error,
last_success_at, window_start.
- `record_error(db, module_id, message)` — increments count in current
  window, resets if window expired (now - window_start >= window_secs),
  marks DEGRADED. If new count > threshold, marks FAILED, writes
  auto_disable log entry, calls `tear_down_module()`.
- `record_success(db, module_id)` — updates last_success_at; if status was
  DEGRADED, resets to HEALTHY. Never unfails a FAILED module — re-enable
  requires explicit `enable_module`.
- `tear_down_module()` — DETACHes the .sqlite (with sanitized alias),
  unregisters services + hooks + events + UI extensions, UPDATEs
  module_registry status='failed' with error_message.
- `record_init_failure(db, module_id, error)` — install/lifecycle path for
  modules that throw during init. Marks FAILED without calling tear_down
  (nothing was registered yet).
- 3 query commands: `get_health_status(module_id)`,
  `get_all_health_statuses()`, `get_health_history(module_id, limit?)`.

Threshold + window are read live from settings on every `record_error` so
the user can change them without restarting. Defaults are baked in
(10 errors / 5 minutes) for the early-startup case.

**MockApi parity:** full state machine. `recordError` / `recordSuccess` /
`recordInitFailure`, plus the 3 query commands. `tearDownModule()` mirrors
the Rust implementation. The mock exposes a `healthClock: () => number`
override so window-expiry tests can advance time without sleeping.
Threshold + window read from `this.settings` so the same configurability
test pattern works in both runtimes.

**api.ts wrappers:** `getHealthStatus`, `getAllHealthStatuses`,
`getHealthHistory`. New `ModuleHealth` and `HealthLogEntry` interfaces.

- 15 new tests in health-monitor.test.ts: error increments + DEGRADED,
  11-error auto-disable to FAILED, errors in different windows don't
  accumulate, auto-disabled module's hooks unregistered, events unsubscribed,
  UI extensions hidden, kernel detach, registry status updated, recordSuccess
  resets DEGRADED but not FAILED, init failure path, history newest-first,
  all-statuses listing, manual disable + enable, configurable threshold
- 462 tests passing (1 skipped); cargo check + npm run check clean

**Deferred:** Wiring `record_error` / `record_success` into the actual
Rust SDK call sites (every sdk_v1 method's try/catch wrapper) and the
ModuleErrorBoundary React component + ModuleHealthPage admin UI.
The kernel-side state machine is fully in place; the integration into
the SDK call path will land when Phase 46 builds the first real module
that exercises it end to end.



### Phase 43 — UI Isolation & Module Frame (2026-04-09)
Sandboxed iframe for module UI with zero DOM access to the host. Communication
exclusively via postMessage. UI Extension API for nav items, settings panes,
and transaction actions. Trusted flag for first-party React-direct rendering.

**Schema:** `module_registry` gained a `trusted INTEGER NOT NULL DEFAULT 0`
column. Idempotent ALTER TABLE in run_migrations for files created under
Phase 40. Recorded as kernel migration v11.

**src-tauri/src/ui_extensions.rs (NEW):** in-memory registry on DbState
(`UiExtensionRegistry` with three Mutex<HashMap<module_id, Vec<…>>> maps for
nav items, settings panes, transaction actions). Modules re-register on init.
- 6 commands with permission enforcement: sdk_register_nav_item
  (ui:nav_item), sdk_register_settings_pane (ui:settings_pane),
  sdk_register_transaction_action (ui:transaction_action), get_nav_items,
  get_settings_panes, get_transaction_actions
- get_module_file(module_id, file_path) — reads from the module's install_path
  with path-traversal rejection (`..`, `/`, `\`), MIME type detection by
  extension, and hex-encoding for binary content (avoids adding base64 dep)
- unregister_all_for_module() cleanup helper called from disable + uninstall

**src/components/ModuleFrame.tsx (NEW):** React component that renders the
module iframe with `sandbox="allow-scripts"` (NO `allow-same-origin` — zero
DOM access to host). Bootstrap HTML injects `window.__MODULE_ID__` so the
iframe knows its identity, then loads the module's frontend. Listens for
postMessage events from the iframe and routes through the bridge dispatcher.
Trusted modules render a React slot directly without the iframe. Error
boundary shows fallback + Retry on crash.

**src/lib/sdk-bridge.ts (NEW):** pure-function bridge dispatcher extracted
from ModuleFrame so it's testable without a DOM:
- `validateSdkCall(msg, expectedModuleId)` — rejects malformed messages,
  module_id mismatch (anti-spoof), and methods not on a static allow-list of
  ~36 SDK v1 surface methods. Host-only commands like `create_new_file` are
  never callable from a module no matter what permissions are granted.
- `dispatchSdkCall(call)` — forwards to Tauri invoke with module_id injected
  from the iframe owner (defence in depth — never trusts the message field).
- `handleIncomingMessage(msg, expectedModuleId)` — convenience: validate +
  dispatch in one call, always returns a response message.

**src/module-sdk/sdk.js (NEW):** module-side SDK shim. Runs INSIDE the iframe.
Generates request_id, posts to `window.parent`, awaits matching `sdk_response`,
times out after 30 seconds. Exposes a clean namespaced API: sdk.ledger.*,
sdk.accounts.*, sdk.contacts.*, sdk.documents.*, sdk.reports.*, sdk.storage.*,
sdk.hooks.*, sdk.events.*, sdk.services.*, sdk.ui.*. The only window-global
side effect is `window.sdk` for ergonomic access.

**src/module-sdk/theme.css (NEW):** design tokens (CSS custom properties) so
modules inherit the host look without DOM access. Tokens for color, surface,
text, primary, success/warning/danger, border, font, radius, spacing, shadows,
plus a dark-mode override.

**Lifecycle integration (commands.rs):** uninstall_module and disable_module
now also call `ui_extensions::unregister_all_for_module` so a disabled module
has zero footprint in the UI.

**install_module manifest:** new optional `trusted` boolean field. Default
false. Stored in the new `trusted` column. The host can additionally promote
modules later via direct UPDATE.

**MockApi parity:** all 6 UI-extension SDK methods, getModuleFile (with a
`stageModuleFile` test helper since there's no real fs), trusted flag passes
through install. Cleanup wired into uninstall.

- 16 new tests in ui-isolation.test.ts: registerNavItem permission +
  add/list, registerSettingsPane, registerTransactionAction, uninstall
  cleanup, manifest trusted flag flows through, default-untrusted, bridge
  validateSdkCall accepts well-formed message, rejects mismatched module_id
  (anti-spoof), rejects methods not on allow-list, rejects malformed shapes,
  30-second timeout simulation, getModuleFile returns staged content with
  correct mime type, path traversal rejection, unknown module rejection,
  per-extension mime detection (js/css/svg)
- 447 tests passing (1 skipped); cargo check + npm run check clean

**Deferred:** AppShell sidebar/Settings/TransactionRegister wiring to read
from get_nav_items / get_settings_panes / get_transaction_actions, and the
module page route (/module/{id}). The kernel-side data and bridge are fully
in place; the React component tree edits are mechanical and will land with
Phase 45's module manager UI work.



### Phase 42 — Hooks and Events (2026-04-09)
Two distinct module-reactivity systems. Sync hooks run INSIDE the database
transaction and can reject (before_*) or roll back (after_*). Async events
fire AFTER commit, fire-and-forget — subscriber errors are logged, never
propagated, never roll back the originating operation.

**src-tauri/src/hooks.rs (NEW):** in-memory hook registry on DbState
(`HookRegistry: Mutex<HashMap<hook_type, Vec<RegisteredHook>>>`). Six hook
types defined: before/after_transaction_create, before/after_transaction_void,
before/after_account_update. Commands: sdk_register_hook (requires
hooks:before_write), sdk_unregister_hook, list_hooks. `run_hooks(db,
hook_type, ctx)` is called by engine commands at integration points; in
Phase 42 it returns Ok(()) immediately because there is no live cross-process
channel into module iframes yet — Phase 43 (UI Isolation) will replace it
with a postMessage round-trip that can return rejection. The integration
sites are in place so Phase 43 just needs to wire the bridge.

**src-tauri/src/events.rs (NEW):** async event bus on DbState (`EventBus`
with subscribers map + capped emissions buffer of 256 most-recent events).
14 event types: transaction.created/voided/updated, account.created/updated/
deactivated, contact.created/updated, period.locked/unlocked, module.installed/
uninstalled, reconciliation.completed, fiscal_year.closed. Commands:
sdk_subscribe_event (requires events:subscribe), sdk_unsubscribe_event,
sdk_emit_event (any installed module can emit a custom event),
list_subscriptions, get_recent_events. `emit_event(db, type, data)` records
to the buffer immediately; Phase 43 will iterate subscribers and postMessage.

**Engine integration (commands.rs):** every successful commit now emits
the appropriate event, taken outside the rusqlite borrow lifetimes via
`drop(stmt); drop(guard);` then `emit_event(...)`:
- create_transaction → transaction.created (with date, description,
  journal_type, line_count, total_amount)
- void_transaction → transaction.voided (with original + void tx ids)
- create_account → account.created
- lock_period_global → period.locked
- install_module → module.installed
- uninstall_module → module.uninstalled (and now also clears hooks +
  event subscriptions for the module)
- disable_module → also clears hooks + event subscriptions

**MockApi parity:** since the Rust kernel can't actually invoke JS handlers
in Phase 42, the **MockApi is where the full hook/event semantics live for
tests**:
- `hookHandlers: Map<hook_type, [{module_id, priority, handler}]>` —
  registerHook accepts a real JS callback. runHooks iterates in priority
  order and throws on the first rejection.
- `eventSubscribers: Map<event_type, [{module_id, handler}]>` plus
  `emittedEvents` buffer. emit() iterates subscribers wrapped in try/catch
  so one bad handler can't block others or roll back the operation.
- createTransaction now calls before_transaction_create → write → after_…
  with full rollback on after_ rejection. voidTransaction similarly.
- createAccount, lockPeriodGlobal, installModule, uninstallModule all emit
  the matching event so test subscribers can verify routing.

**Permission enforcement:** registerHook checks hooks:before_write on the
caller. subscribeEvent checks events:subscribe. uninstall/disable Module
clears hooks + event subscriptions for the affected module so a disabled
module is fully inert.

**api.ts wrappers:** all 8 new commands (sdkRegisterHook, sdkUnregisterHook,
listHooks, sdkSubscribeEvent, sdkUnsubscribeEvent, sdkEmitEvent,
listSubscriptions, getRecentEvents).

- 16 new tests in hooks-events.test.ts: hook receives context, before_
  rejection prevents write, after_ rejection rolls back, multiple hooks in
  priority order, hook permission enforcement, before_transaction_void
  rejection, event subscriber receives correct payload, error in one
  subscriber doesn't block others, error in subscriber doesn't roll back tx,
  unsubscribe stops events, custom event round-trip between modules,
  transaction.voided event, period.locked event, account.created event,
  module.installed event recorded, subscriber permission enforcement
- 431 tests passing (1 skipped); cargo check + npm run check clean



### Phase 41 — Permission Enforcer (2026-04-09)
Granular per-scope permission checks on every SDK v1 call. Modules declare
required scopes in their manifest; the user grants them at install time;
the kernel enforces them at every call site. Foundation for safely running
third-party modules.

**Schema:** new `module_permissions` table — id, module_id REFERENCES
module_registry(id) ON DELETE CASCADE, scope, granted_at, UNIQUE(module_id,
scope). Recorded as kernel migration v10.

**Permission taxonomy (21 scopes total) defined in src-tauri/src/permissions.rs:**
- READ: ledger:read, ledger:read_balances, accounts:read, contacts:read,
  reports:read, documents:read
- WRITE: ledger:write, ledger:write_reversals, accounts:write, contacts:write,
  reports:create_custom, documents:write
- SYSTEM: events:subscribe, hooks:before_write, storage:own, services:register,
  services:call, ui:nav_item, ui:settings_pane, ui:transaction_action,
  ui:column_provider

**permissions.rs (NEW):** check_permission(db, module_id, scope) → Ok or Err
with the stable message format `Module '{id}' does not have permission
'{scope}'`. grant_internal helper used by install. revoke_all helper for
uninstall (currently CASCADE handles it but kept for future explicit use).

**Permission enforcement wired into every sdk_v1.rs method (24 sites):**
- Ledger: sdk_create_transaction → ledger:write,
  sdk_void_transaction → ledger:write,
  sdk_get_account_balance → ledger:read_balances,
  sdk_get_trial_balance → ledger:read_balances,
  sdk_get_journal_entries → ledger:read
- Account: create/update/deactivate → accounts:write,
  get_chart_of_accounts → accounts:read
- Contact: create → contacts:write, get/list/ledger → contacts:read
- Document: attach/delete → documents:write, get → documents:read
- Reports: income/balance/cash_flow → reports:read
- Storage: all five sdk_storage_* → storage:own
- Service: sdk_register_service → services:register,
  sdk_call_service → services:call (checked against the *caller* module id,
  not the target — modules pay for the right to make outbound calls)

**Lifecycle integration:**
- install_module now inserts a row into module_permissions for each scope in
  the manifest's permissions array. The host UI shows the consent screen
  BEFORE invoking install_module — by the time the command runs, the user has
  approved the full scope set.
- uninstall_module explicitly DELETEs from module_permissions for the module
  (in addition to the FK CASCADE) before removing the registry row.

**3 new commands (permissions.rs):**
- grant_module_permission(module_id, scope) — verifies the module exists,
  upserts the row. Used for admin manual grants beyond manifest scope.
- revoke_module_permission(module_id, scope) — deletes the row, errors if
  the scope wasn't granted.
- get_module_permissions(module_id) — returns sorted list of granted scopes.

**api.ts + MockApi parity:** all 3 commands wired. MockApi keeps a
`Map<module_id, Set<scope>>` and runs the same check at the top of every SDK
method. The mock translates module aliases (com_example_foo) back to registry
ids (com.example.foo) for storage permission checks via resolvePermissionId.

**Phase 40 SDK tests updated:** validManifest gained accounts:read,
services:register, and services:call so the existing SDK round-trip tests still
pass under enforcement. The "call to unregistered service" test now installs
the caller module first to satisfy services:call before exercising the
not-found branch.

- 13 new tests in permissions.test.ts: SDK call with permission succeeds, SDK
  call without permission throws stable error message, install grants from
  manifest, uninstall clears, grant unblocks subsequent call, revoke blocks
  subsequent call, ledger:read without ledger:write distinction, no-permission
  module is fully inert, storage:own gating + grant, get_module_permissions
  sorted output, grant requires module to exist, revoke rejects ungranted
  scope, services:call enforced on caller side
- 415 tests passing (1 skipped); cargo check + npm run check clean

**Deferred:** Consent UI dialog (the host React UI that lists requested
permissions before calling install_module) — left for the Phase 45 module
manager UI work, where the install flow gets a real file picker and progress
view. The kernel-side enforcement is fully in place today.



### Phase 40 — SDK v1 Core & Module Lifecycle (2026-04-09)
The central nervous system of the plugin architecture: module manifest,
versioned SDK contract, module registry, install/uninstall/enable/disable
lifecycle, and the inter-module service registry (Fix #6).

**Schema:** new `module_registry` table in company.sqlite (id, name, version,
sdk_version, description, author, license, permissions JSON, dependencies JSON,
entry_point, install_path, status, installed_at, updated_at, error_message).
The legacy Phase 23 `modules` table is left in place for backwards-compatible
list_modules calls; new code uses `module_registry`. Recorded as kernel
migration v9.

**SDK v1 (src-tauri/src/sdk_v1.rs):** brand-new file. Frozen contract — once
released the signatures must not change. New methods may be ADDED; new
optional parameters may be ADDED to existing methods. Breaking changes
require sdk_v2.rs. Method categories:
- Ledger: sdk_create_transaction, sdk_void_transaction, sdk_get_account_balance,
  sdk_get_trial_balance, sdk_get_journal_entries
- Account: sdk_create_account, sdk_update_account, sdk_deactivate_account,
  sdk_get_chart_of_accounts
- Contact: sdk_create_contact, sdk_get_contact, sdk_list_contacts,
  sdk_get_contact_ledger
- Document: sdk_attach_document, sdk_get_documents, sdk_delete_document
- Report: sdk_get_income_statement, sdk_get_balance_sheet, sdk_get_cash_flow
- Storage: sdk_storage_create_table/insert/query/update/delete (delegates to
  Phase 38 module storage)
- Service: sdk_register_service, sdk_call_service, sdk_list_services
- Versioning: get_sdk_version (returns "1")

Every method takes `module_id` as the first parameter. The body simply
delegates to the existing engine command. Permission checks (Phase 41) will
slot in at the top of every method without changing signatures.

**Module Lifecycle commands:**
- install_module(manifest_json, install_path?) — parses + validates manifest,
  rejects unsupported sdk_version (only "1" today), rejects duplicate ids,
  rejects ids with non-`[A-Za-z0-9._-]` chars, inserts into module_registry
  with status='active'.
- uninstall_module(module_id, keep_data?) — marks 'uninstalling', DETACHes
  the module DB if attached, optionally deletes the .sqlite (keep_data=true
  preserves it), clears the service registry for the module, removes from
  module_registry, deletes related migration_log/pending/dependency rows.
- enable_module / disable_module — toggles status. Disable also DETACHes the
  module DB and clears its services so the module is fully inert.
- get_module_info(module_id) / list_installed_modules() — read-only.

**Service registry (Fix #6):** in-memory `service_registry: Mutex<HashMap<
(String, String), RegisteredService>>` on DbState. sdk_register_service stores
a (module_id, service_name) → RegisteredService entry. sdk_call_service is
brokered through the kernel — modules never communicate directly. The Phase 40
implementation returns a stub OK response so tests can verify routing; Phase 43
will replace this with a real iframe postMessage round-trip. Services are
auto-cleared on disable and uninstall.

**Module ID aliasing:** registry ids may contain dots/dashes (com.example.foo)
but ATTACH aliases must be `[A-Za-z0-9_]+`. We translate via `module_id.replace
(['.','-'], '_')` consistently across install/disable/uninstall.

**api.ts + MockApi parity:** all 6 lifecycle commands plus the service-registry
SDK methods plus get_sdk_version, plus a thin selection of SDK v1 ledger and
storage wrappers used in tests. The mock simulates a `moduleSqliteFiles` Set so
keep_data semantics can be verified without real fs.

- 19 new tests in sdk-lifecycle.test.ts: install with valid manifest, sdk_version
  rejection, duplicate id rejection, invalid id chars rejection, uninstall with
  and without keep_data, uninstall clears services, disable/enable round-trip,
  disable clears services, get_sdk_version, SDK ledger forwarding, SDK storage
  forwarding, service register+call round-trip, call to unregistered service,
  list_services, list_installed_modules, mixed-state coexistence
- 402 tests passing (1 skipped); cargo check + npm run check clean



### Phase 39 — Migration Coordinator (2026-04-09)
Per-module versioned migrations with dependency enforcement, checksum-based
tamper detection, and graceful per-module failure handling. Foundation for
SDK v1 module installs in Phase 40.

**Schema (3 new tables in company.sqlite):**
- `migration_log` — id, module_id, version, description, checksum, applied_at,
  success, error_message; UNIQUE(module_id, version). Tracks every applied or
  failed migration. The kernel uses module_id='kernel'.
- `module_dependencies` — id, module_id, depends_on_module_id, min_version;
  UNIQUE pair. Drives topological run order.
- `module_pending_migrations` — staged-but-unapplied migrations registered by
  modules before run.

**5 new Rust commands (commands.rs):**
- `register_module_migrations(module_id, migrations[])` — stages migrations.
  Rejects re-registration with a different checksum on a successfully-applied
  version (tamper detection). Returns the list of still-pending migrations.
- `run_module_migrations(module_id)` — verifies all dependencies are satisfied
  (each `depends_on` module must have applied >= `min_version`), runs the
  topological-sort cycle check, auto-attaches the module's .sqlite if needed,
  then applies each pending migration in version order inside its own
  `SAVEPOINT mig_<id>_<version>`. On failure: ROLLBACK TO + RELEASE the
  savepoint, write a failure row to `migration_log`, return early — does NOT
  advance to subsequent versions.
- `get_migration_status(module_id?)` — returns latest applied version, applied
  count, pending count, failed count, and last error message; per module if
  given, otherwise across all modules (kernel + every module that's appeared
  in either log or pending tables).
- `register_module_dependency(module_id, depends_on_module_id, min_version?)`
  — UPSERTs the dependency, then re-runs `topological_sort` and rolls back the
  insert if a cycle was introduced. Rejects self-dependencies up front.
- `check_dependency_graph()` — DFS-based topological sort over the entire
  dependency graph; returns the order or throws "Circular dependency detected
  at module: X".

**Kernel migration recording:** `db.rs::run_migrations` now appends 8 baseline
kernel migrations (versions 1–8 covering the original schema and every
historical ALTER TABLE) into `migration_log` via `INSERT OR IGNORE`. Idempotent;
reflects retroactively on existing files when first opened after Phase 39.

**MockApi parity:** all 5 commands implemented with the same semantics. The
mock simulates per-version failure via a `FAIL_MIGRATION` marker substring in
the migration SQL — tests inject this string to drive the partial-failure path
without needing real SQLite errors. Cycle detection uses the same DFS visit
algorithm and roll-back-on-cycle behavior.

- 13 new tests in migration-coordinator.test.ts: register+run round-trip,
  checksum tampering rejection, out-of-order registration → in-order execution,
  partial failure halts and is recorded, dependency enforcement (B blocked
  until A migrated), circular dependency rejection + rollback, full topo sort
  ordering, status counts during phases, kernel migrations recorded
  retroactively, all-modules listing, idempotent re-runs, cross-module
  isolation on failure, self-dependency rejection
- 383 tests passing (1 skipped); npm run check clean; cargo check clean



### Phase 38 — Storage Sandbox & Directory Structure (2026-04-09)
**Major architectural shift:** Company files transition from a single .sqlite
to a DIRECTORY containing the kernel company.sqlite plus modules/, documents/,
and backups/ subdirectories. Foundation for the plugin SDK (Phases 39–46).

- db.rs: added `resolve_company_paths()` — handles 3 cases:
  - existing directory → use directly
  - existing legacy .sqlite file → AUTO-MIGRATE: create dir, move file (+ wal/shm
    sidecars and any legacy {file}_documents/) into it
  - non-existent path → treat as new directory
- `create_book_file()` now returns `(Connection, PathBuf)` and creates
  modules/, documents/, backups/ subdirs
- `open_book_file()` validates schema and ensures subdirs exist
- DbState gained `company_dir: Mutex<Option<String>>` and
  `attached_modules: Mutex<Vec<String>>`
- `close_file` and `open_file` / `create_new_file` now DETACH all modules
  before closing
- Document storage migrated from `{company_file}_documents/` to
  `{company_dir}/documents/`
- Backups migrated to `{company_dir}/backups/` (single-file VACUUM INTO format;
  full-directory zip deferred to add `zip` crate dependency)
- import_database now writes through company_dir/company.sqlite

**New module storage commands (9 total):**
- `attach_module_db(module_id)` — creates modules/{id}.sqlite if needed,
  ATTACHes as `module_{id}`, initializes `_migrations` table
- `detach_module_db(module_id)` — DETACHes
- `list_attached_modules()` — returns currently attached IDs
- `module_create_table(module_id, table_name, columns_sql)` — DDL into module
  schema; rejects `;` in columns_sql, validates idents
- `module_insert(module_id, table_name, row_json)` — structured insert,
  returns rowid
- `module_query(module_id, table_name, filters?)` — structured filters
  (=, !=, <, >, <=, >=, LIKE), no raw SQL
- `module_update(module_id, table_name, id, fields)` — by id
- `module_delete(module_id, table_name, id)` — by id
- `module_execute_migration(module_id, version, sql)` — install/upgrade only;
  records version in `_migrations` (idempotent)

**Security:** every module command requires the module to be currently
attached, validates module_id and column/table names against
`^[A-Za-z_][A-Za-z0-9_]*$`, and uses parameter binding for values. Modules
cannot read/write the kernel `company.sqlite` through this API and cannot
access another module's schema (different ATTACH alias).

**API/Mock parity:** all 9 commands wired into api.ts; MockApi simulates
ATTACH with per-module in-memory stores and the same identifier validation,
filter logic, and isolation guarantees.

- 18 new tests in module-storage.test.ts covering directory format derivation,
  ATTACH/DETACH idempotency, identifier validation/rejection, full CRUD,
  filter ops (=/>/LIKE/AND), cross-module isolation, kernel-table isolation,
  detached-module rejection, migration idempotency, document attach round-trip
- 370 tests passing (1 skipped); npm run check clean; cargo check clean


- 35+ Rust commands, full MockApi coverage
- Features: .sqlite file architecture (create/open/close), chart of accounts CRUD, journal entry
  with journal types (GENERAL/ADJUSTING/CLOSING/REVERSING/OPENING), auto-reference numbers,
  transaction register with edit/void and journal type badges, audit trail, period locking,
  backup/restore, CSV export, settings/preferences, report drill-downs with account ledger,
  print-friendly reports, report filters for adjusting/closing entries
- Stack: Tauri v2 + React + TypeScript + rusqlite + Vitest

## COMPLETED

### Phase 37 — Packaging & Distribution (2026-04-08, partial)
- Updated tauri.conf.json: identifier com.bookkeeping.app, window 1200x800 default with 900x600 min, center on launch, bundle metadata (copyright, descriptions, category)
- Created .github/workflows/build.yml: CI on push/PR, matrix (Ubuntu, macOS, Windows), Node+Rust setup, test+build+artifact upload
- Created .github/workflows/release.yml: triggered by version tags, builds all platforms, creates GitHub Release draft via tauri-apps/tauri-action
- Created docs/release-checklist.md: pre-release checks, build verification, smoke test steps
- Remaining: app icon generation, cargo tauri build verification, README with screenshots

### Phase 36 — V2 Audit Fixes (2026-04-08)
- Fixed: Duplicate opening balances now throw error instead of silently replacing — user must void existing entry first
- Fixed: updateAccount rejects account type changes with "Account type cannot be changed after creation"
- Fixed: updateAccount validates parent_id for circular references (depth-limited walk, cap at 10)
- Verified: Zero-activity fiscal year close already works correctly (creates CLOSING tx with no entries)
- Verified: Monthly recurrence end-of-month clamping already works correctly (Jan 31 → Feb 28, Mar 31 → Apr 30)
- Updated existing test B10 to match new opening balance behavior (throw instead of replace)
- 11 new tests covering all 5 audit findings
- 352 tests passing (1 skipped)

### Phase 35 — Document Attachments (2026-04-08)
- Added `documents` table (entity_type, entity_id, filename, stored_filename, mime_type, file_size_bytes, description)
- Filesystem storage: `{company_file}_documents/{YYYY}/{MM}/{uuid_filename}`
- 5 Rust commands: attach_document, list_documents, get_document_path, delete_document, get_document_count
- Entity validation: TRANSACTION, CONTACT, ACCOUNT — rejects invalid entity_id
- UUID-based stored_filename preserves extension, prevents collisions
- MIME type detection from file extension (pdf, png, jpg, csv, doc, xls, etc.)
- 25MB file size limit enforced in Rust
- True delete (not soft delete) — documents are supporting evidence, not financial data
- MockApi: in-memory document storage with fake paths, full API contract testable
- DocumentAttachments.tsx: reusable collapsible component with count badge, file list, delete confirmation
- 8 new tests covering CRUD, multi-attach, count, entity validation, UUID naming, MIME detection
- 341 tests passing (1 skipped)

### Phase 34 — General Ledger View (2026-04-08)
- Added `get_general_ledger(filters)` command (Rust + api.ts + MockApi)
- Filters: account_id/account_ids, start_date, end_date, contact_id, journal_type, include_void, dimension_filters
- Returns per-account groups with opening_balance, entries (with running balance), closing_balance, total_debits, total_credits
- Running balance respects normal_balance direction (debit-normal vs credit-normal accounts)
- Opening balance calculated from entries before start_date
- Entries include contact_name (from junction), dimensions (from line tags), is_void, journal_type
- GeneralLedgerPage.tsx: filter bar (account, dates, contact, journal type, void toggle), collapsible account sections, entry table with running balance, dimension chips, grand totals
- Export CSV button exports filtered GL view as downloadable CSV
- Print button with @media print CSS
- Sidebar: "General Ledger" added first in Reports section
- 10 new tests covering single/multi account GL, opening balance, date range, dimension filter, contact filter, running balance, void handling, date ordering
- 333 tests passing (1 skipped)

### Phase 33 — Contact Registry (2026-04-08)
- Added `contacts` table (type, name, company_name, email, phone, address fields, tax_id, notes, is_active)
- Added `transaction_contacts` junction table linking transactions to contacts (UNIQUE per transaction+contact+role)
- 11 Rust commands: create_contact, update_contact, get_contact, list_contacts, deactivate_contact, reactivate_contact, delete_contact, link_transaction_contact, unlink_transaction_contact, get_contact_ledger, get_contact_balance
- Contact types: CUSTOMER, VENDOR, EMPLOYEE, OTHER
- list_contacts with type filter, search (name/company/email), active filter
- Cannot delete contact with transaction references — must deactivate instead
- Contact ledger: all transactions linked to a contact with running balance (vendor/customer ledger)
- Contact balance: net debit-credit across all linked transactions with optional as_of date
- MockApi: full contact support including createTransactionWithContact, getTrialBalanceWithContact, getIncomeStatementWithContact, getBalanceSheetWithContact
- Report filtering by contact composes with dimension filters (AND logic)
- ContactsPage.tsx: CRUD, type filter tabs, search bar, click to detail view
- ContactDetail.tsx: editable contact info, contact ledger table, summary totals (debits/credits/balance)
- JournalEntryForm: contact picker dropdown (active contacts only)
- 10 new tests covering CRUD, search, type filter, transaction linking, ledger, balance, delete protection, deactivation, report filtering, AND composition with dimensions
- 323 tests passing (1 skipped)

### Phase 32 — Dimensions/Tags Engine (2026-04-07)
- Added `dimensions` table (type, name, code, parent_id, is_active) with UNIQUE(type, name)
- Added `transaction_line_dimensions` junction table linking journal entries to dimensions
- 5 Rust commands: create_dimension, update_dimension, list_dimensions, list_dimension_types, delete_dimension
- get_transaction_dimensions returns dimension tags per line
- Updated create_transaction to accept optional dimensions array (line_index + dimension_id)
- Updated updateTransactionLines to handle dimension reassignment
- Dimension validation: unique type+name, parent same type, circular reference prevention, active check
- MockApi: full dimension support including createTransactionWithDimensions
- MockApi report filtering: getTrialBalanceWithDimensions, getIncomeStatementWithDimensions, getBalanceSheetWithDimensions
- Filtering logic: same type = OR, different types = AND
- DimensionsPage.tsx: full CRUD, hierarchical display, type filtering, create with parent
- JournalEntryForm: dimension chip picker per line item
- DimensionFilterBar.tsx: reusable filter component for reports
- 17 new tests covering CRUD, hierarchy, transaction tagging, report filtering (TB + IS), AND/OR logic, inactive/delete protection
- 313 tests passing (1 skipped)

### Engine Audit V2 Bug Fixes (2026-04-06)
- Fixed: Opening balances wizard now replaces previous opening balances instead of doubling
- Fixed: Fiscal year close works with zero activity (dormant years)
- Fixed: Circular parent account references prevented in createAccount
- Fixed: Monthly recurring transactions clamp to end-of-month correctly (Jan 31 → Feb 28 → Mar 31)
- Fixed: Reconciliation now tracks line-level matched/unmatched entries (is_reconciled on journal_entries)
- Added: getUnreconciledEntries command (Rust + MockApi + api.ts)
- All 5 fixes applied to both Rust backend and MockApi
- 296 tests passing (1 skipped — D5 deleteAccount by design)

### Phase 31 — Reconciliation Service (2026-04-05)
- startReconciliation: compares book balance vs statement balance
- completeReconciliation: locks period after verification (difference must be 0)
- listReconciliationHistory: shows completed reconciliations
- Reconciliation with non-zero difference rejected
- Completed reconciliation locks period (prevents edits)
- 194 tests passing (5 new reconciliation tests)

### Phase 30 — Bank Feed Pipeline (2026-04-05)
- Added `pending_bank_transactions` table for imported bank data
- import/list/approve/dismiss commands in Rust + MockApi + api.ts
- Deduplication by bank_ref, auto-match by payee history
- Approval creates balanced journal entry (debit/credit to cash + categorized account)
- Dismissal marks as ignored without creating transaction
- BankFeed.tsx: review, categorize, approve/dismiss pending items
- 189 tests passing (4 new bank feed tests)

### Phase 29 — Accrual vs Cash Basis Reporting (2026-04-05)
- Added `basis` parameter to getIncomeStatement (ACCRUAL default, CASH optional)
- Cash basis: only includes transactions with at least one entry to a cash account (is_cash_account=1)
- Accrual/Cash dropdown toggle on Income Statement UI
- Rust uses subquery to filter cash-leg transactions
- 185 tests passing (3 new cash basis tests)

### Phase 28 — Recurring Transactions (2026-04-05)
- Added `recurring_templates` table with recurrence rules (WEEKLY/MONTHLY/QUARTERLY/YEARLY)
- 7 Rust commands: create, list, update, pause, resume, delete, generate
- MockApi with due date calculation, pause/resume, generation
- RecurringTransactions.tsx management UI: create, generate, pause/resume, delete
- Templates store entries as JSON, generate balanced transactions on demand
- 182 tests passing (5 new recurring tests)

### Phase 27 — CSV Import with Column Mapping (2026-04-05)
- CsvImport.tsx: file upload, CSV parsing, column preview
- Auto-detect column mapping from headers (date, desc, account, debit, credit)
- Validation per row: invalid dates, unknown accounts, zero amounts
- Duplicate detection: date + amount + description match
- Import summary: imported/skipped/duplicates counts with error details
- importCsvRows method in MockApi
- 177 tests passing (3 new CSV import tests)

### Phase 26 — Excel-Style Transaction Register UX (2026-04-05)
- Complete rewrite of TransactionRegister with inline edit mode
- "Edit Mode" button makes all unlocked rows editable inline (date, ref, description)
- Multi-entry transactions collapsed in edit mode, expand on click outside edit mode
- Period-locked and voided rows greyed out and non-editable
- Tab key navigates between editable cells, Escape restores original value
- Orange dot indicator on modified rows, unsaved changes counter
- "Save All Changes" batch commits all modified transactions with silent audit logging
- 174 tests passing (UI-only phase, no new engine tests needed)

### Phase 25 — Account Hierarchy in Reports (2026-04-05)
- `get_accounts` now returns `depth` computed from parent chain
- `AccountBalanceRow` and `AccountBalanceItem` include `depth` and `parent_id`
- AccountsListPage: child accounts indented under parents, parent accounts bolded
- TrialBalance, BalanceSheet, IncomeStatement: accounts indented by depth
- Account creation UI: parent account dropdown filtered by matching type
- 174 tests passing (4 new hierarchy tests)

### Phase 24 — Cash Flow Statement (2026-04-05)
- Added `cash_flow_category` and `is_cash_account` columns to accounts table (migration)
- Cash/Checking/Savings auto-tagged as cash accounts
- Added `get_cash_flow_statement` Rust command + MockApi + api.ts
- Indirect method: net income + adjustments for non-cash BS changes
- Operating/Investing/Financing sections with heuristic classification
- CashFlowStatement.tsx with date range picker, three sections, beginning/ending balances
- Added to Reports section in sidebar
- 170 tests passing (5 new cash flow tests)

### Phase 23 — Module Foundation (2026-04-05)
- Added `modules` table to schema
- Added `list_modules`, `get_module` Rust commands + MockApi + api.ts
- Created `docs/api-contract.md` — full API surface documented with stability classifications
- Module convention already in CLAUDE.md
- 165 tests passing (2 new module tests)

### Phase 22 — Fiscal Year Close (2026-04-05)
- Added `close_fiscal_year` command — zeroes revenue/expense, transfers net income to Retained Earnings
- Added `list_fiscal_year_closes` command — history of closed years
- Closing entry uses journal_type = CLOSING
- Period automatically locked through fiscal year end date
- Duplicate close prevention (cannot close same year twice)
- FiscalYearClose.tsx UI with confirmation dialog and closing history
- Income statement excludes closing entries by default (toggle)
- 163 tests passing (10 new fiscal year close tests)

### Phase 21 — Retained Earnings & Opening Balances (2026-04-05)
- Added "Opening Balance Equity" (code 3500) to seed accounts
- Added `is_system` column to accounts table — Retained Earnings (3200) and OBE (3500) are system accounts
- System accounts cannot be deactivated
- Added `enter_opening_balances` Rust command + MockApi + api.ts
- Created OpeningBalancesWizard.tsx — accessible from sidebar under Accounts
- Opening balances create OPENING journal type transaction with OBE offset
- Balance sheet correctly shows Opening Balance Equity in equity section
- 153 tests passing (7 new opening balance tests)

### Phase 20 — Journal Types & Transaction Classification (2026-04-05)
- Added `journal_type` column to transactions table (migration, defaults to GENERAL)
- Valid types: GENERAL, ADJUSTING, CLOSING, REVERSING, OPENING
- Users can only create GENERAL and ADJUSTING entries; CLOSING/REVERSING/OPENING are system-only
- Auto-reference numbers: GJ-0001, AJ-0001, etc. — counter per type stored in settings
- JournalEntryForm: journal type dropdown (General / Adjusting)
- TransactionRegister: colored badge for non-GENERAL types (ADJ=blue, CLO=purple, REV=orange)
- Income statement & trial balance: filter toggles for adjusting/closing entries
- Voiding a transaction now creates a REVERSING journal type
- All changes in Rust, api.ts, and MockApi
- 146 tests passing (6 new journal type tests)

### Engine Audit Bug Fixes (2026-04-05)
- Fixed: createTransaction now checks period locks (was CRITICAL — locked periods were bypassable)
- Fixed: Cannot void a reversing entry (prevents void-of-void chains)
- Fixed: Cannot edit voided transactions (voided entries are now immutable)
- Fixed: Cannot create transactions referencing deactivated accounts
- Fixed: Duplicate period locks on same date prevented (idempotent; backwards locks still rejected)
- All 5 fixes applied to both Rust backend and MockApi
- 140 tests passing (85 existing + 55 audit)

### Phase 18 — File-Based Architecture (.sqlite files) (2026-04-05)
**Major architectural change:** App now works like QuickBooks Desktop — each company is its own .sqlite file.
- Refactored db.rs: `init_db()` replaced with `create_book_file()`, `open_book_file()`, `close_book_file()`
- DbState changed from `Mutex<Connection>` to `Mutex<Option<Connection>>` — starts as None
- Added 7 new Tauri commands: create_new_file, open_file, close_file, get_recent_files, open_recent_file, remove_recent_file, is_file_open
- All existing commands now guard with `get_conn()` helper — return "No file is open" if None
- Recent files tracked in `{app_data_dir}/recent-files.json` (max 10, most recent first)
- Created WelcomeScreen.tsx: new file creation, open existing, recent files list
- App.tsx: routes between WelcomeScreen (no file) and AppShell (file open)
- AppShell: added "Close File" button in sidebar
- MockApi: added file lifecycle (createNewFile/openFile/closeFile), guardFileOpen() check, resetData()
- 10 new tests: create file, seed accounts, company name in settings, open valid, reject missing,
  guard when closed, switch files, recent list updates, remove recent
- 85 total tests pass, typecheck + cargo clean
- Data ownership principle: .sqlite is standard, openable in DB Browser, Python, R, sqlite3 CLI — no lock-in

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
- MockApi tests cover all logic but no integration tests hit the real rusqlite backend yet
- No accessibility pass done (keyboard nav, focus management, ARIA)
- Phase 9 final CHECK not explicitly verified in build-todo.md