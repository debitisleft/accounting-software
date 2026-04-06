import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 20 — Journal Types & Transaction Classification', () => {
  let mock: MockApi
  let cash: string
  let revenue: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    revenue = accounts.find((a) => a.code === '4000')!.id
  })

  it('transaction created with default type is GENERAL', () => {
    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash, debit: 10000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 10000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('GENERAL')
  })

  it('transaction created with ADJUSTING type is stored correctly', () => {
    const txId = mock.createTransaction({
      date: '2026-01-31',
      description: 'Accrual adjustment',
      journal_type: 'ADJUSTING',
      entries: [
        { account_id: cash, debit: 5000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 5000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('ADJUSTING')
  })

  it('auto-reference generates sequential numbers per type', () => {
    const txId1 = mock.createTransaction({
      date: '2026-01-01',
      description: 'First general',
      entries: [
        { account_id: cash, debit: 1000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 1000 },
      ],
    })
    const txId2 = mock.createTransaction({
      date: '2026-01-02',
      description: 'Second general',
      entries: [
        { account_id: cash, debit: 2000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 2000 },
      ],
    })
    const txId3 = mock.createTransaction({
      date: '2026-01-03',
      description: 'First adjusting',
      journal_type: 'ADJUSTING',
      entries: [
        { account_id: cash, debit: 3000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 3000 },
      ],
    })

    const tx1 = mock.getTransactionDetail(txId1)
    const tx2 = mock.getTransactionDetail(txId2)
    const tx3 = mock.getTransactionDetail(txId3)

    expect(tx1.reference).toBe('GJ-0001')
    expect(tx2.reference).toBe('GJ-0002')
    expect(tx3.reference).toBe('AJ-0001')
  })

  it('CLOSING and OPENING types cannot be manually created', () => {
    expect(() =>
      mock.createTransaction({
        date: '2026-12-31',
        description: 'Fake closing',
        journal_type: 'CLOSING',
        entries: [
          { account_id: cash, debit: 1000, credit: 0 },
          { account_id: revenue, debit: 0, credit: 1000 },
        ],
      }),
    ).toThrow('Cannot manually create CLOSING journal entries')

    expect(() =>
      mock.createTransaction({
        date: '2026-01-01',
        description: 'Fake opening',
        journal_type: 'OPENING',
        entries: [
          { account_id: cash, debit: 1000, credit: 0 },
          { account_id: revenue, debit: 0, credit: 1000 },
        ],
      }),
    ).toThrow('Cannot manually create OPENING journal entries')

    expect(() =>
      mock.createTransaction({
        date: '2026-01-01',
        description: 'Fake reversing',
        journal_type: 'REVERSING',
        entries: [
          { account_id: cash, debit: 1000, credit: 0 },
          { account_id: revenue, debit: 0, credit: 1000 },
        ],
      }),
    ).toThrow('Cannot manually create REVERSING journal entries')
  })

  it('manual reference is preserved when provided', () => {
    const txId = mock.createTransaction({
      date: '2026-02-01',
      description: 'With ref',
      reference: 'INV-100',
      entries: [
        { account_id: cash, debit: 5000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 5000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.reference).toBe('INV-100')
  })

  it('voiding a transaction creates a REVERSING journal type', () => {
    const txId = mock.createTransaction({
      date: '2026-03-01',
      description: 'To void',
      entries: [
        { account_id: cash, debit: 7000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 7000 },
      ],
    })
    const voidId = mock.voidTransaction(txId)
    const voidTx = mock.getTransactionDetail(voidId)
    expect(voidTx.journal_type).toBe('REVERSING')
  })
})
