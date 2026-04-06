import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 21 — Retained Earnings & Opening Balances', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('retained earnings account exists in seed data and is system account', () => {
    const accounts = mock.getAccounts()
    const re = accounts.find((a) => a.code === '3200')
    expect(re).toBeDefined()
    expect(re!.name).toBe('Retained Earnings')
    expect(re!.type).toBe('EQUITY')
    expect(re!.is_system).toBe(1)
  })

  it('opening balance equity account exists in seed data and is system account', () => {
    const accounts = mock.getAccounts()
    const obe = accounts.find((a) => a.code === '3500')
    expect(obe).toBeDefined()
    expect(obe!.name).toBe('Opening Balance Equity')
    expect(obe!.type).toBe('EQUITY')
    expect(obe!.is_system).toBe(1)
  })

  it('system accounts cannot be deactivated', () => {
    const accounts = mock.getAccounts()
    const re = accounts.find((a) => a.code === '3200')!
    const obe = accounts.find((a) => a.code === '3500')!

    expect(() => mock.deactivateAccount(re.id)).toThrow('Cannot deactivate a system account')
    expect(() => mock.deactivateAccount(obe.id)).toThrow('Cannot deactivate a system account')
  })

  it('enter_opening_balances creates balanced OPENING transaction', () => {
    const accounts = mock.getAccounts()
    const cash = accounts.find((a) => a.code === '1000')!
    const ar = accounts.find((a) => a.code === '1100')!
    const ap = accounts.find((a) => a.code === '2000')!

    const txId = mock.enterOpeningBalances([
      { account_id: cash.id, balance: 100000 },   // $1000 cash
      { account_id: ar.id, balance: 50000 },       // $500 AR
      { account_id: ap.id, balance: 30000 },       // $300 AP
    ], '2026-01-01')

    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('OPENING')
    expect(tx.description).toBe('Opening Balances')

    // Should balance: total debits = total credits
    const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = tx.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalDebit).toBe(totalCredit)
  })

  it('opening balances reflect correctly in trial balance', () => {
    const accounts = mock.getAccounts()
    const cash = accounts.find((a) => a.code === '1000')!
    const equipment = accounts.find((a) => a.code === '1500')!

    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 200000 },       // $2000
      { account_id: equipment.id, balance: 500000 },   // $5000
    ], '2026-01-01')

    const tb = mock.getTrialBalance()
    const cashRow = tb.rows.find((r) => r.code === '1000')
    const equipRow = tb.rows.find((r) => r.code === '1500')
    const obeRow = tb.rows.find((r) => r.code === '3500')

    expect(cashRow!.debit).toBe(200000)
    expect(equipRow!.debit).toBe(500000)
    expect(obeRow!.credit).toBe(700000)
    expect(tb.is_balanced).toBe(true)
  })

  it('opening balances reflect correctly in balance sheet', () => {
    const accounts = mock.getAccounts()
    const cash = accounts.find((a) => a.code === '1000')!
    const ap = accounts.find((a) => a.code === '2000')!

    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 100000 },   // $1000
      { account_id: ap.id, balance: 20000 },       // $200
    ], '2026-01-01')

    const bs = mock.getBalanceSheet('2026-12-31')
    expect(bs.is_balanced).toBe(true)
    expect(bs.total_assets).toBe(100000)
    expect(bs.total_liabilities).toBe(20000)
    // Opening Balance Equity should show in equity section
    const obeItem = bs.equity.find((e) => e.code === '3500')
    expect(obeItem).toBeDefined()
    expect(obeItem!.balance).toBe(80000) // 100000 - 20000
  })

  it('non-system accounts can still be deactivated', () => {
    const accounts = mock.getAccounts()
    const draws = accounts.find((a) => a.code === '3100')!
    expect(draws.is_system).toBe(0)
    // Should not throw (balance is zero)
    expect(() => mock.deactivateAccount(draws.id)).not.toThrow()
  })
})
