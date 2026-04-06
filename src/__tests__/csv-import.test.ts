import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 27 — CSV Import with Column Mapping', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('valid CSV imports correctly', () => {
    const result = mock.importCsvRows([
      { date: '2026-03-01', description: 'Office Supplies Purchase', account_code: '5400', debit: 15000, credit: 0 },
      { date: '2026-03-05', description: 'Client Payment', account_code: '4000', debit: 0, credit: 50000 },
    ])

    expect(result.imported).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.errors.length).toBe(0)
  })

  it('invalid rows rejected with error messages', () => {
    const result = mock.importCsvRows([
      { date: 'not-a-date', description: 'Bad date', account_code: '5400', debit: 1000, credit: 0 },
      { date: '2026-03-01', description: 'Unknown account', account_code: '9999', debit: 1000, credit: 0 },
      { date: '2026-03-01', description: 'No amount', account_code: '5400', debit: 0, credit: 0 },
    ])

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(3)
    expect(result.errors.length).toBe(3)
    expect(result.errors[0].message).toContain('Invalid date')
    expect(result.errors[1].message).toContain('Unknown account code')
    expect(result.errors[2].message).toContain('no amount')
  })

  it('duplicate detection flags matches', () => {
    // Create an existing transaction
    const accounts = mock.getAccounts()
    const cash = accounts.find((a) => a.code === '1000')!
    const supplies = accounts.find((a) => a.code === '5400')!
    mock.createTransaction({
      date: '2026-04-01',
      description: 'Staples purchase',
      entries: [
        { account_id: supplies.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ],
    })

    // Import the same transaction
    const result = mock.importCsvRows([
      { date: '2026-04-01', description: 'Staples purchase', account_code: '5400', debit: 5000, credit: 0 },
    ])

    expect(result.duplicates).toBe(1)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
  })
})
