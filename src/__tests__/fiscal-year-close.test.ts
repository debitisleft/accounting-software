import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 22 — Fiscal Year Close', () => {
  let mock: MockApi
  let cash: string
  let revenue: string
  let serviceRev: string
  let rent: string
  let wages: string
  let retainedEarnings: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    revenue = accounts.find((a) => a.code === '4000')!.id
    serviceRev = accounts.find((a) => a.code === '4100')!.id
    rent = accounts.find((a) => a.code === '5100')!.id
    wages = accounts.find((a) => a.code === '5300')!.id
    retainedEarnings = accounts.find((a) => a.code === '3200')!.id

    // Create some revenue and expense transactions for the year
    mock.createTransaction({
      date: '2026-03-15', description: 'Sales',
      entries: [
        { account_id: cash, debit: 500000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 500000 },
      ],
    })
    mock.createTransaction({
      date: '2026-06-01', description: 'Service revenue',
      entries: [
        { account_id: cash, debit: 200000, credit: 0 },
        { account_id: serviceRev, debit: 0, credit: 200000 },
      ],
    })
    mock.createTransaction({
      date: '2026-04-01', description: 'Rent',
      entries: [
        { account_id: rent, debit: 120000, credit: 0 },
        { account_id: cash, debit: 0, credit: 120000 },
      ],
    })
    mock.createTransaction({
      date: '2026-08-15', description: 'Wages',
      entries: [
        { account_id: wages, debit: 300000, credit: 0 },
        { account_id: cash, debit: 0, credit: 300000 },
      ],
    })
  })

  it('close_fiscal_year creates correct closing entry', () => {
    const result = mock.closeFiscalYear('2026-12-31')
    expect(result.transaction_id).toBeDefined()
    expect(result.net_income).toBe(280000) // 700000 revenue - 420000 expenses

    const tx = mock.getTransactionDetail(result.transaction_id)
    expect(tx.journal_type).toBe('CLOSING')
    expect(tx.date).toBe('2026-12-31')

    // Verify entry balances
    const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = tx.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalDebit).toBe(totalCredit)
  })

  it('closing entry zeroes all revenue accounts for the period', () => {
    mock.closeFiscalYear('2026-12-31')

    // After closing, revenue accounts should be zero
    expect(mock.getAccountBalance(revenue)).toBe(0)
    expect(mock.getAccountBalance(serviceRev)).toBe(0)
  })

  it('closing entry zeroes all expense accounts for the period', () => {
    mock.closeFiscalYear('2026-12-31')

    expect(mock.getAccountBalance(rent)).toBe(0)
    expect(mock.getAccountBalance(wages)).toBe(0)
  })

  it('net income transfers to retained earnings', () => {
    const reBefore = mock.getAccountBalance(retainedEarnings)
    const result = mock.closeFiscalYear('2026-12-31')
    const reAfter = mock.getAccountBalance(retainedEarnings)

    expect(reAfter - reBefore).toBe(result.net_income)
  })

  it('closing entry has journal_type = CLOSING', () => {
    const result = mock.closeFiscalYear('2026-12-31')
    const tx = mock.getTransactionDetail(result.transaction_id)
    expect(tx.journal_type).toBe('CLOSING')
  })

  it('period is locked after closing', () => {
    mock.closeFiscalYear('2026-12-31')
    expect(mock.isDateLocked('2026-12-31')).toBe(true)
    expect(mock.isDateLocked('2026-06-15')).toBe(true)
  })

  it('cannot close the same fiscal year twice', () => {
    mock.closeFiscalYear('2026-12-31')
    expect(() => mock.closeFiscalYear('2026-12-31')).toThrow('Fiscal year already closed')
  })

  it('balance sheet shows retained earnings separate from current net income', () => {
    // Before closing — retained earnings is 0, net income shows as income
    const bsBefore = mock.getBalanceSheet('2026-12-31')
    expect(bsBefore.is_balanced).toBe(true)

    // After closing — retained earnings has the net income
    mock.closeFiscalYear('2026-12-31')
    const bsAfter = mock.getBalanceSheet('2026-12-31')
    expect(bsAfter.is_balanced).toBe(true)

    const reItem = bsAfter.equity.find((e) => e.code === '3200')
    expect(reItem).toBeDefined()
    expect(reItem!.balance).toBe(280000) // net income transferred
  })

  it('income statement excludes closing entries by default', () => {
    mock.closeFiscalYear('2026-12-31')

    // With closing entries excluded, should still show revenue/expense
    const isExcluding = mock.getIncomeStatement('2026-01-01', '2026-12-31', ['CLOSING'])
    expect(isExcluding.total_revenue).toBe(700000)
    expect(isExcluding.total_expenses).toBe(420000)

    // Including closing entries, everything zeroes out
    const isIncluding = mock.getIncomeStatement('2026-01-01', '2026-12-31')
    expect(isIncluding.total_revenue).toBe(0) // closing entries zero it
    expect(isIncluding.total_expenses).toBe(0)
  })

  it('list_fiscal_year_closes returns history', () => {
    mock.closeFiscalYear('2026-12-31')
    const closes = mock.listFiscalYearCloses()
    expect(closes.length).toBe(1)
    expect(closes[0].date).toBe('2026-12-31')
    expect(closes[0].net_income).toBe(280000)
  })
})
