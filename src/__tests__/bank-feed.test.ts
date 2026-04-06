import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 30 — Bank Feed Pipeline', () => {
  let mock: MockApi
  let rent: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    rent = accounts.find((a) => a.code === '5100')!.id
  })

  it('Plaid data normalizes to expected schema', () => {
    const count = mock.importBankTransactions([
      { date: '2026-03-01', description: 'ACME CORP PAYMENT', amount: 50000, payee: 'ACME CORP', bank_ref: 'REF001' },
      { date: '2026-03-02', description: 'RENT PAYMENT', amount: -120000, payee: 'LANDLORD', bank_ref: 'REF002' },
    ])

    expect(count).toBe(2)
    const pending = mock.listPendingBankTransactions()
    expect(pending.length).toBe(2)
    expect(pending[0].status).toBe('PENDING')
    expect(pending[0].amount).toBe(50000)
    expect(pending[1].amount).toBe(-120000)
  })

  it('approval creates valid balanced transaction', () => {
    mock.importBankTransactions([
      { date: '2026-04-01', description: 'Rent Payment', amount: -100000, bank_ref: 'REF100' },
    ])

    const pending = mock.listPendingBankTransactions()
    expect(pending.length).toBe(1)

    const txId = mock.approveBankTransaction(pending[0].id, rent)
    const tx = mock.getTransactionDetail(txId)

    // Should be balanced
    const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = tx.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(100000) // abs value of -100000

    // Pending should now be gone from pending list
    expect(mock.listPendingBankTransactions().length).toBe(0)
  })

  it('dismissal marks as ignored without creating transaction', () => {
    mock.importBankTransactions([
      { date: '2026-05-01', description: 'Transfer', amount: 25000, bank_ref: 'REF200' },
    ])

    const txCountBefore = mock.transactions.length
    const pending = mock.listPendingBankTransactions()
    mock.dismissBankTransaction(pending[0].id)

    // No new transaction created
    expect(mock.transactions.length).toBe(txCountBefore)
    // No longer in pending list
    expect(mock.listPendingBankTransactions().length).toBe(0)
  })

  it('deduplicates by bank_ref', () => {
    mock.importBankTransactions([
      { date: '2026-06-01', description: 'Payment 1', amount: 1000, bank_ref: 'DUP001' },
    ])
    const count = mock.importBankTransactions([
      { date: '2026-06-01', description: 'Payment 1', amount: 1000, bank_ref: 'DUP001' },
    ])
    expect(count).toBe(0) // duplicate skipped
    expect(mock.listPendingBankTransactions().length).toBe(1)
  })
})
