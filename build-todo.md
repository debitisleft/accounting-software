# Bookkeeping App — Build TODO

## RULES FOR CLAUDE CODE
- Complete and CHECK each phase before starting the next
- Run tests after every phase — do not proceed if tests fail
- All amounts stored as INTEGER CENTS — never floats
- Update the status of each task as you complete it: [ ] → [x]
- If a check fails, fix it before marking complete

---

## PHASE 1 — Project Scaffold
- [x] Initialize Tauri + React + TypeScript project
- [x] Install Drizzle ORM + better-sqlite3
- [x] Install Vitest for testing
- [x] Verify dev server runs with no errors
- [x] CHECK: `npm run dev` opens without console errors

## PHASE 2 — Database Schema
- [ ] Create schema.ts with accounts, transactions, journal_entries tables
- [ ] Add check constraint: SUM(debit) = SUM(credit) per transaction
- [ ] All monetary columns are INTEGER (cents), not REAL or FLOAT
- [ ] Run Drizzle migration
- [ ] Seed default chart of accounts (Assets, Liabilities, Equity, Revenue, Expenses)
- [ ] CHECK: Query seeded accounts — confirm at least 20 default accounts exist

## PHASE 3 — Accounting Engine
- [ ] Create /src/lib/accounting.ts
- [ ] Implement createTransaction() with balance validation
- [ ] Implement getAccountBalance() respecting normal balance side
- [ ] Implement getTrialBalance()
- [ ] Implement getIncomeStatement(startDate, endDate)
- [ ] Implement getBalanceSheet(asOfDate)
- [ ] CHECK: All functions exported and typed with no TypeScript errors

## PHASE 4 — Engine Unit Tests
- [ ] Write test: balanced transaction saves successfully
- [ ] Write test: unbalanced transaction throws typed error
- [ ] Write test: asset account balance increases on debit
- [ ] Write test: liability account balance increases on credit
- [ ] Write test: trial balance debits === trial balance credits
- [ ] Write test: income statement revenue - expenses = net income
- [ ] CHECK: `npx vitest run` — ALL tests must pass before Phase 5

## PHASE 5 — Core UI Components
- [ ] AccountsListPage.tsx — list all accounts with current balance
- [ ] JournalEntryForm.tsx — multi-row entry with live balance indicator
- [ ] Balance indicator turns green only when debits === credits
- [ ] Save button disabled until entries balance
- [ ] Dollar input converts to cents on submit
- [ ] CHECK: Manually enter a sample transaction and verify it saves

## PHASE 6 — Reports
- [ ] TrialBalance.tsx — all accounts, debit/credit columns
- [ ] IncomeStatement.tsx — date range picker, revenue/expense breakdown
- [ ] BalanceSheet.tsx — assets = liabilities + equity verification
- [ ] Each report shows "Out of Balance" warning if equation breaks
- [ ] CHECK: Reports render with seeded/test data without crashing

## PHASE 7 — Final Integration Check
- [ ] Enter 5 real-world transactions (sales, expense, owner equity, bill payment, bank deposit)
- [ ] Verify trial balance balances
- [ ] Verify balance sheet equation holds
- [ ] Verify income statement net income matches equity change
- [ ] CHECK: No TypeScript errors (`npx tsc --noEmit`)
- [ ] CHECK: All Vitest tests still passing

---
## CURRENT PHASE: 2
## LAST COMPLETED CHECK: Phase 1 — npm run check passes (2026-04-05)
## BLOCKING ISSUES: None