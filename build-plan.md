# Bookkeeping App — Build Plan

## CONTEXT
Phases 1–17 are complete. The app has:
- Double-entry accounting engine with balance validation in Rust
- App shell with sidebar navigation and dashboard
- Account CRUD (add, edit, deactivate)
- Transaction register with pagination, filtering, search
- Transaction editing, voiding, and full audit trail
- Backup & restore with auto-backup
- CSV export for all reports
- Settings & preferences (company name, currency, date format, fiscal year)
- Period locking with management UI
- Report enhancements with account drill-down and running balances
- 75 tests passing, all through Tauri + rusqlite backend

## WHAT'S NEXT
The app currently uses a single hardcoded `bookkeeping.db` in the app data directory. A real bookkeeping app works like QuickBooks Desktop — each company/entity is its own file. You open a file, work in it, close it. The file IS the books.

After that: Excel-style editing, CSV import, recurring transactions, bank feeds, reconciliation.

## CORE PRINCIPLE: RADICAL DATA OWNERSHIP
The user's financial data belongs to them, not to the app. This means:
- **Standard format**: `.sqlite` files — not a proprietary extension. Openable in DB Browser, DBeaver, Python, R, sqlite3 CLI, any programming language, any OS.
- **No lock-in**: if the app disappears tomorrow, every row of data is still fully accessible and queryable with standard tools.
- **No encryption barriers**: the user can inspect, export, or migrate their data at any time without needing the app.
- **Portable**: a single file that can be copied, moved, emailed, backed up, version-controlled, or synced via any file service.
- **Self-documenting schema**: table and column names are human-readable. A developer or accountant with basic SQL knowledge can understand the data without documentation.

## DESIGN PRINCIPLES
1. **File = Company** — each `.sqlite` file is a complete SQLite database for one entity, self-contained with schema, data, and settings
2. **Engine before UI** — every feature starts in Rust (commands.rs), gets a TypeScript API wrapper (api.ts), gets a MockApi test, THEN gets a React component
3. **Never delete financial data** — edits create audit log entries, "deletes" are voids (reversing entries)
4. **Integer cents everywhere** — all amounts are i64 in Rust, number in TypeScript, stored as INTEGER in SQLite
5. **Period locks are hard** — once a period is locked, no Rust command will modify transactions in that period, regardless of what the UI sends
6. **Collapsed by default** — multi-entry transactions stay collapsed until explicitly clicked, including in edit mode
7. **One file at a time** — like QBD, not tabs. Open → work → close → open another.

## ARCHITECTURE

### Current (Phase 17)
```
App launch → open hardcoded bookkeeping.db → show app shell
```

### Target (Phase 18)
```
App launch → WelcomeScreen (recent files + new/open)
  → User picks/creates .sqlite file
    → Rust opens connection to that file
      → App shows sidebar + dashboard
        → All commands operate against open file
          → Close file → back to WelcomeScreen
```

