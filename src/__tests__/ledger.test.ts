import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 17 — Account Ledger', () => {
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
    const equity = findAccount('3000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2026-01-15', description: 'Sale', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2026-02-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})
  })

  it('get_account_ledger returns correct running balance', () => {
    const cash = findAccount('1000')
    const ledger = mock.getAccountLedger(cash.id)

    expect(ledger.entries.length).toBe(3)
    // Cash is ASSET (debit normal): debit increases, credit decreases
    expect(ledger.entries[0].running_balance).toBe(500000)  // +500000
    expect(ledger.entries[1].running_balance).toBe(700000)  // +200000
    expect(ledger.entries[2].running_balance).toBe(620000)  // -80000
  })

  it('running balance respects normal balance side', () => {
    const equity = findAccount('3000')
    const ledger = mock.getAccountLedger(equity.id)

    // Equity is credit-normal: credits increase, debits decrease
    expect(ledger.entries.length).toBe(1)
    expect(ledger.entries[0].running_balance).toBe(500000) // credit 500000
  })

  it('pagination works on account ledger', () => {
    const cash = findAccount('1000')

    const page1 = mock.getAccountLedger(cash.id, { offset: 0, limit: 2 })
    expect(page1.entries.length).toBe(2)
    expect(page1.total).toBe(3)

    const page2 = mock.getAccountLedger(cash.id, { offset: 2, limit: 2 })
    expect(page2.entries.length).toBe(1)
    expect(page2.total).toBe(3)
  })

  it('date range filter works', () => {
    const cash = findAccount('1000')
    const ledger = mock.getAccountLedger(cash.id, { startDate: '2026-01-15', endDate: '2026-01-31' })
    expect(ledger.entries.length).toBe(1)
    expect(ledger.entries[0].description).toBe('Sale')
  })

  it('ledger includes account metadata', () => {
    const cash = findAccount('1000')
    const ledger = mock.getAccountLedger(cash.id)
    expect(ledger.account_code).toBe('1000')
    expect(ledger.account_name).toBe('Cash')
    expect(ledger.account_type).toBe('ASSET')
  })
})
