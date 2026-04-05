import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { accounts } from '../db/schema'
import { migrateDatabase } from '../db/migrate'
import { seedDefaultAccounts } from '../db/seed'
import {
  createTransaction,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  getAccountBalance,
} from '../lib/accounting'
import type { AppDatabase } from '../db/connection'

function setupTestDb(): AppDatabase {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  migrateDatabase(sqlite)
  const db = drizzle(sqlite, { schema })
  seedDefaultAccounts(db)
  return db
}

function findAccount(db: AppDatabase, code: string) {
  const acct = db.select().from(accounts).all().find((a) => a.code === code)
  if (!acct) throw new Error(`Account ${code} not found`)
  return acct
}

describe('Phase 7 — Final Integration', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = setupTestDb()

    const cash = findAccount(db, '1000')         // ASSET - Cash
    const checking = findAccount(db, '1010')     // ASSET - Checking Account
    const ar = findAccount(db, '1100')           // ASSET - Accounts Receivable
    const equipment = findAccount(db, '1500')    // ASSET - Equipment
    const ap = findAccount(db, '2000')           // LIABILITY - Accounts Payable
    const ownerEquity = findAccount(db, '3000')  // EQUITY - Owner's Equity
    const salesRevenue = findAccount(db, '4000') // REVENUE - Sales Revenue
    const rent = findAccount(db, '5100')         // EXPENSE - Rent Expense
    const wages = findAccount(db, '5300')        // EXPENSE - Wages Expense

    // Transaction 1: Owner invests $10,000 cash into the business
    createTransaction(db, {
      date: '2026-01-01',
      description: 'Owner investment - startup capital',
      entries: [
        { accountId: cash.id, debit: 1000000, credit: 0 },
        { accountId: ownerEquity.id, debit: 0, credit: 1000000 },
      ],
    })

    // Transaction 2: Cash sale of goods for $2,500
    createTransaction(db, {
      date: '2026-01-15',
      description: 'Cash sale of goods',
      entries: [
        { accountId: checking.id, debit: 250000, credit: 0 },
        { accountId: salesRevenue.id, debit: 0, credit: 250000 },
      ],
    })

    // Transaction 3: Pay rent $1,200
    createTransaction(db, {
      date: '2026-01-20',
      description: 'Monthly rent payment',
      entries: [
        { accountId: rent.id, debit: 120000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 120000 },
      ],
    })

    // Transaction 4: Receive bill for equipment repair $800 (on credit)
    createTransaction(db, {
      date: '2026-01-25',
      description: 'Equipment repair bill - to be paid later',
      entries: [
        { accountId: wages.id, debit: 80000, credit: 0 },
        { accountId: ap.id, debit: 0, credit: 80000 },
      ],
    })

    // Transaction 5: Bank deposit from customer who owed $3,000
    createTransaction(db, {
      date: '2026-01-28',
      description: 'Customer payment deposited to bank',
      entries: [
        { accountId: checking.id, debit: 300000, credit: 0 },
        { accountId: salesRevenue.id, debit: 0, credit: 300000 },
      ],
    })
  })

  it('enters 5 real-world transactions successfully', () => {
    // All 5 transactions created in beforeEach without throwing
    const tb = getTrialBalance(db)
    expect(tb.rows.length).toBeGreaterThan(0)
  })

  it('trial balance balances (total debits === total credits)', () => {
    const tb = getTrialBalance(db)

    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)

    // Verify specific balances
    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow).toBeDefined()
    // Cash: 1,000,000 debit - 120,000 credit = 880,000
    expect(cashRow!.debit).toBe(880000)
  })

  it('balance sheet equation holds: assets = liabilities + equity', () => {
    const bs = getBalanceSheet(db, '2026-01-31')

    expect(bs.isBalanced).toBe(true)
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.equity.total)

    // Verify specific amounts:
    // Assets: Cash 880000 + Checking 550000 = 1430000
    expect(bs.assets.total).toBe(1430000)
    // Liabilities: AP 80000
    expect(bs.liabilities.total).toBe(80000)
    // Equity: Owner's Equity 1000000 + Net Income (550000 - 200000 = 350000) = 1350000
    expect(bs.equity.total).toBe(1350000)
    // 1430000 = 80000 + 1350000 ✓
  })

  it('income statement net income matches equity change', () => {
    const is = getIncomeStatement(db, '2026-01-01', '2026-01-31')

    // Revenue: 250000 + 300000 = 550000
    expect(is.revenue.total).toBe(550000)
    // Expenses: rent 120000 + wages 80000 = 200000
    expect(is.expenses.total).toBe(200000)
    // Net income: 550000 - 200000 = 350000
    expect(is.netIncome).toBe(350000)
    expect(is.netIncome).toBe(is.revenue.total - is.expenses.total)

    // Verify this matches equity change in balance sheet
    const bs = getBalanceSheet(db, '2026-01-31')
    const ownerEquityBalance = getAccountBalance(
      db,
      findAccount(db, '3000').id,
    )
    // Net income should be: total equity - owner's direct equity
    const netIncomeFromBS = bs.equity.total - ownerEquityBalance.balance
    expect(netIncomeFromBS).toBe(is.netIncome)
  })

  it('all amounts are integer cents (no floating point)', () => {
    const tb = getTrialBalance(db)
    for (const row of tb.rows) {
      expect(Number.isInteger(row.debit)).toBe(true)
      expect(Number.isInteger(row.credit)).toBe(true)
    }

    const bs = getBalanceSheet(db, '2026-01-31')
    expect(Number.isInteger(bs.assets.total)).toBe(true)
    expect(Number.isInteger(bs.liabilities.total)).toBe(true)
    expect(Number.isInteger(bs.equity.total)).toBe(true)
  })
})
