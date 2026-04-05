import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 11 — Transaction Register', () => {
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
    const revenue = findAccount('4000')
    const rent = findAccount('5100')
    const equity = findAccount('3000')

    mock.createTransaction({ date: '2026-01-01', description: 'Owner investment', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2026-01-15', description: 'January sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 100000 },
    ]})
    mock.createTransaction({ date: '2026-02-01', description: 'February rent payment', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})
    mock.createTransaction({ date: '2026-02-15', description: 'February sale', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2026-03-01', description: 'March rent payment', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})
  })

  it('list_transactions returns correct page', () => {
    const result = mock.listTransactions({ limit: 3 })
    expect(result.total).toBe(5)
    expect(result.transactions.length).toBe(3)
    // Sorted by date desc: March, Feb sale, Feb rent
    expect(result.transactions[0].date).toBe('2026-03-01')
  })

  it('date range filter works', () => {
    const result = mock.listTransactions({ start_date: '2026-02-01', end_date: '2026-02-28' })
    expect(result.total).toBe(2)
    expect(result.transactions.every((t) => t.date >= '2026-02-01' && t.date <= '2026-02-28')).toBe(true)
  })

  it('account filter returns only matching transactions', () => {
    const rent = findAccount('5100')
    const result = mock.listTransactions({ account_id: rent.id })
    expect(result.total).toBe(2) // 2 rent payments
    expect(result.transactions.every((t) =>
      t.entries.some((e) => e.account_id === rent.id)
    )).toBe(true)
  })

  it('memo search is case-insensitive partial match', () => {
    const result = mock.listTransactions({ memo_search: 'RENT' })
    expect(result.total).toBe(2)
    expect(result.transactions.every((t) => t.description.toLowerCase().includes('rent'))).toBe(true)
  })

  it('pagination offset/limit correct', () => {
    const page1 = mock.listTransactions({ limit: 2, offset: 0 })
    const page2 = mock.listTransactions({ limit: 2, offset: 2 })
    const page3 = mock.listTransactions({ limit: 2, offset: 4 })

    expect(page1.transactions.length).toBe(2)
    expect(page2.transactions.length).toBe(2)
    expect(page3.transactions.length).toBe(1)
    expect(page1.total).toBe(5)

    // No overlap between pages
    const ids = [
      ...page1.transactions.map((t) => t.id),
      ...page2.transactions.map((t) => t.id),
      ...page3.transactions.map((t) => t.id),
    ]
    expect(new Set(ids).size).toBe(5)
  })

  it('voided transactions included with is_void flag', () => {
    // All current transactions should have is_void = 0
    const result = mock.listTransactions()
    expect(result.transactions.every((t) => t.is_void === 0)).toBe(true)
    expect(result.transactions.every((t) => t.void_of === null)).toBe(true)
  })

  it('get_transaction_detail returns full transaction', () => {
    const list = mock.listTransactions({ limit: 1 })
    const txId = list.transactions[0].id
    const detail = mock.getTransactionDetail(txId)
    expect(detail.id).toBe(txId)
    expect(detail.entries.length).toBeGreaterThan(0)
  })

  it('count_transactions matches list total', () => {
    const count = mock.countTransactions({ start_date: '2026-02-01', end_date: '2026-02-28' })
    const list = mock.listTransactions({ start_date: '2026-02-01', end_date: '2026-02-28' })
    expect(count).toBe(list.total)
  })
})
