/**
 * Engine Audit V2 — Comprehensive double-entry bookkeeping test suite
 * Categories A-M covering fiscal close, opening balances, journal types,
 * system accounts, cash flow, hierarchy, recurring, CSV import,
 * accrual/cash basis, bank feed, reconciliation, integration, and hard rules.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

function find(mock: MockApi, code: string) {
  const acct = mock.getAccounts().find((a) => a.code === code)
  if (!acct) throw new Error(`Account ${code} not found`)
  return acct
}

// ────────────────────────────────────────────────────────────────
// CATEGORY A: Fiscal Year Close Correctness
// ────────────────────────────────────────────────────────────────
describe('A: Fiscal Year Close Correctness', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('A1: closing zeroes ALL revenue balances', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const service = find(mock, '4100')
    const interest = find(mock, '4200')

    // Create revenue in all three accounts
    mock.createTransaction({ date: '2025-06-15', description: 'Sale', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2025-07-15', description: 'Service', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: service.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2025-08-15', description: 'Interest', entries: [
      { account_id: cash.id, debit: 10000, credit: 0 },
      { account_id: interest.id, debit: 0, credit: 10000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    expect(mock.getAccountBalance(sales.id, '2025-12-31')).toBe(0)
    expect(mock.getAccountBalance(service.id, '2025-12-31')).toBe(0)
    expect(mock.getAccountBalance(interest.id, '2025-12-31')).toBe(0)
  })

  it('A2: closing zeroes ALL expense balances', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')
    const utilities = find(mock, '5200')
    const wages = find(mock, '5300')

    mock.createTransaction({ date: '2025-03-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 120000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 120000 },
    ]})
    mock.createTransaction({ date: '2025-04-01', description: 'Utilities', entries: [
      { account_id: utilities.id, debit: 30000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 30000 },
    ]})
    mock.createTransaction({ date: '2025-05-01', description: 'Wages', entries: [
      { account_id: wages.id, debit: 250000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 250000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    expect(mock.getAccountBalance(rent.id, '2025-12-31')).toBe(0)
    expect(mock.getAccountBalance(utilities.id, '2025-12-31')).toBe(0)
    expect(mock.getAccountBalance(wages.id, '2025-12-31')).toBe(0)
  })

  it('A3: net income transfers to retained earnings', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')
    const re = find(mock, '3200')

    mock.createTransaction({ date: '2025-06-01', description: 'Revenue', entries: [
      { account_id: cash.id, debit: 1000000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 1000000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Expense', entries: [
      { account_id: rent.id, debit: 300000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 300000 },
    ]})

    const result = mock.closeFiscalYear('2025-12-31')
    expect(result.net_income).toBe(700000) // 10000 - 3000 = 7000 in dollars
    expect(mock.getAccountBalance(re.id, '2025-12-31')).toBe(700000)
  })

  it('A4: closing entry has journal_type = CLOSING', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const result = mock.closeFiscalYear('2025-12-31')
    const tx = mock.getTransactionDetail(result.transaction_id)
    expect(tx.journal_type).toBe('CLOSING')
  })

  it('A5: closing entry auto-locks period', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    expect(mock.isDateLocked('2025-12-31')).toBe(true)
    expect(mock.isDateLocked('2025-06-01')).toBe(true)
    // Date after close should not be locked
    expect(mock.isDateLocked('2026-01-01')).toBe(false)
  })

  it('A6: cannot close same year twice', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    mock.closeFiscalYear('2025-12-31')
    expect(() => mock.closeFiscalYear('2025-12-31')).toThrow('already closed')
  })

  it('A7: closing with zero revenue AND zero expenses succeeds (dormant year)', () => {
    // No revenue or expense transactions created
    const result = mock.closeFiscalYear('2025-12-31')
    expect(result.net_income).toBe(0)
    expect(result.transaction_id).toBeDefined()
    // Period should still be locked
    expect(mock.isDateLocked('2025-12-31')).toBe(true)
  })

  it('A8: income statement EXCLUDES closing entries when requested', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 200000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 200000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31', ['CLOSING'])
    expect(is.total_revenue).toBe(500000)
    expect(is.total_expenses).toBe(200000)
    expect(is.net_income).toBe(300000)
  })

  it('A9: income statement INCLUDES closing entries when not excluded', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 200000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 200000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    // Without excluding CLOSING, revenue/expense should be zeroed
    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31')
    expect(is.total_revenue).toBe(0)
    expect(is.total_expenses).toBe(0)
    expect(is.net_income).toBe(0)
  })

  it('A10: balance sheet after close shows retained earnings', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 800000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 800000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 300000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 300000 },
    ]})

    mock.closeFiscalYear('2025-12-31')

    const bs = mock.getBalanceSheet('2025-12-31')
    const reRow = bs.equity.find((e) => e.code === '3200')
    expect(reRow).toBeDefined()
    expect(reRow!.balance).toBe(500000)
    expect(bs.is_balanced).toBe(true)
  })

  it('A11: 50+ transactions then close — verify retained earnings correct', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')

    // 30 revenue transactions of $100 each = $3000
    for (let i = 0; i < 30; i++) {
      mock.createTransaction({ date: '2025-03-15', description: `Sale ${i}`, entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ]})
    }
    // 25 expense transactions of $50 each = $1250
    for (let i = 0; i < 25; i++) {
      mock.createTransaction({ date: '2025-06-15', description: `Rent ${i}`, entries: [
        { account_id: rent.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ]})
    }

    const result = mock.closeFiscalYear('2025-12-31')
    // Net income: 300000 - 125000 = 175000
    expect(result.net_income).toBe(175000)

    const re = find(mock, '3200')
    expect(mock.getAccountBalance(re.id, '2025-12-31')).toBe(175000)
  })

  it('A12: two consecutive fiscal year closes — retained earnings accumulates', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')
    const re = find(mock, '3200')

    // Year 1: net income = 500000 - 200000 = 300000
    mock.createTransaction({ date: '2024-06-01', description: 'Y1 Sale', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2024-07-01', description: 'Y1 Rent', entries: [
      { account_id: rent.id, debit: 200000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 200000 },
    ]})

    mock.closeFiscalYear('2024-12-31')
    expect(mock.getAccountBalance(re.id, '2024-12-31')).toBe(300000)

    // Year 2: net income = 400000 - 100000 = 300000
    mock.createTransaction({ date: '2025-06-01', description: 'Y2 Sale', entries: [
      { account_id: cash.id, debit: 400000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 400000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Y2 Rent', entries: [
      { account_id: rent.id, debit: 100000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 100000 },
    ]})

    const result2 = mock.closeFiscalYear('2025-12-31')
    expect(result2.net_income).toBe(300000)
    // Accumulated: 300000 + 300000 = 600000
    expect(mock.getAccountBalance(re.id, '2025-12-31')).toBe(600000)

    const closes = mock.listFiscalYearCloses()
    expect(closes.length).toBe(2)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY B: Opening Balances
// ────────────────────────────────────────────────────────────────
describe('B: Opening Balances', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('B1: single asset opening balance', () => {
    const cash = find(mock, '1000')
    const txId = mock.enterOpeningBalances([{ account_id: cash.id, balance: 1000000 }], '2025-01-01')
    expect(mock.getAccountBalance(cash.id, '2025-01-01')).toBe(1000000)
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('OPENING')
  })

  it('B2: single liability opening balance', () => {
    const ap = find(mock, '2000')
    mock.enterOpeningBalances([{ account_id: ap.id, balance: 500000 }], '2025-01-01')
    expect(mock.getAccountBalance(ap.id, '2025-01-01')).toBe(500000)
  })

  it('B3: multiple accounts — OBE absorbs the difference', () => {
    const cash = find(mock, '1000')
    const ap = find(mock, '2000')
    const obe = find(mock, '3500')

    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 1000000 },
      { account_id: ap.id, balance: 300000 },
    ], '2025-01-01')

    expect(mock.getAccountBalance(cash.id)).toBe(1000000)
    expect(mock.getAccountBalance(ap.id)).toBe(300000)
    // Cash debit 1000000, AP credit 300000 => OBE credit 700000
    expect(mock.getAccountBalance(obe.id)).toBe(700000)
  })

  it('B4: zero balance is ignored (no entry created for it)', () => {
    const cash = find(mock, '1000')
    const txId = mock.enterOpeningBalances([
      { account_id: cash.id, balance: 500000 },
      { account_id: find(mock, '1100').id, balance: 0 },
    ], '2025-01-01')

    const tx = mock.getTransactionDetail(txId)
    // Should have 2 entries: cash + OBE (AR zero was skipped)
    expect(tx.entries.length).toBe(2)
  })

  it('B5: all-zero balances throws', () => {
    const cash = find(mock, '1000')
    expect(() => mock.enterOpeningBalances([
      { account_id: cash.id, balance: 0 },
    ], '2025-01-01')).toThrow('No non-zero balances')
  })

  it('B6: negative asset balance (contra)', () => {
    const accumDepr = find(mock, '1510')
    mock.enterOpeningBalances([{ account_id: accumDepr.id, balance: -50000 }], '2025-01-01')
    // Negative asset => credit entry => balance = -50000
    expect(mock.getAccountBalance(accumDepr.id)).toBe(-50000)
  })

  it('B7: opening balances create OPENING journal type', () => {
    const cash = find(mock, '1000')
    const txId = mock.enterOpeningBalances([{ account_id: cash.id, balance: 100000 }], '2025-01-01')
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('OPENING')
  })

  it('B8: balance sheet is balanced after opening balances', () => {
    const cash = find(mock, '1000')
    const equip = find(mock, '1500')
    const ap = find(mock, '2000')
    const equity = find(mock, '3000')

    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 500000 },
      { account_id: equip.id, balance: 1000000 },
      { account_id: ap.id, balance: 300000 },
      { account_id: equity.id, balance: 1200000 },
    ], '2025-01-01')

    const bs = mock.getBalanceSheet('2025-01-01')
    expect(bs.is_balanced).toBe(true)
    expect(bs.total_assets).toBe(1500000)
  })

  it('B9: trial balance is balanced after opening balances', () => {
    const cash = find(mock, '1000')
    const ap = find(mock, '2000')

    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 750000 },
      { account_id: ap.id, balance: 250000 },
    ], '2025-01-01')

    const tb = mock.getTrialBalance('2025-01-01')
    expect(tb.is_balanced).toBe(true)
  })

  it('B10: entering opening balances twice throws error (void first to re-enter)', () => {
    const cash = find(mock, '1000')

    mock.enterOpeningBalances([{ account_id: cash.id, balance: 100000 }], '2025-01-01')

    // Second call should throw — user must void first
    expect(() =>
      mock.enterOpeningBalances([{ account_id: cash.id, balance: 200000 }], '2025-01-01')
    ).toThrow('Opening balances have already been entered')

    // Original balance still intact
    expect(mock.getAccountBalance(cash.id, '2025-01-01')).toBe(100000)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY C: Journal Type Enforcement
// ────────────────────────────────────────────────────────────────
describe('C: Journal Type Enforcement', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('C1: users can create GENERAL journal entries', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const txId = mock.createTransaction({
      date: '2025-06-01', description: 'General entry', journal_type: 'GENERAL',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('GENERAL')
  })

  it('C2: users can create ADJUSTING journal entries', () => {
    const cash = find(mock, '1000')
    const prepaid = find(mock, '1300')
    const txId = mock.createTransaction({
      date: '2025-06-30', description: 'Adjusting entry', journal_type: 'ADJUSTING',
      entries: [
        { account_id: cash.id, debit: 5000, credit: 0 },
        { account_id: prepaid.id, debit: 0, credit: 5000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('ADJUSTING')
  })

  it('C3: users cannot manually create CLOSING entries', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    expect(() => mock.createTransaction({
      date: '2025-12-31', description: 'Fake close', journal_type: 'CLOSING',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('Cannot manually create CLOSING')
  })

  it('C4: users cannot manually create REVERSING entries', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    expect(() => mock.createTransaction({
      date: '2025-06-01', description: 'Fake reverse', journal_type: 'REVERSING',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('Cannot manually create REVERSING')
  })

  it('C5: users cannot manually create OPENING entries', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    expect(() => mock.createTransaction({
      date: '2025-01-01', description: 'Fake opening', journal_type: 'OPENING',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('Cannot manually create OPENING')
  })

  it('C6: invalid journal type is rejected', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    expect(() => mock.createTransaction({
      date: '2025-06-01', description: 'Bad type', journal_type: 'NONSENSE',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('Invalid journal type')
  })

  it('C7: default journal type is GENERAL when omitted', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const txId = mock.createTransaction({
      date: '2025-06-01', description: 'No type specified',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.journal_type).toBe('GENERAL')
  })

  it('C8: auto-reference counter does not reuse after void', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    const txId1 = mock.createTransaction({
      date: '2025-06-01', description: 'First',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })
    const tx1 = mock.getTransactionDetail(txId1)
    const ref1 = tx1.reference

    // Void it
    mock.voidTransaction(txId1)

    // Create another — reference should be incremented, not reuse ref1
    const txId2 = mock.createTransaction({
      date: '2025-06-02', description: 'Second',
      entries: [
        { account_id: cash.id, debit: 20000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 20000 },
      ],
    })
    const tx2 = mock.getTransactionDetail(txId2)
    expect(tx2.reference).not.toBe(ref1)
    // References should be sequential
    expect(ref1).toBe('GJ-0001')
    expect(tx2.reference).toBe('GJ-0002')
  })

  it('C9: ADJUSTING gets AJ- prefix', () => {
    const cash = find(mock, '1000')
    const prepaid = find(mock, '1300')
    const txId = mock.createTransaction({
      date: '2025-06-30', description: 'Adjusting', journal_type: 'ADJUSTING',
      entries: [
        { account_id: cash.id, debit: 5000, credit: 0 },
        { account_id: prepaid.id, debit: 0, credit: 5000 },
      ],
    })
    const tx = mock.getTransactionDetail(txId)
    expect(tx.reference).toMatch(/^AJ-/)
  })

  it('C10: voiding creates a REVERSING journal type entry', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const txId = mock.createTransaction({
      date: '2025-06-01', description: 'To void',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })

    const voidTxId = mock.voidTransaction(txId)
    const voidTx = mock.getTransactionDetail(voidTxId)
    expect(voidTx.journal_type).toBe('REVERSING')
    expect(voidTx.void_of).toBe(txId)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY D: System Account Protection
// ────────────────────────────────────────────────────────────────
describe('D: System Account Protection', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('D1: cannot deactivate Retained Earnings (system account)', () => {
    const re = find(mock, '3200')
    expect(re.is_system).toBe(1)
    expect(() => mock.deactivateAccount(re.id)).toThrow('Cannot deactivate a system account')
  })

  it('D2: cannot deactivate Opening Balance Equity (system account)', () => {
    const obe = find(mock, '3500')
    expect(obe.is_system).toBe(1)
    expect(() => mock.deactivateAccount(obe.id)).toThrow('Cannot deactivate a system account')
  })

  it('D3: can deactivate a non-system account with zero balance', () => {
    const supplies = find(mock, '5400')
    mock.deactivateAccount(supplies.id)
    // Should not appear in getAccounts (which returns active only)
    const accts = mock.getAccounts()
    expect(accts.find((a) => a.code === '5400')).toBeUndefined()
  })

  it('D4: cannot deactivate account with non-zero balance', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    expect(() => mock.deactivateAccount(cash.id)).toThrow('non-zero balance')
  })

  it.skip('D5: no deleteAccount method in MockApi — deletion not supported', () => {
    // MockApi does not have a deleteAccount method
  })

  it('D6: updateAccount does not change account type', () => {
    const cash = find(mock, '1000')
    const originalType = cash.type

    // updateAccount only accepts name and code, so type cannot be changed
    mock.updateAccount(cash.id, { name: 'Petty Cash' })

    const updated = mock.getAccounts().find((a) => a.id === cash.id)!
    expect(updated.type).toBe(originalType)
    expect(updated.name).toBe('Petty Cash')
  })

  it('D7: system accounts can still receive transactions', () => {
    const cash = find(mock, '1000')
    const re = find(mock, '3200')

    // Direct posting to retained earnings should work
    // (closeFiscalYear does this internally; testing via opening balances)
    const txId = mock.enterOpeningBalances([
      { account_id: cash.id, balance: 100000 },
      { account_id: re.id, balance: 50000 },
    ], '2025-01-01')

    expect(mock.getAccountBalance(re.id)).toBe(50000)
    expect(txId).toBeDefined()
  })

  it('D8: reactivating a deactivated account works', () => {
    const supplies = find(mock, '5400')
    mock.deactivateAccount(supplies.id)

    // Not in active list
    expect(mock.getAccounts().find((a) => a.code === '5400')).toBeUndefined()

    mock.reactivateAccount(supplies.id)

    // Back in active list
    expect(mock.getAccounts().find((a) => a.code === '5400')).toBeDefined()
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY E: Cash Flow Statement
// ────────────────────────────────────────────────────────────────
describe('E: Cash Flow Statement', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('E1: net_change_in_cash = ending_cash - beginning_cash', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 500000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    expect(cf.net_change_in_cash).toBe(cf.ending_cash - cf.beginning_cash)
  })

  it('E2: beginning_cash is zero with no prior transactions', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    expect(cf.beginning_cash).toBe(0)
    expect(cf.ending_cash).toBe(100000)
  })

  it('E3: operating includes AR changes', () => {
    const cash = find(mock, '1000')
    const ar = find(mock, '1100')
    const sales = find(mock, '4000')

    // Revenue on account (not cash)
    mock.createTransaction({ date: '2025-06-01', description: 'Credit sale', entries: [
      { account_id: ar.id, debit: 200000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 200000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    // AR increase should appear as negative operating adjustment
    const arItem = cf.operating.find((o) => o.code === '1100')
    expect(arItem).toBeDefined()
    expect(arItem!.amount).toBe(-200000) // Asset increase = cash outflow
  })

  it('E4: investing includes equipment purchases', () => {
    const cash = find(mock, '1000')
    const equip = find(mock, '1500')

    mock.createTransaction({ date: '2025-06-01', description: 'Buy equipment', entries: [
      { account_id: equip.id, debit: 500000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 500000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    // Equipment (code >= 1500) goes to investing
    const equipItem = cf.investing.find((i) => i.code === '1500')
    expect(equipItem).toBeDefined()
    expect(equipItem!.amount).toBe(-500000) // Asset increase = outflow
  })

  it('E5: financing includes notes payable changes', () => {
    const cash = find(mock, '1000')
    const notes = find(mock, '2500')

    mock.createTransaction({ date: '2025-06-01', description: 'Borrow money', entries: [
      { account_id: cash.id, debit: 1000000, credit: 0 },
      { account_id: notes.id, debit: 0, credit: 1000000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    // Notes payable (code >= 2500) goes to financing
    const notesItem = cf.financing.find((f) => f.code === '2500')
    expect(notesItem).toBeDefined()
    expect(notesItem!.amount).toBe(1000000) // Liability increase = inflow
  })

  it('E6: total_operating + total_investing + total_financing = net_change_in_cash', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')
    const equip = find(mock, '1500')
    const notes = find(mock, '2500')

    mock.createTransaction({ date: '2025-03-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 300000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 300000 },
    ]})
    mock.createTransaction({ date: '2025-06-01', description: 'Equipment', entries: [
      { account_id: equip.id, debit: 100000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 100000 },
    ]})
    mock.createTransaction({ date: '2025-09-01', description: 'Loan', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: notes.id, debit: 0, credit: 500000 },
    ]})

    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    expect(cf.total_operating + cf.total_investing + cf.total_financing).toBe(cf.net_change_in_cash)
  })

  it('E7: cash flow with no transactions has all zeros', () => {
    const cf = mock.getCashFlowStatement('2025-01-01', '2025-12-31')
    expect(cf.beginning_cash).toBe(0)
    expect(cf.ending_cash).toBe(0)
    expect(cf.net_change_in_cash).toBe(0)
    expect(cf.net_income).toBe(0)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY F: Account Hierarchy
// ────────────────────────────────────────────────────────────────
describe('F: Account Hierarchy', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('F1: child account gets depth = 1', () => {
    const cash = find(mock, '1000')
    const childId = mock.createAccount({ code: '1001', name: 'Petty Cash', acctType: 'ASSET', parentId: cash.id })
    const child = mock.getAccounts().find((a) => a.id === childId)!
    expect(child.depth).toBe(1)
    expect(child.parent_id).toBe(cash.id)
  })

  it('F2: grandchild account gets depth = 2', () => {
    const cash = find(mock, '1000')
    const childId = mock.createAccount({ code: '1001', name: 'Petty Cash', acctType: 'ASSET', parentId: cash.id })
    const grandchildId = mock.createAccount({ code: '1002', name: 'Register', acctType: 'ASSET', parentId: childId })
    const gc = mock.getAccounts().find((a) => a.id === grandchildId)!
    expect(gc.depth).toBe(2)
  })

  it('F3: root account has depth = 0', () => {
    const cash = find(mock, '1000')
    expect(cash.depth).toBe(0)
  })

  it('F4: duplicate account code is rejected', () => {
    expect(() => mock.createAccount({ code: '1000', name: 'Dup', acctType: 'ASSET' }))
      .toThrow("Account code '1000' already exists")
  })

  it('F5: deactivating parent — child still accessible', () => {
    // Create parent with sub-account, zero out parent, deactivate
    const parentId = mock.createAccount({ code: '6000', name: 'Marketing', acctType: 'EXPENSE' })
    const childId = mock.createAccount({ code: '6010', name: 'Ads', acctType: 'EXPENSE', parentId })

    // Parent has zero balance, deactivate it
    mock.deactivateAccount(parentId)

    // Child should still appear (it has its own is_active flag)
    const child = mock.getAccounts().find((a) => a.id === childId)
    expect(child).toBeDefined()
    expect(child!.depth).toBe(1)
    // But parent is gone from active list
    expect(mock.getAccounts().find((a) => a.id === parentId)).toBeUndefined()
  })

  it('F6: circular parent — MockApi does not validate circular refs', () => {
    // Create two accounts and try to make them each other's parent
    const aId = mock.createAccount({ code: '6000', name: 'A', acctType: 'EXPENSE' })
    const bId = mock.createAccount({ code: '6100', name: 'B', acctType: 'EXPENSE', parentId: aId })

    // MockApi doesn't have an "update parent" method, and createAccount doesn't check
    // for circular references. We just verify the depth computation has a safety cap.
    // Manually set circular ref to test depth guard
    const acctA = mock.accounts.find((a) => a.id === aId)!
    acctA.parent_id = bId

    // getAccounts should not infinite loop — it caps at depth 10
    const accounts = mock.getAccounts()
    const a = accounts.find((ac) => ac.id === aId)
    const b = accounts.find((ac) => ac.id === bId)
    // Both should still be returned with capped depth
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    // At least one should have depth capped
    expect(Math.max(a!.depth, b!.depth)).toBeLessThanOrEqual(11)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY G: Recurring Transactions
// ────────────────────────────────────────────────────────────────
describe('G: Recurring Transactions', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('G1: create and generate a recurring transaction', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 150000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 150000 },
      ],
    })

    const txId = mock.generateRecurring(tmplId, '2025-01-01')
    const tx = mock.getTransactionDetail(txId)
    expect(tx.description).toBe('Monthly rent')
    expect(tx.journal_type).toBe('GENERAL')
  })

  it('G2: getDueRecurring returns templates due on or before asOfDate', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-02-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    // Before start date: nothing due
    expect(mock.getDueRecurring('2025-01-15').length).toBe(0)

    // On start date: due
    const due = mock.getDueRecurring('2025-02-01')
    expect(due.length).toBe(1)
    expect(due[0].due_date).toBe('2025-02-01')
  })

  it('G3: paused template is not returned by getDueRecurring', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    mock.pauseRecurring(tmplId)
    expect(mock.getDueRecurring('2025-01-01').length).toBe(0)

    mock.resumeRecurring(tmplId)
    expect(mock.getDueRecurring('2025-01-01').length).toBe(1)
  })

  it('G4: cannot generate from paused template', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    mock.pauseRecurring(tmplId)
    expect(() => mock.generateRecurring(tmplId, '2025-01-01')).toThrow('paused')
  })

  it('G5: end_date prevents generation past expiry', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Short lease',
      recurrence: 'MONTHLY',
      start_date: '2025-01-15',
      end_date: '2025-03-31',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    // Generate Jan 15, Feb 15, Mar 15
    mock.generateRecurring(tmplId, '2025-01-15')
    mock.generateRecurring(tmplId, '2025-02-15')
    mock.generateRecurring(tmplId, '2025-03-15')

    // Next due would be April 15 which is past end_date March 31
    expect(mock.getDueRecurring('2025-04-30').length).toBe(0)
  })

  it('G6: monthly on Jan 31 clamps to end-of-month correctly', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'End of month',
      recurrence: 'MONTHLY',
      start_date: '2025-01-31',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    // First due date is start_date itself
    mock.generateRecurring(tmplId, '2025-01-31')

    // Next due: Jan 31 + 1 month → Feb 28 (2025 is not a leap year)
    const due1 = mock.getDueRecurring('2025-03-01')
    expect(due1.length).toBe(1)
    expect(due1[0].due_date).toBe('2025-02-28')

    // Generate Feb, check March — uses original start day (31) for clamping
    mock.generateRecurring(tmplId, '2025-02-28')
    const due2 = mock.getDueRecurring('2025-04-01')
    expect(due2.length).toBe(1)
    expect(due2[0].due_date).toBe('2025-03-31') // Original day 31, Mar has 31 days

    // Generate Mar, check April
    mock.generateRecurring(tmplId, '2025-03-31')
    const due3 = mock.getDueRecurring('2025-05-01')
    expect(due3.length).toBe(1)
    expect(due3[0].due_date).toBe('2025-04-30') // Original day 31, Apr has 30 days
  })

  it('G7: deleteRecurring removes template', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'To delete',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    mock.deleteRecurring(tmplId)
    expect(mock.listRecurring().length).toBe(0)
    expect(() => mock.generateRecurring(tmplId, '2025-01-01')).toThrow('not found')
  })

  it('G8: generateRecurring into locked period throws', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    mock.lockPeriodGlobal('2025-01-31')

    // generateRecurring calls createTransaction which checks locks
    expect(() => mock.generateRecurring(tmplId, '2025-01-15')).toThrow('locked period')
  })

  it('G9: generateRecurring with deactivated account throws', () => {
    const cash = find(mock, '1000')
    const supplies = find(mock, '5400')

    const tmplId = mock.createRecurring({
      description: 'Office supplies',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: supplies.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ],
    })

    mock.deactivateAccount(supplies.id)

    expect(() => mock.generateRecurring(tmplId, '2025-01-01')).toThrow('deactivated account')
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY H: CSV Import
// ────────────────────────────────────────────────────────────────
describe('H: CSV Import', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('H1: valid rows are imported', () => {
    const result = mock.importCsvRows([
      { date: '2025-06-01', description: 'Sale', account_code: '4000', debit: 0, credit: 50000 },
    ])
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors.length).toBe(0)
  })

  it('H2: invalid date is skipped', () => {
    const result = mock.importCsvRows([
      { date: 'not-a-date', description: 'Bad', account_code: '4000', debit: 0, credit: 50000 },
    ])
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors.length).toBe(1)
    expect(result.errors[0].message).toContain('Invalid date')
  })

  it('H3: unknown account code is skipped', () => {
    const result = mock.importCsvRows([
      { date: '2025-06-01', description: 'Bad acct', account_code: '9999', debit: 0, credit: 50000 },
    ])
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors[0].message).toContain('Unknown account code')
  })

  it('H4: zero debit and zero credit is skipped', () => {
    const result = mock.importCsvRows([
      { date: '2025-06-01', description: 'Zero', account_code: '4000', debit: 0, credit: 0 },
    ])
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors[0].message).toContain('no amount')
  })

  it('H5: duplicate detection skips identical rows', () => {
    // Import once
    mock.importCsvRows([
      { date: '2025-06-01', description: 'Sale', account_code: '4000', debit: 0, credit: 50000 },
    ])

    // Import same row again
    const result = mock.importCsvRows([
      { date: '2025-06-01', description: 'Sale', account_code: '4000', debit: 0, credit: 50000 },
    ])
    expect(result.duplicates).toBe(1)
    expect(result.imported).toBe(0)
  })

  it('H6: imported transactions default to GENERAL journal type', () => {
    mock.importCsvRows([
      { date: '2025-06-01', description: 'Sale import', account_code: '4000', debit: 0, credit: 50000 },
    ])

    // Find the transaction
    const txs = mock.listTransactions()
    expect(txs.transactions.length).toBe(1)
    expect(txs.transactions[0].journal_type).toBe('GENERAL')
  })

  it('H7: import into locked period is rejected', () => {
    mock.lockPeriodGlobal('2025-06-30')

    const result = mock.importCsvRows([
      { date: '2025-06-15', description: 'Locked', account_code: '4000', debit: 0, credit: 50000 },
    ])
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors[0].message).toContain('locked period')
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY I: Accrual vs Cash Basis
// ────────────────────────────────────────────────────────────────
describe('I: Accrual vs Cash Basis', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('I1: accrual basis includes credit sales (no cash involved)', () => {
    const ar = find(mock, '1100')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Credit sale', entries: [
      { account_id: ar.id, debit: 200000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 200000 },
    ]})

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31')
    expect(is.total_revenue).toBe(200000)
  })

  it('I2: cash basis EXCLUDES credit sales (no cash account touched)', () => {
    const ar = find(mock, '1100')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Credit sale', entries: [
      { account_id: ar.id, debit: 200000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 200000 },
    ]})

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31', [], 'CASH')
    expect(is.total_revenue).toBe(0)
  })

  it('I3: cash basis INCLUDES cash sales', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Cash sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31', [], 'CASH')
    expect(is.total_revenue).toBe(100000)
  })

  it('I4: cash basis includes transactions touching checking account', () => {
    const checking = find(mock, '1010')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Checking deposit', entries: [
      { account_id: checking.id, debit: 75000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 75000 },
    ]})

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31', [], 'CASH')
    expect(is.total_revenue).toBe(75000)
  })

  it('I5: mixed accrual and cash transactions — cash basis only counts cash ones', () => {
    const cash = find(mock, '1000')
    const ar = find(mock, '1100')
    const sales = find(mock, '4000')

    // Cash sale
    mock.createTransaction({ date: '2025-06-01', description: 'Cash sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})
    // Credit sale
    mock.createTransaction({ date: '2025-06-02', description: 'Credit sale', entries: [
      { account_id: ar.id, debit: 300000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 300000 },
    ]})

    const accrual = mock.getIncomeStatement('2025-01-01', '2025-12-31')
    expect(accrual.total_revenue).toBe(400000)

    const cashBasis = mock.getIncomeStatement('2025-01-01', '2025-12-31', [], 'CASH')
    expect(cashBasis.total_revenue).toBe(100000)
  })

  it('I6: cash basis with savings account also counts', () => {
    const savings = find(mock, '1020')
    const interest = find(mock, '4200')

    mock.createTransaction({ date: '2025-06-01', description: 'Interest', entries: [
      { account_id: savings.id, debit: 5000, credit: 0 },
      { account_id: interest.id, debit: 0, credit: 5000 },
    ]})

    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31', [], 'CASH')
    expect(is.total_revenue).toBe(5000)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY J: Bank Feed Pipeline
// ────────────────────────────────────────────────────────────────
describe('J: Bank Feed Pipeline', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('J1: import bank transactions creates pending items', () => {
    const count = mock.importBankTransactions([
      { date: '2025-06-01', description: 'Coffee Shop', amount: -500, payee: 'Starbucks', bank_ref: 'REF001' },
      { date: '2025-06-02', description: 'Client Payment', amount: 100000, payee: 'Acme', bank_ref: 'REF002' },
    ])
    expect(count).toBe(2)

    const pending = mock.listPendingBankTransactions()
    expect(pending.length).toBe(2)
  })

  it('J2: duplicate bank_ref is deduplicated', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Coffee', amount: -500, bank_ref: 'REF001' },
    ])
    const count = mock.importBankTransactions([
      { date: '2025-06-01', description: 'Coffee', amount: -500, bank_ref: 'REF001' },
    ])
    expect(count).toBe(0)
    expect(mock.listPendingBankTransactions().length).toBe(1)
  })

  it('J3: approve creates a balanced transaction', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Office supplies purchase', amount: -5000, bank_ref: 'REF001' },
    ])

    const pending = mock.listPendingBankTransactions()
    const supplies = find(mock, '5400')
    const txId = mock.approveBankTransaction(pending[0].id, supplies.id)

    const tx = mock.getTransactionDetail(txId)
    const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = tx.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalDebit).toBe(totalCredit)
    expect(totalDebit).toBe(5000)
  })

  it('J4: dismiss removes from pending list', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Unknown', amount: -100, bank_ref: 'REF001' },
    ])

    const pending = mock.listPendingBankTransactions()
    mock.dismissBankTransaction(pending[0].id)

    expect(mock.listPendingBankTransactions().length).toBe(0)
  })

  it('J5: positive amount creates deposit (debit cash, credit category)', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Client payment', amount: 50000, bank_ref: 'REF001' },
    ])

    const pending = mock.listPendingBankTransactions()
    const sales = find(mock, '4000')
    const cash = find(mock, '1000')
    const txId = mock.approveBankTransaction(pending[0].id, sales.id)

    const tx = mock.getTransactionDetail(txId)
    const cashEntry = tx.entries.find((e) => e.account_id === cash.id)!
    expect(cashEntry.debit).toBe(50000) // Cash debited (increased)
    expect(cashEntry.credit).toBe(0)
  })

  it('J6: approve into locked period throws', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Purchase', amount: -5000, bank_ref: 'REF001' },
    ])

    mock.lockPeriodGlobal('2025-06-30')

    const pending = mock.listPendingBankTransactions()
    const supplies = find(mock, '5400')
    expect(() => mock.approveBankTransaction(pending[0].id, supplies.id)).toThrow('locked period')
  })

  it('J7: approve with deactivated account throws', () => {
    mock.importBankTransactions([
      { date: '2025-06-01', description: 'Purchase', amount: -5000, bank_ref: 'REF001' },
    ])

    const supplies = find(mock, '5400')
    mock.deactivateAccount(supplies.id)

    const pending = mock.listPendingBankTransactions()
    expect(() => mock.approveBankTransaction(pending[0].id, supplies.id)).toThrow('deactivated account')
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY K: Reconciliation
// ────────────────────────────────────────────────────────────────
describe('K: Reconciliation', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('K1: start reconciliation captures book balance', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const recId = mock.startReconciliation(cash.id, '2025-06-30', 100000)
    const rec = mock.getReconciliation(recId)
    expect(rec.book_balance).toBe(100000)
    expect(rec.statement_balance).toBe(100000)
    expect(rec.difference).toBe(0)
  })

  it('K2: completing reconciliation marks entries as reconciled', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    // Before reconciliation, entries are unreconciled
    const unreconBefore = mock.getUnreconciledEntries(cash.id)
    expect(unreconBefore.length).toBe(1)

    const recId = mock.startReconciliation(cash.id, '2025-06-30', 100000)
    mock.completeReconciliation(recId)

    // After reconciliation, entries are marked reconciled
    const unreconAfter = mock.getUnreconciledEntries(cash.id)
    expect(unreconAfter.length).toBe(0)
  })

  it('K3: complete reconciliation succeeds when difference is zero', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const recId = mock.startReconciliation(cash.id, '2025-06-30', 100000)
    // Should not throw
    mock.completeReconciliation(recId)

    const rec = mock.getReconciliation(recId)
    expect(rec.is_reconciled).toBe(1)
  })

  it('K4: complete reconciliation throws when difference is non-zero', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    // Statement says 120000 but book says 100000
    const recId = mock.startReconciliation(cash.id, '2025-06-30', 120000)
    expect(() => mock.completeReconciliation(recId)).toThrow('difference')
  })

  it('K5: complete reconciliation locks the period', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const recId = mock.startReconciliation(cash.id, '2025-06-30', 100000)
    mock.completeReconciliation(recId)

    expect(mock.isDateLocked('2025-06-30')).toBe(true)
  })

  it('K6: reconciliation history tracks completed reconciliations', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    const recId = mock.startReconciliation(cash.id, '2025-06-30', 100000)
    mock.completeReconciliation(recId)

    const history = mock.listReconciliationHistory(cash.id)
    expect(history.length).toBe(1)
    expect(history[0].statement_date).toBe('2025-06-30')
  })

  it('K7: unreconciled entries query returns only unmatched entries', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    // Two transactions
    mock.createTransaction({ date: '2025-03-01', description: 'Sale 1', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Sale 2', entries: [
      { account_id: cash.id, debit: 80000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 80000 },
    ]})

    // Reconcile through June — only Sale 1 should be reconciled
    const recId = mock.startReconciliation(cash.id, '2025-06-30', 50000)
    mock.completeReconciliation(recId)

    // Sale 2 (July) should still be unreconciled
    const unrecon = mock.getUnreconciledEntries(cash.id)
    expect(unrecon.length).toBe(1)
    expect(unrecon[0].debit).toBe(80000)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY L: Cross-Feature Integration
// ────────────────────────────────────────────────────────────────
describe('L: Cross-Feature Integration', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('L1: opening balances + transactions + fiscal close = correct retained earnings', () => {
    const cash = find(mock, '1000')
    const equip = find(mock, '1500')
    const ap = find(mock, '2000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')
    const re = find(mock, '3200')

    // Opening balances
    mock.enterOpeningBalances([
      { account_id: cash.id, balance: 500000 },
      { account_id: equip.id, balance: 300000 },
      { account_id: ap.id, balance: 200000 },
    ], '2025-01-01')

    // Revenue and expenses during year
    mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 400000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 400000 },
    ]})
    mock.createTransaction({ date: '2025-07-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 150000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 150000 },
    ]})

    // Close fiscal year
    const result = mock.closeFiscalYear('2025-12-31')
    expect(result.net_income).toBe(250000) // 400000 - 150000

    expect(mock.getAccountBalance(re.id, '2025-12-31')).toBe(250000)

    const bs = mock.getBalanceSheet('2025-12-31')
    expect(bs.is_balanced).toBe(true)
  })

  it('L2: void + trial balance stays balanced', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    const txId = mock.createTransaction({ date: '2025-06-01', description: 'Sale', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 100000 },
    ]})

    mock.voidTransaction(txId)

    const tb = mock.getTrialBalance()
    expect(tb.is_balanced).toBe(true)
    // All balances should be zero after void
    expect(tb.total_debits).toBe(0)
    expect(tb.total_credits).toBe(0)
  })

  it('L3: recurring + void = net zero effect', () => {
    const cash = find(mock, '1000')
    const rent = find(mock, '5100')

    const tmplId = mock.createRecurring({
      description: 'Monthly rent',
      recurrence: 'MONTHLY',
      start_date: '2025-01-01',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    const txId = mock.generateRecurring(tmplId, '2025-01-01')
    mock.voidTransaction(txId)

    expect(mock.getAccountBalance(cash.id)).toBe(0)
    expect(mock.getAccountBalance(rent.id)).toBe(0)
  })

  it('L4: CSV import + trial balance stays balanced', () => {
    mock.importCsvRows([
      { date: '2025-06-01', description: 'Sale', account_code: '4000', debit: 0, credit: 50000 },
      { date: '2025-06-02', description: 'Rent', account_code: '5100', debit: 30000, credit: 0 },
    ])

    const tb = mock.getTrialBalance()
    expect(tb.is_balanced).toBe(true)
  })

  it('L5: bank feed approve + reconcile workflow', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.importBankTransactions([
      { date: '2025-06-15', description: 'Client payment', amount: 200000, bank_ref: 'REF001' },
    ])

    const pending = mock.listPendingBankTransactions()
    mock.approveBankTransaction(pending[0].id, sales.id)

    // Cash balance should now be 200000
    expect(mock.getAccountBalance(cash.id, '2025-06-30')).toBe(200000)

    // Reconcile
    const recId = mock.startReconciliation(cash.id, '2025-06-30', 200000)
    mock.completeReconciliation(recId)

    expect(mock.getReconciliation(recId).is_reconciled).toBe(1)
  })

  it('L6: lock period prevents edits across all entry points', () => {
    mock.lockPeriodGlobal('2025-06-30')

    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    // Direct createTransaction
    expect(() => mock.createTransaction({
      date: '2025-06-15', description: 'Blocked',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('locked period')

    // CSV import
    const csvResult = mock.importCsvRows([
      { date: '2025-06-15', description: 'Blocked CSV', account_code: '4000', debit: 0, credit: 10000 },
    ])
    expect(csvResult.imported).toBe(0)

    // Bank feed approve
    mock.importBankTransactions([
      { date: '2025-06-15', description: 'Blocked bank', amount: 10000, bank_ref: 'REFBLK' },
    ])
    const pending = mock.listPendingBankTransactions()
    expect(() => mock.approveBankTransaction(pending[0].id, sales.id)).toThrow('locked period')
  })

  it('L7: 100-transaction stress test — trial balance and balance sheet stay balanced', () => {
    const cash = find(mock, '1000')
    const ar = find(mock, '1100')
    const ap = find(mock, '2000')
    const sales = find(mock, '4000')
    const rent = find(mock, '5100')
    const wages = find(mock, '5300')

    // Create 100 varied transactions
    for (let i = 0; i < 25; i++) {
      mock.createTransaction({ date: '2025-03-15', description: `Cash sale ${i}`, entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ]})
    }
    for (let i = 0; i < 25; i++) {
      mock.createTransaction({ date: '2025-04-15', description: `Credit sale ${i}`, entries: [
        { account_id: ar.id, debit: 5000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 5000 },
      ]})
    }
    for (let i = 0; i < 25; i++) {
      mock.createTransaction({ date: '2025-05-15', description: `Rent ${i}`, entries: [
        { account_id: rent.id, debit: 3000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 3000 },
      ]})
    }
    for (let i = 0; i < 25; i++) {
      mock.createTransaction({ date: '2025-06-15', description: `Wages ${i}`, entries: [
        { account_id: wages.id, debit: 4000, credit: 0 },
        { account_id: ap.id, debit: 0, credit: 4000 },
      ]})
    }

    const tb = mock.getTrialBalance()
    expect(tb.is_balanced).toBe(true)

    const bs = mock.getBalanceSheet('2025-12-31')
    expect(bs.is_balanced).toBe(true)

    // Verify totals
    // Revenue: 25*10000 + 25*5000 = 375000
    // Expenses: 25*3000 + 25*4000 = 175000
    const is = mock.getIncomeStatement('2025-01-01', '2025-12-31')
    expect(is.total_revenue).toBe(375000)
    expect(is.total_expenses).toBe(175000)
    expect(is.net_income).toBe(200000)
  })
})

// ────────────────────────────────────────────────────────────────
// CATEGORY M: Hard Rules from CLAUDE.md
// ────────────────────────────────────────────────────────────────
describe('M: Hard Rules from CLAUDE.md', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('M1: all money is integer cents — no floats', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    // Use exact cent amounts
    mock.createTransaction({ date: '2025-06-01', description: 'Cent-precise', entries: [
      { account_id: cash.id, debit: 12345, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 12345 },
    ]})

    const balance = mock.getAccountBalance(cash.id)
    expect(Number.isInteger(balance)).toBe(true)
    expect(balance).toBe(12345)
  })

  it('M2: every transaction must balance — debits = credits', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    expect(() => mock.createTransaction({
      date: '2025-06-01', description: 'Unbalanced',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 9999 },
      ],
    })).toThrow('does not balance')
  })

  it('M3: deletes are voids (reversing entries), not actual deletion', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    const txId = mock.createTransaction({ date: '2025-06-01', description: 'To void', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    const voidTxId = mock.voidTransaction(txId)

    // Original is marked void, not deleted
    const original = mock.getTransactionDetail(txId)
    expect(original.is_void).toBe(1)

    // Void transaction exists as a reversing entry
    const voidTx = mock.getTransactionDetail(voidTxId)
    expect(voidTx.void_of).toBe(txId)

    // Net effect is zero
    expect(mock.getAccountBalance(cash.id)).toBe(0)
    expect(mock.getAccountBalance(sales.id)).toBe(0)
  })

  it('M4: period locks prevent transaction creation in locked period', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    mock.lockPeriodGlobal('2025-06-30')

    expect(() => mock.createTransaction({
      date: '2025-06-15', description: 'Locked',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })).toThrow('locked period')

    // After the locked date should work
    const txId = mock.createTransaction({
      date: '2025-07-01', description: 'Allowed',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 10000 },
      ],
    })
    expect(txId).toBeDefined()
  })

  it('M5: voided transactions are immutable — cannot edit after voiding', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    const txId = mock.createTransaction({ date: '2025-06-01', description: 'To void', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    mock.voidTransaction(txId)

    expect(() => mock.updateTransaction(txId, { description: 'Changed' })).toThrow('voided')
  })

  it('M6: reversing entries cannot be voided (no void-of-void chains)', () => {
    const cash = find(mock, '1000')
    const sales = find(mock, '4000')

    const txId = mock.createTransaction({ date: '2025-06-01', description: 'Original', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: sales.id, debit: 0, credit: 50000 },
    ]})

    const voidTxId = mock.voidTransaction(txId)

    // Trying to void the void should fail
    expect(() => mock.voidTransaction(voidTxId)).toThrow('reversing entry')
  })

  it('M7: deactivated accounts cannot receive new transactions', () => {
    const cash = find(mock, '1000')
    const supplies = find(mock, '5400')

    mock.deactivateAccount(supplies.id)

    expect(() => mock.createTransaction({
      date: '2025-06-01', description: 'Blocked',
      entries: [
        { account_id: supplies.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ],
    })).toThrow('deactivated account')
  })
})
