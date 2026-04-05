# Bookkeeping App — Changelog

## STATUS: ALL PHASES COMPLETE

## COMPLETED

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

## KNOWN ISSUES
(none)