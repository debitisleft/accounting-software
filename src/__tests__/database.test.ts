import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('database schema and seed', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
  })

  it('starts with empty tables', () => {
    // No file open yet — direct array access
    expect(mock.accounts).toEqual([])
    expect(mock.transactions).toEqual([])
    expect(mock.entries).toEqual([])
  })

  it('getAccounts throws when no file is open', () => {
    expect(() => mock.getAccounts()).toThrow('No file is open')
  })

  it('seeds at least 20 default accounts', () => {
    mock.seedAccounts(defaultSeedAccounts)
    expect(mock.getAccounts().length).toBeGreaterThanOrEqual(20)
  })

  it('seeds accounts with all five types', () => {
    mock.seedAccounts(defaultSeedAccounts)
    const types = new Set(mock.getAccounts().map((a) => a.type))
    expect(types).toContain('ASSET')
    expect(types).toContain('LIABILITY')
    expect(types).toContain('EQUITY')
    expect(types).toContain('REVENUE')
    expect(types).toContain('EXPENSE')
  })

  it('stores monetary amounts as integers (cents)', () => {
    mock.seedAccounts(defaultSeedAccounts)
    const cash = mock.getAccounts().find((a) => a.code === '1000')!
    const revenue = mock.getAccounts().find((a) => a.code === '4000')!

    mock.createTransaction({
      date: '2026-01-15',
      description: 'Test',
      entries: [
        { account_id: cash.id, debit: 15000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 15000 },
      ],
    })

    expect(mock.entries[0].debit).toBe(15000)
    expect(mock.entries[1].credit).toBe(15000)
    expect(Number.isInteger(mock.entries[0].debit)).toBe(true)
    expect(Number.isInteger(mock.entries[1].credit)).toBe(true)
  })

  it('does not re-seed if accounts already exist', () => {
    mock.seedAccounts(defaultSeedAccounts)
    const countFirst = mock.getAccounts().length
    mock.seedAccounts(defaultSeedAccounts)
    expect(mock.getAccounts().length).toBe(countFirst)
  })

  it('rejects unbalanced entries at engine level', () => {
    mock.seedAccounts(defaultSeedAccounts)
    const cash = mock.getAccounts().find((a) => a.code === '1000')!
    const revenue = mock.getAccounts().find((a) => a.code === '4000')!

    expect(() => {
      mock.createTransaction({
        date: '2026-01-15',
        description: 'Bad',
        entries: [
          { account_id: cash.id, debit: 100, credit: 0 },
          { account_id: revenue.id, debit: 0, credit: 50 },
        ],
      })
    }).toThrow('does not balance')
  })
})
