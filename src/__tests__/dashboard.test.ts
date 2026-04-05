import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 9 — Dashboard & App Metadata', () => {
  let mock: MockApi

  function findAccount(code: string) {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('get_app_metadata returns version and db path', () => {
    const meta = mock.getAppMetadata()
    expect(meta.version).toBeTruthy()
    expect(meta.db_path).toBeTruthy()
    expect(meta.last_backup_date).toBeNull()
  })

  it('get_dashboard_summary returns correct totals', () => {
    const cash = findAccount('1000')
    const equity = findAccount('3000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    // Owner invests $5,000
    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})
    // Revenue $2,000
    mock.createTransaction({ date: '2026-01-15', description: 'Sale', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ]})
    // Rent $800
    mock.createTransaction({ date: '2026-01-20', description: 'Rent', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})

    const summary = mock.getDashboardSummary()

    expect(summary.total_assets).toBe(620000)       // Cash: 500000 + 200000 - 80000
    expect(summary.total_liabilities).toBe(0)
    expect(summary.total_revenue).toBe(200000)
    expect(summary.total_expenses).toBe(80000)
    expect(summary.net_income).toBe(120000)          // 200000 - 80000
    expect(summary.total_equity).toBe(620000)        // Owner 500000 + net income 120000
    expect(summary.transaction_count).toBe(3)
    expect(summary.recent_transactions.length).toBe(3)
  })

  it('summary totals match individual report calculations', () => {
    const cash = findAccount('1000')
    const equity = findAccount('3000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')
    const ap = findAccount('2000')

    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 1000000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 1000000 },
    ]})
    mock.createTransaction({ date: '2026-02-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 300000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 300000 },
    ]})
    mock.createTransaction({ date: '2026-02-15', description: 'Rent on credit', entries: [
      { account_id: rent.id, debit: 150000, credit: 0 },
      { account_id: ap.id, debit: 0, credit: 150000 },
    ]})

    const summary = mock.getDashboardSummary()
    const bs = mock.getBalanceSheet('9999-12-31')
    const is = mock.getIncomeStatement('0000-01-01', '9999-12-31')

    expect(summary.total_assets).toBe(bs.total_assets)
    expect(summary.total_liabilities).toBe(bs.total_liabilities)
    expect(summary.total_equity).toBe(bs.total_equity)
    expect(summary.total_revenue).toBe(is.total_revenue)
    expect(summary.total_expenses).toBe(is.total_expenses)
    expect(summary.net_income).toBe(is.net_income)
  })

  it('dashboard with no transactions returns zeros', () => {
    const summary = mock.getDashboardSummary()
    expect(summary.total_assets).toBe(0)
    expect(summary.total_liabilities).toBe(0)
    expect(summary.total_equity).toBe(0)
    expect(summary.total_revenue).toBe(0)
    expect(summary.total_expenses).toBe(0)
    expect(summary.net_income).toBe(0)
    expect(summary.transaction_count).toBe(0)
    expect(summary.recent_transactions.length).toBe(0)
  })
})
