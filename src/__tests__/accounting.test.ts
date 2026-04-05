import { describe, it, expect, beforeEach } from 'vitest'
import { BookkeepingDatabase } from '../db/index'
import { seedDefaultAccounts } from '../db/seed'
import {
  createTransaction,
  getAccountBalance,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  UnbalancedTransactionError,
} from '../lib/accounting'

let testDbCounter = 0

async function setupTestDb(): Promise<BookkeepingDatabase> {
  testDbCounter++
  const database = new BookkeepingDatabase(`TestDB_accounting_${testDbCounter}`)
  await seedDefaultAccounts(database)
  return database
}

async function findAccount(database: BookkeepingDatabase, code: string) {
  const acct = (await database.accounts.toArray()).find((a) => a.code === code)
  if (!acct) throw new Error(`Account ${code} not found`)
  return acct
}

describe('accounting engine', () => {
  let database: BookkeepingDatabase

  beforeEach(async () => {
    database = await setupTestDb()
  })

  // ── createTransaction ────────────────────────────────

  it('balanced transaction saves successfully', async () => {
    const cash = await findAccount(database, '1000')
    const revenue = await findAccount(database, '4000')

    const txId = await createTransaction(database, {
      date: '2026-01-15',
      description: 'Sale of goods',
      entries: [
        { accountId: cash.id!, debit: 50000, credit: 0 },
        { accountId: revenue.id!, debit: 0, credit: 50000 },
      ],
    })

    expect(txId).toBeGreaterThan(0)
  })

  it('unbalanced transaction throws typed error', async () => {
    const cash = await findAccount(database, '1000')
    const revenue = await findAccount(database, '4000')

    await expect(
      createTransaction(database, {
        date: '2026-01-15',
        description: 'Bad transaction',
        entries: [
          { accountId: cash.id!, debit: 50000, credit: 0 },
          { accountId: revenue.id!, debit: 0, credit: 30000 },
        ],
      }),
    ).rejects.toThrow(UnbalancedTransactionError)
  })

  // ── getAccountBalance ────────────────────────────────

  it('asset account balance increases on debit', async () => {
    const cash = await findAccount(database, '1000')
    const equity = await findAccount(database, '3000')

    await createTransaction(database, {
      date: '2026-01-01',
      description: 'Owner investment',
      entries: [
        { accountId: cash.id!, debit: 100000, credit: 0 },
        { accountId: equity.id!, debit: 0, credit: 100000 },
      ],
    })

    const balance = await getAccountBalance(database, cash.id!)
    expect(balance.balance).toBe(100000)
  })

  it('liability account balance increases on credit', async () => {
    const supplies = await findAccount(database, '5400')
    const ap = await findAccount(database, '2000')

    await createTransaction(database, {
      date: '2026-01-10',
      description: 'Bought supplies on credit',
      entries: [
        { accountId: supplies.id!, debit: 25000, credit: 0 },
        { accountId: ap.id!, debit: 0, credit: 25000 },
      ],
    })

    const balance = await getAccountBalance(database, ap.id!)
    expect(balance.balance).toBe(25000)
  })

  // ── getTrialBalance ──────────────────────────────────

  it('trial balance debits === trial balance credits', async () => {
    const cash = await findAccount(database, '1000')
    const revenue = await findAccount(database, '4000')
    const rent = await findAccount(database, '5100')

    await createTransaction(database, {
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { accountId: cash.id!, debit: 50000, credit: 0 },
        { accountId: revenue.id!, debit: 0, credit: 50000 },
      ],
    })

    await createTransaction(database, {
      date: '2026-01-20',
      description: 'Rent payment',
      entries: [
        { accountId: rent.id!, debit: 20000, credit: 0 },
        { accountId: cash.id!, debit: 0, credit: 20000 },
      ],
    })

    const tb = await getTrialBalance(database)
    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)
  })

  // ── getIncomeStatement ───────────────────────────────

  it('income statement revenue - expenses = net income', async () => {
    const cash = await findAccount(database, '1000')
    const revenue = await findAccount(database, '4000')
    const rent = await findAccount(database, '5100')
    const wages = await findAccount(database, '5300')

    await createTransaction(database, {
      date: '2026-03-01',
      description: 'March sales',
      entries: [
        { accountId: cash.id!, debit: 100000, credit: 0 },
        { accountId: revenue.id!, debit: 0, credit: 100000 },
      ],
    })

    await createTransaction(database, {
      date: '2026-03-05',
      description: 'March rent',
      entries: [
        { accountId: rent.id!, debit: 30000, credit: 0 },
        { accountId: cash.id!, debit: 0, credit: 30000 },
      ],
    })

    await createTransaction(database, {
      date: '2026-03-15',
      description: 'March wages',
      entries: [
        { accountId: wages.id!, debit: 40000, credit: 0 },
        { accountId: cash.id!, debit: 0, credit: 40000 },
      ],
    })

    const is = await getIncomeStatement(database, '2026-03-01', '2026-03-31')

    expect(is.revenue.total).toBe(100000)
    expect(is.expenses.total).toBe(70000)
    expect(is.netIncome).toBe(30000)
    expect(is.netIncome).toBe(is.revenue.total - is.expenses.total)
  })

  // ── getBalanceSheet ──────────────────────────────────

  it('balance sheet: assets = liabilities + equity', async () => {
    const cash = await findAccount(database, '1000')
    const equity = await findAccount(database, '3000')
    const revenue = await findAccount(database, '4000')
    const rent = await findAccount(database, '5100')
    const ap = await findAccount(database, '2000')

    await createTransaction(database, {
      date: '2026-01-01',
      description: 'Owner investment',
      entries: [
        { accountId: cash.id!, debit: 500000, credit: 0 },
        { accountId: equity.id!, debit: 0, credit: 500000 },
      ],
    })

    await createTransaction(database, {
      date: '2026-01-15',
      description: 'Service revenue',
      entries: [
        { accountId: cash.id!, debit: 200000, credit: 0 },
        { accountId: revenue.id!, debit: 0, credit: 200000 },
      ],
    })

    await createTransaction(database, {
      date: '2026-01-20',
      description: 'Rent accrued',
      entries: [
        { accountId: rent.id!, debit: 80000, credit: 0 },
        { accountId: ap.id!, debit: 0, credit: 80000 },
      ],
    })

    const bs = await getBalanceSheet(database, '2026-01-31')

    expect(bs.assets.total).toBe(700000)
    expect(bs.liabilities.total).toBe(80000)
    expect(bs.equity.total).toBe(620000)
    expect(bs.isBalanced).toBe(true)
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.equity.total)
  })
})
