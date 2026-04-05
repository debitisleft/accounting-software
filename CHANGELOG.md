# Bookkeeping App — Changelog

## STATUS: Phase 3 — Complete

## COMPLETED

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