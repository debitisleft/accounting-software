import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('accounting engine', () => {
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

  it('balanced transaction saves successfully', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale of goods',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    expect(txId).toBeTruthy()
  })

  it('unbalanced transaction throws error', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    expect(() => {
      mock.createTransaction({
        date: '2026-01-15',
        description: 'Bad',
        entries: [
          { account_id: cash.id, debit: 50000, credit: 0 },
          { account_id: revenue.id, debit: 0, credit: 30000 },
        ],
      })
    }).toThrow('does not balance')
  })

  it('asset account balance increases on debit', () => {
    const cash = findAccount('1000')
    const equity = findAccount('3000')

    mock.createTransaction({
      date: '2026-01-01',
      description: 'Owner investment',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })

    expect(mock.getAccountBalance(cash.id)).toBe(100000)
  })

  it('liability account balance increases on credit', () => {
    const supplies = findAccount('5400')
    const ap = findAccount('2000')

    mock.createTransaction({
      date: '2026-01-10',
      description: 'Bought on credit',
      entries: [
        { account_id: supplies.id, debit: 25000, credit: 0 },
        { account_id: ap.id, debit: 0, credit: 25000 },
      ],
    })

    expect(mock.getAccountBalance(ap.id)).toBe(25000)
  })

  it('trial balance debits === trial balance credits', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    mock.createTransaction({
      date: '2026-01-20',
      description: 'Rent',
      entries: [
        { account_id: rent.id, debit: 20000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 20000 },
      ],
    })

    const tb = mock.getTrialBalance()
    expect(tb.total_debits).toBe(tb.total_credits)
    expect(tb.is_balanced).toBe(true)
    expect(tb.total_debits).toBeGreaterThan(0)
  })

  it('income statement revenue - expenses = net income', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')
    const wages = findAccount('5300')

    mock.createTransaction({ date: '2026-03-01', description: 'Sales', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 100000 },
    ]})
    mock.createTransaction({ date: '2026-03-05', description: 'Rent', entries: [
      { account_id: rent.id, debit: 30000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 30000 },
    ]})
    mock.createTransaction({ date: '2026-03-15', description: 'Wages', entries: [
      { account_id: wages.id, debit: 40000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 40000 },
    ]})

    const is = mock.getIncomeStatement('2026-03-01', '2026-03-31')
    expect(is.total_revenue).toBe(100000)
    expect(is.total_expenses).toBe(70000)
    expect(is.net_income).toBe(30000)
    expect(is.net_income).toBe(is.total_revenue - is.total_expenses)
  })

  it('balance sheet: assets = liabilities + equity', () => {
    const cash = findAccount('1000')
    const equity = findAccount('3000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')
    const ap = findAccount('2000')

    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2026-01-15', description: 'Revenue', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2026-01-20', description: 'Rent accrued', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: ap.id, debit: 0, credit: 80000 },
    ]})

    const bs = mock.getBalanceSheet('2026-01-31')
    expect(bs.total_assets).toBe(700000)
    expect(bs.total_liabilities).toBe(80000)
    expect(bs.total_equity).toBe(620000)
    expect(bs.is_balanced).toBe(true)
    expect(bs.total_assets).toBe(bs.total_liabilities + bs.total_equity)
  })
})
