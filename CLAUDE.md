# Bookkeeping App — Claude's Instructions

## PROJECT GOAL
Build a double-entry bookkeeping desktop app.
Stack: Tauri + React + TypeScript + rusqlite (SQLite on disk) + Vitest

## HARD RULES — never break these
- All money is stored as INTEGER CENTS. Never use float for money.
- Every transaction must have SUM(debit) = SUM(credit)
- TypeScript strict mode — no `any` on accounting functions
- Run tests before every commit
- Never commit code that breaks passing tests
- Never delete financial data — edits create audit log entries, "deletes" are voids (reversing entries)
- Period locks are hard — no Rust command may create, modify, or void transactions in a locked period
- Standard `.sqlite` format only — no proprietary extensions, no encryption barriers, no lock-in
- System accounts (Retained Earnings, Opening Balance Equity) cannot be deactivated or deleted
- Voided transactions are immutable — cannot be edited after voiding
- Reversing entries cannot be voided (no void-of-void chains)
- Deactivated accounts cannot receive new transactions

## DATA OWNERSHIP PRINCIPLE
This app is built on radical data ownership. The user's financial data belongs to them, not to the app.
- Each company file is a standard `.sqlite` file — openable in DB Browser, DBeaver, Python, R, sqlite3 CLI, or any other tool
- If the app disappears tomorrow, the user's data is still fully accessible
- No proprietary formats, no encryption barriers, no vendor lock-in
- Schema uses human-readable table and column names

## YOUR LOOP — follow this every session
1. Read CLAUDE.md (this file)
2. Read CHANGELOG.md to understand current state and failed approaches
3. Read build-todo.md for current phase and unchecked tasks
4. If you need design context for a phase, read build-plan.md
5. Work through unchecked tasks in order
6. Run the CHECK command at the end of each phase
7. If check passes → update build-todo.md [x], write CHANGELOG.md entry, git commit
8. If check fails → diagnose, fix, re-run check. Log the failure in CHANGELOG.md
9. Never advance to the next phase until current phase check passes

## NEW COMMAND PATTERN (Phase 9+)
Every new feature must be written in 4 places:
1. Rust function in commands.rs with `#[tauri::command]`
2. Matching TypeScript function in api.ts
3. Matching method in MockApi (same interface, in-memory JS)
4. At least one test using MockApi

Do NOT skip any of these. If a Rust command exists without a MockApi method, tests can't cover it. If api.ts is missing a wrapper, the UI can't call it.

## FILE ARCHITECTURE (Phase 18+)
- Each company is a `.sqlite` file — the file IS the books
- One file open at a time (like QuickBooks Desktop)
- Connection: `Mutex<Option<Connection>>` — None when no file open
- Every command must guard: return error if no file is open
- Recent files tracked in `{app_data_dir}/recent-files.json` (app-level, not per-file)
- Settings (company name, currency, etc.) stored inside each `.sqlite` file

## JOURNAL TYPES (Phase 20+)
- GENERAL — regular day-to-day entries (user-created)
- ADJUSTING — end-of-period accruals, deferrals (user-created)
- CLOSING — year-end revenue/expense → retained earnings (system-generated only)
- REVERSING — auto-reverse of adjusting entry (system-generated only)
- OPENING — opening balances (system-generated only)
- Users can only create GENERAL and ADJUSTING entries manually

## MODULE CONVENTION (Phase 23+)
- Module tables use prefix: `mod_{module_name}_` (e.g., mod_invoicing_invoices)
- Modules register in the `modules` table
- Module data lives inside each .sqlite file (same data ownership principle)
- Core engine tables never use the `mod_` prefix

## DIMENSIONS (Phase 32+)
Dimensions are user-defined tags for transaction lines: class, location, project, department, or any custom type.
- Dimensions attach to LINES, not transactions — a split transaction can tag different lines differently
- Schema: `dimensions` table (id, type, name, code, parent_id, is_active) + `transaction_line_dimensions` junction table
- UNIQUE(type, name) — no duplicate dimension values within a type
- Dimensions support hierarchy via parent_id (same type only)
- Filtering logic: multiple values of the SAME type = OR; different types = AND
- All reports (trial balance, income statement, balance sheet, cash flow, general ledger) accept optional dimension filters
- Deactivated dimensions cannot be assigned to new lines but existing data is preserved
- Cannot delete a dimension that has transaction line references

## CONTACTS (Phase 33+)
Contacts (customers, vendors, employees) are kernel-level entities, not a module.
- Contacts attach to TRANSACTIONS (not lines) — one primary contact per transaction
- Schema: `contacts` table (id, type, name, company_name, email, phone, address fields, tax_id, notes, is_active) + `transaction_contacts` junction table
- Contact types: CUSTOMER, VENDOR, EMPLOYEE, OTHER
- Contact ledger: all transactions linked to a contact with running balance — this is the vendor/customer ledger
- All reports accept optional contact_id filter, composable with dimension filters (AND logic)
- Cannot delete a contact with transaction references — deactivate instead
- tax_id is stored for 1099 prep, displayed masked in UI

## DOCUMENT ATTACHMENTS (Phase 35+)
Binary files (receipts, invoices, source documents) attached to transactions, contacts, or accounts.
- Files stored on filesystem, NOT in SQLite — metadata only in the database
- Directory: `{company_file}_documents/{YYYY}/{MM}/{stored_filename}` — sibling to the .sqlite file
- stored_filename is UUID-based to avoid collisions; original filename preserved in metadata
- Schema: `documents` table (id, entity_type, entity_id, filename, stored_filename, mime_type, file_size_bytes, description, uploaded_at)
- Documents CAN be truly deleted (they are supporting evidence, not financial data)

## MIGRATION PATTERN
Schema changes use raw SQL in db.rs init_db():
- Always use IF NOT EXISTS / ALTER TABLE with existence checks
- Never drop tables — append migrations
- Test migrations against both fresh and existing databases

## UI PATTERN
New pages follow this structure:
1. Component in src/components/
2. Registered in AppShell.tsx sidebar
3. Data fetched via api.ts in useEffect
4. Loading state while data fetches
5. Error state with retry button

## ACCOUNTING MODEL
- ASSET: debit increases, credit decreases
- LIABILITY: credit increases, debit decreases
- EQUITY: credit increases, debit decreases
- REVENUE: credit increases, debit decreases
- EXPENSE: debit increases, credit decreases

## GIT RULES
- Commit after every meaningful unit of work
- Commit message format: [PHASE X] description of what was done
- Run `npx vitest run` before every commit

## CONTEXT RULES
- Never print full file contents to terminal unless asked
- When running tests, only show the summary line and any failures
- Store verbose output to .logs/ directory, not terminal
- If context feels cluttered, re-read CLAUDE.md to reorient
