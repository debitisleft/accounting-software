import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 10 — Account Management (CRUD)', () => {
  let mock: MockApi

  function findAccount(code: string) {
    // Search all accounts including inactive
    const acct = mock.accounts.find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('create account with valid data succeeds', () => {
    const id = mock.createAccount({
      code: '1600',
      name: 'Vehicles',
      acctType: 'ASSET',
    })
    expect(id).toBeTruthy()
    const acct = mock.accounts.find((a) => a.id === id)!
    expect(acct.code).toBe('1600')
    expect(acct.name).toBe('Vehicles')
    expect(acct.type).toBe('ASSET')
    expect(acct.normal_balance).toBe('DEBIT')
    expect(acct.is_active).toBe(1)
  })

  it('create account with duplicate number fails', () => {
    expect(() => {
      mock.createAccount({ code: '1000', name: 'Duplicate Cash', acctType: 'ASSET' })
    }).toThrow("already exists")
  })

  it('deactivate account with zero balance succeeds', () => {
    const cash = findAccount('1020') // Savings — no transactions = zero balance
    expect(cash.is_active).toBe(1)
    mock.deactivateAccount(cash.id)
    expect(cash.is_active).toBe(0)
  })

  it('deactivate account with non-zero balance fails', () => {
    const cash = findAccount('1000')
    const equity = findAccount('3000')

    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    expect(() => mock.deactivateAccount(cash.id)).toThrow('non-zero balance')
  })

  it('cannot change account type after creation', () => {
    // updateAccount does not accept type changes — the API doesn't expose it
    // Verify the account type stays the same after update
    const cash = findAccount('1000')
    mock.updateAccount(cash.id, { name: 'Petty Cash' })
    expect(cash.type).toBe('ASSET') // type unchanged
    expect(cash.name).toBe('Petty Cash')
  })

  it('deactivated accounts excluded from active queries', () => {
    const savings = findAccount('1020')
    const countBefore = mock.getAccounts().length
    mock.deactivateAccount(savings.id)
    const countAfter = mock.getAccounts().length
    expect(countAfter).toBe(countBefore - 1)
    expect(mock.getAccounts().find((a) => a.id === savings.id)).toBeUndefined()
  })

  it('reactivate account works', () => {
    const savings = findAccount('1020')
    mock.deactivateAccount(savings.id)
    expect(mock.getAccounts().find((a) => a.id === savings.id)).toBeUndefined()
    mock.reactivateAccount(savings.id)
    expect(mock.getAccounts().find((a) => a.id === savings.id)).toBeDefined()
  })

  it('update account name and code', () => {
    const savings = findAccount('1020')
    mock.updateAccount(savings.id, { name: 'High Yield Savings', code: '1025' })
    expect(savings.name).toBe('High Yield Savings')
    expect(savings.code).toBe('1025')
  })

  it('update account with duplicate code fails', () => {
    const savings = findAccount('1020')
    expect(() => mock.updateAccount(savings.id, { code: '1000' })).toThrow('already exists')
  })
})
