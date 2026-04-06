import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 31 — Reconciliation Service', () => {
  let mock: MockApi
  let cash: string
  let revenue: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    revenue = accounts.find((a) => a.code === '4000')!.id

    // Create some transactions
    mock.createTransaction({
      date: '2026-01-15', description: 'Sale 1',
      entries: [
        { account_id: cash, debit: 100000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 100000 },
      ],
    })
    mock.createTransaction({
      date: '2026-01-20', description: 'Sale 2',
      entries: [
        { account_id: cash, debit: 50000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 50000 },
      ],
    })
  })

  it('reconciliation identifies matched and unmatched items', () => {
    // Book balance for cash at end of Jan = 150000
    const recId = mock.startReconciliation(cash, '2026-01-31', 150000)
    const rec = mock.getReconciliation(recId)

    expect(rec.book_balance).toBe(150000)
    expect(rec.statement_balance).toBe(150000)
    expect(rec.difference).toBe(0) // matched
  })

  it('completing reconciliation locks the period', () => {
    const recId = mock.startReconciliation(cash, '2026-01-31', 150000)
    mock.completeReconciliation(recId)

    // Period should now be locked
    expect(mock.isDateLocked('2026-01-31')).toBe(true)
    expect(mock.isDateLocked('2026-01-15')).toBe(true)
  })

  it('locked reconciled period prevents edits', () => {
    const recId = mock.startReconciliation(cash, '2026-01-31', 150000)
    mock.completeReconciliation(recId)

    // Try to create a transaction in the locked period
    expect(() => mock.createTransaction({
      date: '2026-01-25', description: 'Late entry',
      entries: [
        { account_id: cash, debit: 10000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 10000 },
      ],
    })).toThrow('locked period')
  })

  it('reconciliation with difference cannot be completed', () => {
    // Statement says 140000 but book says 150000
    const recId = mock.startReconciliation(cash, '2026-01-31', 140000)
    expect(() => mock.completeReconciliation(recId)).toThrow('difference')
  })

  it('reconciliation history shows completed reconciliations', () => {
    const recId = mock.startReconciliation(cash, '2026-01-31', 150000)
    mock.completeReconciliation(recId)

    const history = mock.listReconciliationHistory(cash)
    expect(history.length).toBe(1)
    expect(history[0].statement_date).toBe('2026-01-31')
    expect(history[0].is_reconciled).toBe(1)
  })
})
