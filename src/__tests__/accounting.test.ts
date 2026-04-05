import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { accounts } from '../db/schema'
import { migrateDatabase } from '../db/migrate'
import { seedDefaultAccounts } from '../db/seed'
import {
  createTransaction,
  getAccountBalance,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  UnbalancedTransactionError,
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

describe('accounting engine', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = setupTestDb()
  })

  // ── createTransaction ────────────────────────────────

  it('balanced transaction saves successfully', () => {
    const cash = findAccount(db, '1000')       // ASSET
    const revenue = findAccount(db, '4000')    // REVENUE

    const txId = createTransaction(db, {
      date: '2026-01-15',
      description: 'Sale of goods',
      entries: [
        { accountId: cash.id, debit: 50000, credit: 0 },       // $500.00
        { accountId: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    expect(txId).toBeGreaterThan(0)
  })

  it('unbalanced transaction throws typed error', () => {
    const cash = findAccount(db, '1000')
    const revenue = findAccount(db, '4000')

    expect(() => {
      createTransaction(db, {
        date: '2026-01-15',
        description: 'Bad transaction',
        entries: [
          { accountId: cash.id, debit: 50000, credit: 0 },
          { accountId: revenue.id, debit: 0, credit: 30000 },
        ],
      })
    }).toThrow(UnbalancedTransactionError)
  })

  // ── getAccountBalance ────────────────────────────────

  it('asset account balance increases on debit', () => {
    const cash = findAccount(db, '1000')       // ASSET
    const equity = findAccount(db, '3000')     // EQUITY

    // Owner invests $1,000: debit Cash, credit Owner's Equity
    createTransaction(db, {
      date: '2026-01-01',
      description: 'Owner investment',
      entries: [
        { accountId: cash.id, debit: 100000, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 100000 },
      ],
    })

    const balance = getAccountBalance(db, cash.id)
    expect(balance.balance).toBe(100000) // $1,000.00 positive (debit normal)
  })

  it('liability account balance increases on credit', () => {
    const cash = findAccount(db, '1000')       // ASSET
    const ap = findAccount(db, '2000')         // LIABILITY - Accounts Payable

    // Buy supplies on credit: debit Cash (nope, debit Supplies), credit AP
    // Actually: receive a bill - debit expense, credit AP
    const supplies = findAccount(db, '5400')   // EXPENSE - Office Supplies

    createTransaction(db, {
      date: '2026-01-10',
      description: 'Bought supplies on credit',
      entries: [
        { accountId: supplies.id, debit: 25000, credit: 0 },
        { accountId: ap.id, debit: 0, credit: 25000 },
      ],
    })

    const balance = getAccountBalance(db, ap.id)
    expect(balance.balance).toBe(25000) // $250.00 positive (credit normal)
  })

  // ── getTrialBalance ──────────────────────────────────

  it('trial balance debits === trial balance credits', () => {
    const cash = findAccount(db, '1000')
    const revenue = findAccount(db, '4000')
    const rent = findAccount(db, '5100')
    const ap = findAccount(db, '2000')

    // Transaction 1: Sale $500
    createTransaction(db, {
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { accountId: cash.id, debit: 50000, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    // Transaction 2: Rent $200
    createTransaction(db, {
      date: '2026-01-20',
      description: 'Rent payment',
      entries: [
        { accountId: rent.id, debit: 20000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 20000 },
      ],
    })

    const tb = getTrialBalance(db)
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)
  })

  // ── getIncomeStatement ───────────────────────────────

  it('income statement revenue - expenses = net income', () => {
    const cash = findAccount(db, '1000')
    const revenue = findAccount(db, '4000')
    const rent = findAccount(db, '5100')
    const wages = findAccount(db, '5300')

    // Revenue: $1,000
    createTransaction(db, {
      date: '2026-03-01',
      description: 'March sales',
      entries: [
        { accountId: cash.id, debit: 100000, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    // Rent: $300
    createTransaction(db, {
      date: '2026-03-05',
      description: 'March rent',
      entries: [
        { accountId: rent.id, debit: 30000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 30000 },
      ],
    })

    // Wages: $400
    createTransaction(db, {
      date: '2026-03-15',
      description: 'March wages',
      entries: [
        { accountId: wages.id, debit: 40000, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 40000 },
      ],
    })

    const is = getIncomeStatement(db, '2026-03-01', '2026-03-31')

    expect(is.revenue.total).toBe(100000)    // $1,000
    expect(is.expenses.total).toBe(70000)    // $700
    expect(is.netIncome).toBe(30000)         // $300
    expect(is.netIncome).toBe(is.revenue.total - is.expenses.total)
  })

  // ── getBalanceSheet ──────────────────────────────────

  it('balance sheet: assets = liabilities + equity', () => {
    const cash = findAccount(db, '1000')
    const equity = findAccount(db, '3000')
    const revenue = findAccount(db, '4000')
    const rent = findAccount(db, '5100')
    const ap = findAccount(db, '2000')

    // Owner invests $5,000
    createTransaction(db, {
      date: '2026-01-01',
      description: 'Owner investment',
      entries: [
        { accountId: cash.id, debit: 500000, credit: 0 },
        { accountId: equity.id, debit: 0, credit: 500000 },
      ],
    })

    // Sale $2,000
    createTransaction(db, {
      date: '2026-01-15',
      description: 'Service revenue',
      entries: [
        { accountId: cash.id, debit: 200000, credit: 0 },
        { accountId: revenue.id, debit: 0, credit: 200000 },
      ],
    })

    // Rent $800 on credit
    createTransaction(db, {
      date: '2026-01-20',
      description: 'Rent accrued',
      entries: [
        { accountId: rent.id, debit: 80000, credit: 0 },
        { accountId: ap.id, debit: 0, credit: 80000 },
      ],
    })

    const bs = getBalanceSheet(db, '2026-01-31')

    // Assets: Cash = 500000 + 200000 = 700000
    expect(bs.assets.total).toBe(700000)
    // Liabilities: AP = 80000
    expect(bs.liabilities.total).toBe(80000)
    // Equity: Owner's Equity 500000 + Net Income (200000 - 80000 = 120000) = 620000
    expect(bs.equity.total).toBe(620000)
    // A = L + E
    expect(bs.isBalanced).toBe(true)
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.equity.total)
  })
})
