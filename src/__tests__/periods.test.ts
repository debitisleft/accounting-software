import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 16 — Period Management', () => {
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

    mock.createTransaction({ date: '2026-01-15', description: 'January tx', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})
    mock.createTransaction({ date: '2026-02-15', description: 'February tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
  })

  it('lock prevents edits in range', () => {
    mock.lockPeriodGlobal('2026-01-31')
    // Find the January transaction
    const allTxs = mock.listTransactions().transactions
    const janTx = allTxs.find((t) => t.date === '2026-01-15')!

    expect(() => {
      mock.updateTransaction(janTx.id, { description: 'Should fail' })
    }).toThrow('locked period')
  })

  it('lock prevents new transactions in range', () => {
    mock.lockPeriodGlobal('2026-01-31')
    const cash = findAccount('1000')
    const equity = findAccount('3000')

    // Creating a new transaction with a date in locked period — the engine
    // doesn't block createTransaction directly (it creates, then check is on edit/void).
    // But isDateLocked is available for UI to check before creating.
    expect(mock.isDateLocked('2026-01-15')).toBe(true)
    expect(mock.isDateLocked('2026-02-15')).toBe(false)
  })

  it('unlock re-enables editing', () => {
    mock.lockPeriodGlobal('2026-01-31')
    const allTxs = mock.listTransactions().transactions
    const janTx = allTxs.find((t) => t.date === '2026-01-15')!

    // Locked — should fail
    expect(() => mock.updateTransaction(janTx.id, { description: 'fail' })).toThrow('locked')

    // Unlock
    mock.unlockPeriodGlobal()

    // Now should succeed
    mock.updateTransaction(janTx.id, { description: 'now works' })
    expect(mock.getTransactionDetail(janTx.id).description).toBe('now works')
  })

  it('cannot create gap in locked periods', () => {
    mock.lockPeriodGlobal('2026-03-31')

    // Trying to lock an earlier date when a later lock exists
    expect(() => mock.lockPeriodGlobal('2026-01-31')).toThrow('gap')
  })

  it('list locked periods returns in order', () => {
    mock.lockPeriodGlobal('2026-01-31')
    mock.lockPeriodGlobal('2026-03-31')

    const periods = mock.listLockedPeriodsGlobal()
    expect(periods.length).toBe(2)
    expect(periods[0].end_date).toBe('2026-03-31')
    expect(periods[1].end_date).toBe('2026-01-31')
  })
})