Every new Rust command needs:
1. A function in commands.rs (with #[tauri::command])
2. A matching function in api.ts
3. A matching function in MockApi
4. At least one test

---

# PHASE 18 — File-Based Architecture (.sqlite files)

**Goal:** Transform the app from single-database to file-based. Each company is a `.sqlite` file. App launches to a welcome screen. One file open at a time.

**This is the foundation for multi-company support and data portability.**

### What changes in Rust
The current `db.rs` opens a hardcoded path at app startup and stores the connection in Tauri state. This needs to become:
- Connection stored as `Mutex<Option<Connection>>` — starts as None
- `init_db()` becomes `create_book_file(path, company_name)` — creates schema + seeds
- New `open_book_file(path)` — validates schema, opens connection
- New `close_book_file()` — WAL checkpoint, drops connection, sets to None
- Every existing command gets a guard: `let conn = state.conn.lock()?.as_ref().ok_or("No file open")?;`

### What changes in the UI
- App.tsx checks: is a file open? If no → WelcomeScreen. If yes → AppShell.
- WelcomeScreen is the new "home base" — not a one-time setup wizard.
- Company name comes from the open .sqlite file's settings table.

### File Format
- Extension: `.sqlite` — standard, universal, no proprietary format
- Format: SQLite database (WAL mode, foreign keys ON)
- Contains: all tables (accounts, transactions, journal_entries, audit_log, reconciliation_periods, settings)
- Seed data: 26 default accounts, default settings (company name, fiscal year, currency)
- Portable: user can copy/move/email/backup the single file

### Connection Management
```
Rust State:
  Mutex<Option<Connection>>  ← None when no file open, Some(conn) when open

Every existing command gets a guard:
  let conn = state.conn.lock()?.as_ref().ok_or("No file open")?;
```

### Recent Files
```
{app_data_dir}/recent-files.json  ← app-level config, NOT inside any .sqlite file

[
  { "path": "/Users/me/Documents/acme-corp.sqlite", "company_name": "Acme Corp", "last_opened": "2026-04-05T..." },
  { "path": "/Users/me/Documents/personal.sqlite", "company_name": "Personal", "last_opened": "2026-04-04T..." }
]
```
- Max 10 entries, most recent first
- Updated on every file open
- Missing files shown with warning, removable from list

### Key Decisions
- Standard `.sqlite` extension — no custom format
- No encryption (user should be able to open the file in any tool)
- No file locking beyond SQLite's built-in (single-user desktop app)
- Settings are per-file (each company has its own settings)
- App-level config (recent files, window preferences) stored separately in `{app_data_dir}/`
- On launch: always show WelcomeScreen, never auto-open last file

---

# PHASE 19 — Excel-Style Transaction Register UX

**Goal:** Transform the register from click-to-edit into a spreadsheet-like experience.

_Decisions already made:_
- Hybrid interaction: inline editing for metadata (date, memo, ref), panel expansion for amounts
- Edit mode activated by sidebar button — all unlocked rows become editable at once
- Multi-entry transactions always collapsed until explicitly clicked, even in edit mode
- Period-locked and reconciled rows greyed out at UI and engine level
- Silent audit logging (no confirmation per edit)

### Additional UX
- Tab moves between cells (left→right, then next row)
- Escape cancels current cell, restores previous value
- Modified rows show unsaved indicator
- "Save All Changes" commits all edits in batch

---

# PHASE 20 — CSV Import with Column Mapping

**Goal:** Import bank CSVs with a mapping UI.

- Upload → preview → map columns → validate → import
- Duplicate detection: date + amount + memo match
- Error report for rejected rows
- Import summary with counts

---

# PHASE 21 — Recurring Transactions

**Goal:** Templates for repeated entries.

- `recurring_templates` table inside each .sqlite file
- Rules: weekly, monthly, quarterly, yearly
- On app open: prompt for due entries
- Management page: list, edit, pause, delete templates

---

# PHASE 22 — Bank Feed Pipeline (Plaid Integration)

_Architecture already designed:_
- Plaid API → normalize → deduplicate → `pending_bank_transactions` table (inside .sqlite)
- Approval flow: user matches pending item to account → createTransaction() fires
- Auto-categorization based on previous payee matches
- Touch point between bank feed and accounting engine: approval only

---

# PHASE 23 — Reconciliation Service

- Book balance vs statement balance per account per period
- Match transactions to bank items (auto + manual)
- Lock period when reconciled (uses Phase 16 infrastructure)
- Reconciliation history and reports

---

# SUMMARY (Phases 18–23)

| Phase | What | New Commands | New Components | Est. Tests |
|-------|------|-------------|----------------|------------|
| 18 | .sqlite file architecture | 6 | WelcomeScreen | 9 |
| 19 | Excel-style register UX | 0 (uses existing) | Register rewrite | 5 |
| 20 | CSV import | 3 | ImportWizard | 3 |
| 21 | Recurring transactions | 5 | RecurringManager | 3 |
| 22 | Bank feed pipeline | 5 | PendingTransactions | 3 |
| 23 | Reconciliation | 4 | ReconciliationView | 3 |
| **Total** | | **23 commands** | **~6 new components** | **~26 tests** |
