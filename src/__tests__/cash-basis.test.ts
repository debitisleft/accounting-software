import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 29 — Accrual vs Cash Basis Reporting', () => {
  let mock: MockApi
  let cash: string
  let ar: string
  let revenue: string
  let rent: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    ar = accounts.find((a) => a.code === '1100')!.id
    revenue = accounts.find((a) => a.code === '4000')!.id
    rent = accounts.find((a) => a.code === '5100')!.id

    // Cash sale: revenue + cash
    mock.createTransaction({
      date: '2026-03-01', description: 'Cash sale',
      entries: [
        { account_id: cash, debit: 100000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 100000 },
      ],
    })
    // Accrual sale: revenue + AR (no cash)
    mock.createTransaction({
      date: '2026-04-01', description: 'Accrual sale',
      entries: [
        { account_id: ar, debit: 50000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 50000 },
      ],
    })
    // Cash rent payment
    mock.createTransaction({
      date: '2026-05-01', description: 'Rent payment',
      entries: [
        { account_id: rent, debit: 80000, credit: 0 },
        { account_id: cash, debit: 0, credit: 80000 },
      ],
    })
  })

  it('accrual income statement includes all revenue/expense', () => {
    const is = mock.getIncomeStatement('2026-01-01', '2026-12-31')
    expect(is.total_revenue).toBe(150000) // 100k + 50k
    expect(is.total_expenses).toBe(80000)
    expect(is.net_income).toBe(70000)
  })

  it('cash basis income statement excludes entries without cash leg', () => {
    const is = mock.getIncomeStatement('2026-01-01', '2026-12-31', undefined, 'CASH')
    // Cash sale (100k) included — has cash entry
    // Accrual sale (50k) excluded — no cash entry
    expect(is.total_revenue).toBe(100000)
    expect(is.total_expenses).toBe(80000) // rent has cash leg
    expect(is.net_income).toBe(20000)
  })

  it('switching basis changes totals correctly', () => {
    const accrual = mock.getIncomeStatement('2026-01-01', '2026-12-31')
    const cashBasis = mock.getIncomeStatement('2026-01-01', '2026-12-31', undefined, 'CASH')

    expect(accrual.total_revenue).toBeGreaterThan(cashBasis.total_revenue)
    expect(accrual.net_income).toBeGreaterThan(cashBasis.net_income)
    // Expenses are the same since rent payment has cash leg
    expect(accrual.total_expenses).toBe(cashBasis.total_expenses)
  })
})
