import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 12 — Transaction Editing, Voiding & Audit Trail', () => {
  let mock: MockApi
  let txId: string

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

    txId = mock.createTransaction({
      date: '2026-03-15',
      description: 'Test sale',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })
  })

  it('edit metadata writes audit log', () => {
    mock.updateTransaction(txId, { description: 'Updated sale', date: '2026-03-16' })

    const log = mock.getAuditLog(txId)
    expect(log.length).toBe(2) // date + description
    expect(log.some((e) => e.field_changed === 'description' && e.new_value === 'Updated sale')).toBe(true)
    expect(log.some((e) => e.field_changed === 'date' && e.new_value === '2026-03-16')).toBe(true)

    const detail = mock.getTransactionDetail(txId)
    expect(detail.description).toBe('Updated sale')
    expect(detail.date).toBe('2026-03-16')
  })

  it('edit amounts validates balance', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    expect(() => {
      mock.updateTransactionLines(txId, [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 30000 },
      ])
    }).toThrow('do not balance')
  })

  it('edit amounts writes audit log with old/new', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    mock.updateTransactionLines(txId, [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ])

    const log = mock.getAuditLog(txId)
    expect(log.length).toBe(1)
    expect(log[0].field_changed).toBe('lines')
    expect(log[0].old_value).toContain('D100000')
    expect(log[0].new_value).toContain('D200000')

    // Verify the entries actually changed
    const detail = mock.getTransactionDetail(txId)
    const totalDebit = detail.entries.reduce((s, e) => s + e.debit, 0)
    expect(totalDebit).toBe(200000)
  })

  it('void creates correct reversing entry', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const voidTxId = mock.voidTransaction(txId)
    const voidTx = mock.getTransactionDetail(voidTxId)

    expect(voidTx.description).toContain('VOID')
    expect(voidTx.void_of).toBe(txId)

    // Reversed: original debit→credit, original credit→debit
    const cashEntry = voidTx.entries.find((e) => e.account_id === cash.id)!
    expect(cashEntry.debit).toBe(0)
    expect(cashEntry.credit).toBe(100000) // was debit 100000 in original

    const revEntry = voidTx.entries.find((e) => e.account_id === revenue.id)!
    expect(revEntry.debit).toBe(100000) // was credit 100000 in original
    expect(revEntry.credit).toBe(0)
  })

  it('void sets is_void on original', () => {
    mock.voidTransaction(txId)
    const original = mock.getTransactionDetail(txId)
    expect(original.is_void).toBe(1)
  })

  it('edit locked-period transaction rejected', () => {
    const cash = findAccount('1000')
    mock.addLockPeriod(cash.id, '2026-03-01', '2026-03-31')

    expect(() => {
      mock.updateTransaction(txId, { description: 'Should fail' })
    }).toThrow('locked period')
  })

  it('void locked-period transaction rejected', () => {
    const cash = findAccount('1000')
    mock.addLockPeriod(cash.id, '2026-03-01', '2026-03-31')

    expect(() => {
      mock.voidTransaction(txId)
    }).toThrow('locked period')
  })

  it('get_audit_log returns correct order', () => {
    mock.updateTransaction(txId, { description: 'First edit' })
    mock.updateTransaction(txId, { description: 'Second edit' })
    mock.updateTransaction(txId, { description: 'Third edit' })

    const log = mock.getAuditLog(txId)
    expect(log.length).toBe(3)
    // Desc order: most recent first
    expect(log[0].new_value).toBe('Third edit')
    expect(log[2].new_value).toBe('First edit')
  })
})
