import { describe, it, expect, beforeEach } from 'vitest'
import { BookkeepingDatabase } from '../db/index'
import { seedDefaultAccounts } from '../db/seed'
import {
  createTransaction,
  getTrialBalance,
  getIncomeStatement,
  getBalanceSheet,
  getAccountBalance,
} from '../lib/accounting'

let testDbCounter = 0

async function setupTestDb(): Promise<BookkeepingDatabase> {
  testDbCounter++
  const database = new BookkeepingDatabase(`TestDB_integration_${testDbCounter}`)
  await seedDefaultAccounts(database)
  return database
}

async function findAccount(database: BookkeepingDatabase, code: string) {
  const acct = (await database.accounts.toArray()).find((a) => a.code === code)
  if (!acct) throw new Error(`Account ${code} not found`)
  return acct
}

describe('Phase 7 — Final Integration', () => {
  let database: BookkeepingDatabase

  beforeEach(async () => {
    database = await setupTestDb()

    const cash = await findAccount(database, '1000')
    const checking = await findAccount(database, '1010')
    const ownerEquity = await findAccount(database, '3000')
    const salesRevenue = await findAccount(database, '4000')
    const rent = await findAccount(database, '5100')
    const wages = await findAccount(database, '5300')
    const ap = await findAccount(database, '2000')

    // Transaction 1: Owner invests $10,000 cash
    await createTransaction(database, {
      date: '2026-01-01',
      description: 'Owner investment - startup capital',
      entries: [
        { accountId: cash.id!, debit: 1000000, credit: 0 },
        { accountId: ownerEquity.id!, debit: 0, credit: 1000000 },
      ],
    })

    // Transaction 2: Cash sale of goods for $2,500
    await createTransaction(database, {
      date: '2026-01-15',
      description: 'Cash sale of goods',
      entries: [
        { accountId: checking.id!, debit: 250000, credit: 0 },
        { accountId: salesRevenue.id!, debit: 0, credit: 250000 },
      ],
    })

    // Transaction 3: Pay rent $1,200
    await createTransaction(database, {
      date: '2026-01-20',
      description: 'Monthly rent payment',
      entries: [
        { accountId: rent.id!, debit: 120000, credit: 0 },
        { accountId: cash.id!, debit: 0, credit: 120000 },
      ],
    })

    // Transaction 4: Receive bill for repair $800 on credit
    await createTransaction(database, {
      date: '2026-01-25',
      description: 'Equipment repair bill - to be paid later',
      entries: [
        { accountId: wages.id!, debit: 80000, credit: 0 },
        { accountId: ap.id!, debit: 0, credit: 80000 },
      ],
    })

    // Transaction 5: Bank deposit from customer $3,000
    await createTransaction(database, {
      date: '2026-01-28',
      description: 'Customer payment deposited to bank',
      entries: [
        { accountId: checking.id!, debit: 300000, credit: 0 },
        { accountId: salesRevenue.id!, debit: 0, credit: 300000 },
      ],
    })
  })

  it('enters 5 real-world transactions successfully', async () => {
    const tb = await getTrialBalance(database)
    expect(tb.rows.length).toBeGreaterThan(0)
  })

  it('trial balance balances (total debits === total credits)', async () => {
    const tb = await getTrialBalance(database)

    expect(tb.totalDebit).toBe(tb.totalCredit)
    expect(tb.totalDebit).toBeGreaterThan(0)

    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow).toBeDefined()
    expect(cashRow!.debit).toBe(880000)
  })

  it('balance sheet equation holds: assets = liabilities + equity', async () => {
    const bs = await getBalanceSheet(database, '2026-01-31')

    expect(bs.isBalanced).toBe(true)
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.equity.total)
    expect(bs.assets.total).toBe(1430000)
    expect(bs.liabilities.total).toBe(80000)
    expect(bs.equity.total).toBe(1350000)
  })

  it('income statement net income matches equity change', async () => {
    const is = await getIncomeStatement(database, '2026-01-01', '2026-01-31')

    expect(is.revenue.total).toBe(550000)
    expect(is.expenses.total).toBe(200000)
    expect(is.netIncome).toBe(350000)
    expect(is.netIncome).toBe(is.revenue.total - is.expenses.total)

    const bs = await getBalanceSheet(database, '2026-01-31')
    const ownerEquityBalance = await getAccountBalance(
      database,
      (await findAccount(database, '3000')).id!,
    )
    const netIncomeFromBS = bs.equity.total - ownerEquityBalance.balance
    expect(netIncomeFromBS).toBe(is.netIncome)
  })

  it('all amounts are integer cents (no floating point)', async () => {
    const tb = await getTrialBalance(database)
    for (const row of tb.rows) {
      expect(Number.isInteger(row.debit)).toBe(true)
      expect(Number.isInteger(row.credit)).toBe(true)
    }

    const bs = await getBalanceSheet(database, '2026-01-31')
    expect(Number.isInteger(bs.assets.total)).toBe(true)
    expect(Number.isInteger(bs.liabilities.total)).toBe(true)
    expect(Number.isInteger(bs.equity.total)).toBe(true)
  })
})
