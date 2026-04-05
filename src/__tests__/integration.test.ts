import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 7 — Final Integration', () => {
  let mock: MockApi

  function findAccount(code: string) {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)

    const cash = findAccount('1000')
    const checking = findAccount('1010')
    const ownerEquity = findAccount('3000')
    const salesRevenue = findAccount('4000')
    const rent = findAccount('5100')
    const wages = findAccount('5300')
    const ap = findAccount('2000')

    // 1. Owner invests $10,000
    mock.createTransaction({ date: '2026-01-01', description: 'Owner investment', entries: [
      { account_id: cash.id, debit: 1000000, credit: 0 },
      { account_id: ownerEquity.id, debit: 0, credit: 1000000 },
    ]})
    // 2. Cash sale $2,500
    mock.createTransaction({ date: '2026-01-15', description: 'Cash sale', entries: [
      { account_id: checking.id, debit: 250000, credit: 0 },
      { account_id: salesRevenue.id, debit: 0, credit: 250000 },
    ]})
    // 3. Pay rent $1,200
    mock.createTransaction({ date: '2026-01-20', description: 'Rent', entries: [
      { account_id: rent.id, debit: 120000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 120000 },
    ]})
    // 4. Bill on credit $800
    mock.createTransaction({ date: '2026-01-25', description: 'Repair bill', entries: [
      { account_id: wages.id, debit: 80000, credit: 0 },
      { account_id: ap.id, debit: 0, credit: 80000 },
    ]})
    // 5. Bank deposit $3,000
    mock.createTransaction({ date: '2026-01-28', description: 'Customer deposit', entries: [
      { account_id: checking.id, debit: 300000, credit: 0 },
      { account_id: salesRevenue.id, debit: 0, credit: 300000 },
    ]})
  })

  it('enters 5 real-world transactions successfully', () => {
    const tb = mock.getTrialBalance()
    expect(tb.rows.length).toBeGreaterThan(0)
  })

  it('trial balance balances (total debits === total credits)', () => {
    const tb = mock.getTrialBalance()
    expect(tb.total_debits).toBe(tb.total_credits)
    expect(tb.is_balanced).toBe(true)
    expect(tb.total_debits).toBeGreaterThan(0)

    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow).toBeDefined()
    expect(cashRow!.debit).toBe(880000)
  })

  it('balance sheet equation holds: assets = liabilities + equity', () => {
    const bs = mock.getBalanceSheet('2026-01-31')
    expect(bs.is_balanced).toBe(true)
    expect(bs.total_assets).toBe(bs.total_liabilities + bs.total_equity)
    expect(bs.total_assets).toBe(1430000)
    expect(bs.total_liabilities).toBe(80000)
    expect(bs.total_equity).toBe(1350000)
  })

  it('income statement net income matches equity change', () => {
    const is = mock.getIncomeStatement('2026-01-01', '2026-01-31')
    expect(is.total_revenue).toBe(550000)
    expect(is.total_expenses).toBe(200000)
    expect(is.net_income).toBe(350000)
    expect(is.net_income).toBe(is.total_revenue - is.total_expenses)

    const bs = mock.getBalanceSheet('2026-01-31')
    const ownerEquityBalance = mock.getAccountBalance(findAccount('3000').id)
    const netIncomeFromBS = bs.total_equity - ownerEquityBalance
    expect(netIncomeFromBS).toBe(is.net_income)
  })

  it('all amounts are integer cents (no floating point)', () => {
    const tb = mock.getTrialBalance()
    for (const row of tb.rows) {
      expect(Number.isInteger(row.debit)).toBe(true)
      expect(Number.isInteger(row.credit)).toBe(true)
    }

    const bs = mock.getBalanceSheet('2026-01-31')
    expect(Number.isInteger(bs.total_assets)).toBe(true)
    expect(Number.isInteger(bs.total_liabilities)).toBe(true)
    expect(Number.isInteger(bs.total_equity)).toBe(true)
  })
})
