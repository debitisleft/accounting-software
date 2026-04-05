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
- Period locks are hard — no Rust command may modify transactions in a locked period, regardless of what the UI sends
- Standard `.sqlite` format only — no proprietary extensions, no encryption barriers, no lock-in

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
