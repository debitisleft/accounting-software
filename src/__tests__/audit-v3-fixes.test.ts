import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 36 — V2 Audit Fixes', () => {
  let mock: MockApi

  function find(code: string) {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  // ── Duplicate opening balances ────────────────────────

  it('enterOpeningBalances twice — second call throws error', () => {
    const cash = find('1000')
    const ar = find('1100')

    mock.enterOpeningBalances(
      [{ account_id: cash.id, balance: 100000 }, { account_id: ar.id, balance: 50000 }],
      '2025-01-01',
    )

    expect(() =>
      mock.enterOpeningBalances(
        [{ account_id: cash.id, balance: 200000 }],
        '2025-01-01',
      ),
    ).toThrow('Opening balances have already been entered')
  })

  it('after voiding opening balance entry, new one can be entered', () => {
    const cash = find('1000')

    const txId = mock.enterOpeningBalances(
      [{ account_id: cash.id, balance: 100000 }],
      '2025-01-01',
    )

    // Void the opening balance — need to unlock period first since closing locks it
    // The opening balance was in a potentially locked period. Let's void it.
    mock.voidTransaction(txId)

    // Now we should be able to enter new opening balances
    const txId2 = mock.enterOpeningBalances(
      [{ account_id: cash.id, balance: 200000 }],
      '2025-01-01',
    )
    expect(txId2).toBeTruthy()
    expect(txId2).not.toBe(txId)
  })

  // ── Zero-activity fiscal year close ───────────────────

  it('close fiscal year with zero revenue/expense activity — succeeds', () => {
    // No transactions at all — zero activity
    const result = mock.closeFiscalYear('2025-12-31')
    expect(result.transaction_id).toBeTruthy()
    expect(result.net_income).toBe(0)
  })

  it('zero-activity closing entry has journal_type CLOSING and appears in list_fiscal_year_closes', () => {
    const result = mock.closeFiscalYear('2025-12-31')

    const tx = mock.transactions.find((t) => t.id === result.transaction_id)
    expect(tx).toBeDefined()
    expect(tx!.journal_type).toBe('CLOSING')

    const closes = mock.listFiscalYearCloses()
    expect(closes.some((c) => c.transaction_id === result.transaction_id)).toBe(true)
    const closeEntry = closes.find((c) => c.transaction_id === result.transaction_id)!
    expect(closeEntry.date).toBe('2025-12-31')
    expect(closeEntry.net_income).toBe(0)
  })

  // ── Circular parent reference ─────────────────────────

  it('A→B→A circular parent reference rejected on create', () => {
    const idA = mock.createAccount({ code: '6000', name: 'Account A', acctType: 'EXPENSE' })
    const idB = mock.createAccount({ code: '6001', name: 'Account B', acctType: 'EXPENSE', parentId: idA })

    // Try to create C with parent B, where B→A. That's fine.
    // But creating something that would make A's parent = B (circular) needs updateAccount.
    // For create: try creating with parent pointing to form a circle
    // Actually, create can't form a cycle since the new account doesn't exist yet.
    // The cycle is: A→B→A. To test this, we use updateAccount to set A.parent = B.
    expect(() =>
      mock.updateAccount(idA, { parentId: idB }),
    ).toThrow('Circular parent reference detected')
  })

  it('A→B→C→A circular reference rejected on update', () => {
    const idA = mock.createAccount({ code: '6000', name: 'Account A', acctType: 'EXPENSE' })
    const idB = mock.createAccount({ code: '6001', name: 'Account B', acctType: 'EXPENSE', parentId: idA })
    const idC = mock.createAccount({ code: '6002', name: 'Account C', acctType: 'EXPENSE', parentId: idB })

    // Try to set A's parent to C — would form A→C→B→A cycle
    expect(() =>
      mock.updateAccount(idA, { parentId: idC }),
    ).toThrow('Circular parent reference detected')
  })

  it('valid 3-level hierarchy accepted', () => {
    const idA = mock.createAccount({ code: '6000', name: 'Top', acctType: 'EXPENSE' })
    const idB = mock.createAccount({ code: '6001', name: 'Middle', acctType: 'EXPENSE', parentId: idA })
    const idC = mock.createAccount({ code: '6002', name: 'Bottom', acctType: 'EXPENSE', parentId: idB })

    const accounts = mock.getAccounts()
    const bottom = accounts.find((a) => a.id === idC)!
    expect(bottom.parent_id).toBe(idB)

    const middle = accounts.find((a) => a.id === idB)!
    expect(middle.parent_id).toBe(idA)
  })

  // ── Account type change protection ────────────────────

  it('attempting to update account type throws error', () => {
    const id = mock.createAccount({ code: '6000', name: 'Test', acctType: 'EXPENSE' })

    expect(() =>
      mock.updateAccount(id, { acctType: 'REVENUE' }),
    ).toThrow('Account type cannot be changed after creation')
  })

  // ── Monthly recurrence end-of-month clamping ──────────

  it('Jan 31 monthly recurrence → Feb 28 (non-leap year)', () => {
    const cash = find('1000')
    const rent = find('5100')

    mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-31',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    // Generate for January (first due = start_date)
    const tmpl = mock.recurringTemplates[0]
    mock.generateRecurring(tmpl.id, '2025-01-31')

    // Check next due date — should be Feb 28, not Feb 31 (invalid)
    const due = mock.getDueRecurring('2025-03-01')
    expect(due).toHaveLength(1)
    expect(due[0].due_date).toBe('2025-02-28')
  })

  it('Mar 31 monthly recurrence → Apr 30', () => {
    const cash = find('1000')
    const rent = find('5100')

    mock.createRecurring({
      description: 'Monthly payment',
      recurrence: 'MONTHLY',
      start_date: '2025-01-31',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    const tmpl = mock.recurringTemplates[0]
    // Generate Jan, Feb, Mar
    mock.generateRecurring(tmpl.id, '2025-01-31')
    mock.generateRecurring(tmpl.id, '2025-02-28')
    mock.generateRecurring(tmpl.id, '2025-03-31')

    // Next due should be Apr 30
    const due = mock.getDueRecurring('2025-05-01')
    expect(due).toHaveLength(1)
    expect(due[0].due_date).toBe('2025-04-30')
  })

  it('Jan 15 monthly recurrence → Feb 15 (no clamping, unchanged)', () => {
    const cash = find('1000')
    const rent = find('5100')

    mock.createRecurring({
      description: 'Mid-month payment',
      recurrence: 'MONTHLY',
      start_date: '2025-01-15',
      entries: [
        { account_id: rent.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
    })

    const tmpl = mock.recurringTemplates[0]
    mock.generateRecurring(tmpl.id, '2025-01-15')

    const due = mock.getDueRecurring('2025-03-01')
    expect(due).toHaveLength(1)
    expect(due[0].due_date).toBe('2025-02-15')
  })
})
