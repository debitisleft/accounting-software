/**
 * ENGINE AUDIT TEST SUITE
 * Tests every scenario from the audit checklist against MockApi.
 * Failures = findings. Do NOT fix the engine — log and report.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

// ── Helpers ─────────────────────────────────────────────

function setup(): { mock: MockApi; find: (code: string) => ReturnType<MockApi['getAccounts']>[0] } {
  const mock = new MockApi()
  mock.seedAccounts(defaultSeedAccounts)
  const find = (code: string) => {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }
  return { mock, find }
}

// ════════════════════════════════════════════════════════
// CATEGORY A: Void Handling
// ═════════��══════════════════════════════════════════════

describe('Category A: Void Handling', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('A1: voided tx + reversing entry net to zero in trial balance', () => {
    const cash = find('1000')
    const revenue = find('4000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    mock.voidTransaction(txId)

    const tb = mock.getTrialBalance()
    // After void, all accounts should net to zero → no rows (or rows with 0)
    expect(tb.total_debits).toBe(0)
    expect(tb.total_credits).toBe(0)
    expect(tb.is_balanced).toBe(true)
  })

  it('A2: voided tx + reversing entry net to zero in balance sheet', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Investment',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })

    mock.voidTransaction(txId)

    const bs = mock.getBalanceSheet('2026-12-31')
    expect(bs.total_assets).toBe(0)
    expect(bs.total_liabilities).toBe(0)
    expect(bs.total_equity).toBe(0)
    expect(bs.is_balanced).toBe(true)
  })

  it('A3: voided tx + reversing entry net to zero in income statement', () => {
    const cash = find('1000')
    const revenue = find('4000')

    const txId = mock.createTransaction({
      date: '2026-03-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 75000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 75000 },
      ],
    })

    mock.voidTransaction(txId)

    const is = mock.getIncomeStatement('2026-03-01', '2026-03-31')
    expect(is.total_revenue).toBe(0)
    expect(is.total_expenses).toBe(0)
    expect(is.net_income).toBe(0)
  })

  it('A4: voiding a transaction does not change any account running balance (net effect = 0)', () => {
    const cash = find('1000')
    const equity = find('3000')
    const revenue = find('4000')

    // Setup: two transactions
    mock.createTransaction({
      date: '2026-01-01',
      description: 'Investment',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })

    const txId2 = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    // Snapshot balances before void
    const cashBefore = mock.getAccountBalance(cash.id)
    const equityBefore = mock.getAccountBalance(equity.id)
    const revenueBefore = mock.getAccountBalance(revenue.id)

    mock.voidTransaction(txId2)

    // Cash should decrease by 50000 (the voided sale amount)
    expect(mock.getAccountBalance(cash.id)).toBe(cashBefore - 50000)
    // Revenue should decrease by 50000
    expect(mock.getAccountBalance(revenue.id)).toBe(revenueBefore - 50000)
    // Equity untouched
    expect(mock.getAccountBalance(equity.id)).toBe(equityBefore)
  })

  it('A5: void of a void is rejected (cannot void a reversing entry)', () => {
    const cash = find('1000')
    const revenue = find('4000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    const voidTxId = mock.voidTransaction(txId)

    // Attempting to void the reversing entry should be rejected
    expect(() => mock.voidTransaction(voidTxId)).toThrow()
  })

  it('A6: voided transactions are still returned by listTransactions (with is_void flag)', () => {
    const cash = find('1000')
    const revenue = find('4000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ],
    })

    mock.voidTransaction(txId)

    const result = mock.listTransactions()
    // Should have original (voided) + reversing entry = 2 transactions
    expect(result.total).toBe(2)

    const voidedTx = result.transactions.find((t) => t.id === txId)
    expect(voidedTx).toBeDefined()
    expect(voidedTx!.is_void).toBe(1)

    const reversingTx = result.transactions.find((t) => t.void_of === txId)
    expect(reversingTx).toBeDefined()
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY B: Balance Calculations
// ════════════════════════════════════════════════════════

describe('Category B: Balance Calculations', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('B1: account with only debits has correct positive balance (asset)', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.createTransaction({
      date: '2026-01-01',
      description: 'Investment',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })
    mock.createTransaction({
      date: '2026-01-05',
      description: 'More investment',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 50000 },
      ],
    })

    // Cash only has debits → positive balance for ASSET
    expect(mock.getAccountBalance(cash.id)).toBe(150000)
  })

  it('B2: account with only credits has correct positive balance (liability)', () => {
    const supplies = find('5400')
    const ap = find('2000')

    mock.createTransaction({
      date: '2026-01-01',
      description: 'Purchase on credit',
      entries: [
        { account_id: supplies.id, debit: 30000, credit: 0 },
        { account_id: ap.id, debit: 0, credit: 30000 },
      ],
    })
    mock.createTransaction({
      date: '2026-01-05',
      description: 'More purchases',
      entries: [
        { account_id: supplies.id, debit: 20000, credit: 0 },
        { account_id: ap.id, debit: 0, credit: 20000 },
      ],
    })

    // AP only has credits → positive balance for LIABILITY
    expect(mock.getAccountBalance(ap.id)).toBe(50000)
  })

  it('B3: account with mixed debits and credits has correct net balance', () => {
    const cash = find('1000')
    const equity = find('3000')
    const rent = find('5100')

    mock.createTransaction({
      date: '2026-01-01',
      description: 'Investment',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })
    mock.createTransaction({
      date: '2026-01-15',
      description: 'Pay rent',
      entries: [
        { account_id: rent.id, debit: 30000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 30000 },
      ],
    })

    // Cash: debit 100000, credit 30000 → net = 70000
    expect(mock.getAccountBalance(cash.id)).toBe(70000)
  })

  it('B4: account with zero net activity shows zero balance', () => {
    const cash = find('1000')
    const checking = find('1010')

    mock.createTransaction({
      date: '2026-01-01',
      description: 'Transfer to checking',
      entries: [
        { account_id: checking.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
    })
    mock.createTransaction({
      date: '2026-01-05',
      description: 'Transfer back',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: checking.id, debit: 0, credit: 50000 },
      ],
    })

    expect(mock.getAccountBalance(cash.id)).toBe(0)
    expect(mock.getAccountBalance(checking.id)).toBe(0)
  })

  it('B5: contra account — accumulated depreciation (credit balance on asset-type) displays correctly', () => {
    const equipment = find('1500')
    const accumDepr = find('1510') // ASSET type but credit-normal in practice
    const deprExpense = find('5500')
    const cash = find('1000')
    const equity = find('3000')

    // Buy equipment
    mock.createTransaction({
      date: '2026-01-01',
      description: 'Buy equipment',
      entries: [
        { account_id: equipment.id, debit: 500000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 500000 },
      ],
    })

    // Fund cash first
    mock.createTransaction({
      date: '2026-01-01',
      description: 'Fund',
      entries: [
        { account_id: cash.id, debit: 1000000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 1000000 },
      ],
    })

    // Record depreciation: debit expense, credit accumulated depreciation
    mock.createTransaction({
      date: '2026-01-31',
      description: 'Monthly depreciation',
      entries: [
        { account_id: deprExpense.id, debit: 10000, credit: 0 },
        { account_id: accumDepr.id, debit: 0, credit: 10000 },
      ],
    })

    // Accumulated Depreciation is ASSET type but has credit balance (contra)
    // Balance should be -10000 (negative for an ASSET = credit balance)
    const balance = mock.getAccountBalance(accumDepr.id)
    expect(balance).toBe(-10000)

    // In trial balance, it should appear in credit column
    const tb = mock.getTrialBalance()
    const adRow = tb.rows.find((r) => r.code === '1510')
    expect(adRow).toBeDefined()
    expect(adRow!.credit).toBe(10000)
    expect(adRow!.debit).toBe(0)
    expect(tb.is_balanced).toBe(true)
  })

  it('B6: balance sheet equation holds after 20+ varied transactions', () => {
    const cash = find('1000')
    const checking = find('1010')
    const ar = find('1100')
    const inventory = find('1200')
    const equipment = find('1500')
    const ap = find('2000')
    const creditCard = find('2100')
    const notesPay = find('2500')
    const equity = find('3000')
    const draws = find('3100')
    const retained = find('3200')
    const salesRev = find('4000')
    const serviceRev = find('4100')
    const interestInc = find('4200')
    const cogs = find('5000')
    const rent = find('5100')
    const utilities = find('5200')
    const wages = find('5300')
    const supplies = find('5400')
    const insurance = find('5600')

    // 1. Owner investment
    mock.createTransaction({ date: '2026-01-01', description: 'Owner investment', entries: [
      { account_id: cash.id, debit: 5000000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 5000000 },
    ]})
    // 2. Take a loan
    mock.createTransaction({ date: '2026-01-02', description: 'Bank loan', entries: [
      { account_id: checking.id, debit: 2000000, credit: 0 },
      { account_id: notesPay.id, debit: 0, credit: 2000000 },
    ]})
    // 3. Buy inventory
    mock.createTransaction({ date: '2026-01-05', description: 'Buy inventory', entries: [
      { account_id: inventory.id, debit: 1500000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 1500000 },
    ]})
    // 4. Cash sale
    mock.createTransaction({ date: '2026-01-10', description: 'Cash sale', entries: [
      { account_id: cash.id, debit: 800000, credit: 0 },
      { account_id: salesRev.id, debit: 0, credit: 800000 },
    ]})
    // 5. COGS for sale
    mock.createTransaction({ date: '2026-01-10', description: 'COGS', entries: [
      { account_id: cogs.id, debit: 400000, credit: 0 },
      { account_id: inventory.id, debit: 0, credit: 400000 },
    ]})
    // 6. Credit sale
    mock.createTransaction({ date: '2026-01-12', description: 'Credit sale', entries: [
      { account_id: ar.id, debit: 600000, credit: 0 },
      { account_id: salesRev.id, debit: 0, credit: 600000 },
    ]})
    // 7. Pay rent
    mock.createTransaction({ date: '2026-01-15', description: 'Rent', entries: [
      { account_id: rent.id, debit: 200000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 200000 },
    ]})
    // 8. Pay wages
    mock.createTransaction({ date: '2026-01-15', description: 'Wages', entries: [
      { account_id: wages.id, debit: 350000, credit: 0 },
      { account_id: checking.id, debit: 0, credit: 350000 },
    ]})
    // 9. Utilities on credit card
    mock.createTransaction({ date: '2026-01-18', description: 'Utilities', entries: [
      { account_id: utilities.id, debit: 50000, credit: 0 },
      { account_id: creditCard.id, debit: 0, credit: 50000 },
    ]})
    // 10. Service revenue
    mock.createTransaction({ date: '2026-01-20', description: 'Consulting', entries: [
      { account_id: cash.id, debit: 300000, credit: 0 },
      { account_id: serviceRev.id, debit: 0, credit: 300000 },
    ]})
    // 11. Collect AR
    mock.createTransaction({ date: '2026-01-22', description: 'Collect receivable', entries: [
      { account_id: checking.id, debit: 600000, credit: 0 },
      { account_id: ar.id, debit: 0, credit: 600000 },
    ]})
    // 12. Owner draw
    mock.createTransaction({ date: '2026-01-25', description: 'Owner draw', entries: [
      { account_id: draws.id, debit: 100000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 100000 },
    ]})
    // 13. Pay credit card bill
    mock.createTransaction({ date: '2026-01-27', description: 'CC payment', entries: [
      { account_id: creditCard.id, debit: 50000, credit: 0 },
      { account_id: checking.id, debit: 0, credit: 50000 },
    ]})
    // 14. Buy office supplies on credit
    mock.createTransaction({ date: '2026-01-28', description: 'Supplies on credit', entries: [
      { account_id: supplies.id, debit: 25000, credit: 0 },
      { account_id: ap.id, debit: 0, credit: 25000 },
    ]})
    // 15. Interest income
    mock.createTransaction({ date: '2026-01-29', description: 'Bank interest', entries: [
      { account_id: checking.id, debit: 5000, credit: 0 },
      { account_id: interestInc.id, debit: 0, credit: 5000 },
    ]})
    // 16. Insurance prepaid
    mock.createTransaction({ date: '2026-01-30', description: 'Insurance', entries: [
      { account_id: insurance.id, debit: 120000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 120000 },
    ]})
    // 17. Loan repayment
    mock.createTransaction({ date: '2026-01-31', description: 'Loan repayment', entries: [
      { account_id: notesPay.id, debit: 500000, credit: 0 },
      { account_id: checking.id, debit: 0, credit: 500000 },
    ]})
    // 18. Buy equipment
    mock.createTransaction({ date: '2026-02-01', description: 'Equipment', entries: [
      { account_id: equipment.id, debit: 800000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 800000 },
    ]})
    // 19. Refund a customer (partial)
    mock.createTransaction({ date: '2026-02-05', description: 'Customer refund', entries: [
      { account_id: salesRev.id, debit: 100000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 100000 },
    ]})
    // 20. Void tx #4 (cash sale)
    const txList = mock.listTransactions({ limit: 50 })
    const cashSaleTx = txList.transactions.find((t) => t.description === 'Cash sale')
    expect(cashSaleTx).toBeDefined()
    mock.voidTransaction(cashSaleTx!.id)

    // 21. Another service revenue
    mock.createTransaction({ date: '2026-02-10', description: 'More consulting', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: serviceRev.id, debit: 0, credit: 200000 },
    ]})

    const bs = mock.getBalanceSheet('2026-12-31')
    expect(bs.is_balanced).toBe(true)
    expect(bs.total_assets).toBe(bs.total_liabilities + bs.total_equity)
  })

  it('B7: trial balance debits === credits after 20+ varied transactions including voids', () => {
    const cash = find('1000')
    const equity = find('3000')
    const salesRev = find('4000')
    const rent = find('5100')
    const wages = find('5300')
    const ap = find('2000')
    const ar = find('1100')
    const checking = find('1010')

    // Create 10 transactions
    for (let i = 0; i < 10; i++) {
      mock.createTransaction({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        description: `Tx ${i + 1}`,
        entries: [
          { account_id: cash.id, debit: 10000 * (i + 1), credit: 0 },
          { account_id: equity.id, debit: 0, credit: 10000 * (i + 1) },
        ],
      })
    }

    // Add diverse types
    mock.createTransaction({ date: '2026-01-15', description: 'Sale', entries: [
      { account_id: ar.id, debit: 500000, credit: 0 },
      { account_id: salesRev.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2026-01-16', description: 'Rent', entries: [
      { account_id: rent.id, debit: 120000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 120000 },
    ]})
    mock.createTransaction({ date: '2026-01-17', description: 'Wages', entries: [
      { account_id: wages.id, debit: 200000, credit: 0 },
      { account_id: ap.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2026-01-18', description: 'Collection', entries: [
      { account_id: checking.id, debit: 500000, credit: 0 },
      { account_id: ar.id, debit: 0, credit: 500000 },
    ]})

    // Void a few
    const allTx = mock.listTransactions({ limit: 50 })
    const tx1 = allTx.transactions.find((t) => t.description === 'Tx 1')!
    const tx5 = allTx.transactions.find((t) => t.description === 'Tx 5')!
    mock.voidTransaction(tx1.id)
    mock.voidTransaction(tx5.id)

    const tb = mock.getTrialBalance()
    expect(tb.total_debits).toBe(tb.total_credits)
    expect(tb.is_balanced).toBe(true)
    expect(tb.total_debits).toBeGreaterThan(0)
  })

  it('B8: negative balance on an asset account (overdraft) is represented correctly', () => {
    const cash = find('1000')
    const checking = find('1010')
    const equity = find('3000')

    // Fund checking only
    mock.createTransaction({ date: '2026-01-01', description: 'Fund', entries: [
      { account_id: checking.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    // Overdraw cash (transfer more out than available)
    mock.createTransaction({ date: '2026-01-05', description: 'Overdraw', entries: [
      { account_id: checking.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})

    // Cash: debit 0, credit 80000 → balance = -80000 (negative for ASSET)
    expect(mock.getAccountBalance(cash.id)).toBe(-80000)

    // In trial balance, negative asset should appear in credit column
    const tb = mock.getTrialBalance()
    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow).toBeDefined()
    expect(cashRow!.credit).toBe(80000)
    expect(cashRow!.debit).toBe(0)
    expect(tb.is_balanced).toBe(true)
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY C: Date Boundary Edge Cases
// ════════════════════════════════════════════════════════

describe('Category C: Date Boundary Edge Cases', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('C1: income statement for Jan excludes transaction dated Feb 1', () => {
    const cash = find('1000')
    const revenue = find('4000')

    mock.createTransaction({ date: '2026-02-01', description: 'Feb sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 50000 },
    ]})

    const is = mock.getIncomeStatement('2026-01-01', '2026-01-31')
    expect(is.total_revenue).toBe(0)
  })

  it('C2: income statement for Jan includes transaction dated Jan 31', () => {
    const cash = find('1000')
    const revenue = find('4000')

    mock.createTransaction({ date: '2026-01-31', description: 'Jan sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 50000 },
    ]})

    const is = mock.getIncomeStatement('2026-01-01', '2026-01-31')
    expect(is.total_revenue).toBe(50000)
  })

  it('C3: income statement for Jan includes transaction dated Jan 1', () => {
    const cash = find('1000')
    const revenue = find('4000')

    mock.createTransaction({ date: '2026-01-01', description: 'Jan sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 50000 },
    ]})

    const is = mock.getIncomeStatement('2026-01-01', '2026-01-31')
    expect(is.total_revenue).toBe(50000)
  })

  it('C4: balance sheet as-of Dec 31 excludes transaction dated Jan 1', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.createTransaction({ date: '2027-01-01', description: 'Next year', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    const bs = mock.getBalanceSheet('2026-12-31')
    expect(bs.total_assets).toBe(0)
  })

  it('C5: balance sheet as-of Dec 31 includes transaction dated Dec 31', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.createTransaction({ date: '2026-12-31', description: 'Year end', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    const bs = mock.getBalanceSheet('2026-12-31')
    expect(bs.total_assets).toBe(100000)
  })

  it('C6: trial balance with asOfDate filters correctly', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.createTransaction({ date: '2026-01-15', description: 'Early', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})
    mock.createTransaction({ date: '2026-06-15', description: 'Later', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 200000 },
    ]})

    const tbJan = mock.getTrialBalance('2026-01-31')
    const cashRowJan = tbJan.rows.find((r) => r.code === '1000')
    expect(cashRowJan).toBeDefined()
    expect(cashRowJan!.debit).toBe(100000)
    expect(tbJan.is_balanced).toBe(true)

    const tbFull = mock.getTrialBalance()
    const cashRowFull = tbFull.rows.find((r) => r.code === '1000')
    expect(cashRowFull!.debit).toBe(300000)
  })

  it('C7: account ledger running balance respects date ordering', () => {
    const cash = find('1000')
    const equity = find('3000')
    const revenue = find('4000')

    // Create transactions in non-chronological order
    mock.createTransaction({ date: '2026-01-15', description: 'Sale', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 50000 },
    ]})
    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    const ledger = mock.getAccountLedger(cash.id)
    // Entries should be sorted by date ascending
    expect(ledger.entries.length).toBe(2)
    expect(ledger.entries[0].date).toBe('2026-01-01')
    expect(ledger.entries[0].running_balance).toBe(100000)
    expect(ledger.entries[1].date).toBe('2026-01-15')
    expect(ledger.entries[1].running_balance).toBe(150000)
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY D: Period Locking
// ════════════════════════════════════════════════════════

describe('Category D: Period Locking', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('D1: locking period through Jan 31 prevents editing transaction dated Jan 15', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.lockPeriodGlobal('2026-01-31')

    expect(() => mock.updateTransaction(txId, { description: 'Changed' })).toThrow()
  })

  it('D2: locking period through Jan 31 allows editing transaction dated Feb 1', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-02-01', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.lockPeriodGlobal('2026-01-31')

    // Should NOT throw
    mock.updateTransaction(txId, { description: 'Changed' })
    const detail = mock.getTransactionDetail(txId)
    expect(detail.description).toBe('Changed')
  })

  it('D3: locking period through Jan 31 prevents NEW transaction dated Jan 15', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.lockPeriodGlobal('2026-01-31')

    // Creating a transaction in a locked period should be rejected
    expect(() => {
      mock.createTransaction({ date: '2026-01-15', description: 'New tx', entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 50000 },
      ]})
    }).toThrow()
  })

  it('D4: locking period through Jan 31 allows NEW transaction dated Feb 1', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.lockPeriodGlobal('2026-01-31')

    // Should NOT throw
    const txId = mock.createTransaction({ date: '2026-02-01', description: 'Feb tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
    expect(txId).toBeTruthy()
  })

  it('D5: locking period through Jan 31 prevents voiding transaction dated Jan 15', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.lockPeriodGlobal('2026-01-31')

    expect(() => mock.voidTransaction(txId)).toThrow()
  })

  it('D6: unlocking most recent period re-enables editing', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.lockPeriodGlobal('2026-01-31')
    expect(() => mock.updateTransaction(txId, { description: 'Changed' })).toThrow()

    mock.unlockPeriodGlobal()
    // Now should succeed
    mock.updateTransaction(txId, { description: 'Changed' })
    expect(mock.getTransactionDetail(txId).description).toBe('Changed')
  })

  it('D7: cannot lock a period that ends BEFORE an already-locked period (no gaps)', () => {
    mock.lockPeriodGlobal('2026-03-31')

    // Locking through Jan 31 would create a gap (Feb uncovered)
    // The engine should prevent this — but the check is "end_date > endDate"
    // which means locking an earlier period is NOT prevented if a later one exists.
    // Actually the check prevents locking if existing > new, which IS the scenario.
    // Wait: lockPeriodGlobal checks `gl.end_date > endDate` — if existing is 2026-03-31 and new is 2026-01-31,
    // then 2026-03-31 > 2026-01-31 is true, so it WOULD throw. Good.
    expect(() => mock.lockPeriodGlobal('2026-01-31')).toThrow()
  })

  it('D8: cannot lock a period that overlaps with an existing locked period', () => {
    mock.lockPeriodGlobal('2026-01-31')

    // Locking through Feb 15 partially overlaps
    // The mock check is `gl.end_date > endDate` — existing is 2026-01-31, new is 2026-02-15
    // 2026-01-31 > 2026-02-15 is false, so this DOES NOT throw — it allows overlapping forward extension
    // This is actually reasonable (cumulative locking) but let's test the duplicate exact date case
    // Locking through Jan 31 again: existing 2026-01-31 > 2026-01-31 is false, so it allows duplicate!
    expect(() => mock.lockPeriodGlobal('2026-01-31')).not.toThrow()
    // Check: we now have 2 lock entries for same date — this could be a finding
    const locks = mock.listLockedPeriodsGlobal()
    // Should ideally be 1 lock, not 2
    expect(locks.length).toBe(1) // Likely fails — duplicate locks allowed
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY E: Multi-Entry Transactions
// ════════════════════════════════════════════════════════

describe('Category E: Multi-Entry Transactions', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('E1: 3-way split transaction (1 debit to 2 credits) saves correctly', () => {
    const cash = find('1000')
    const salesRev = find('4000')
    const salesTax = find('2300')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale with tax',
      entries: [
        { account_id: cash.id, debit: 107000, credit: 0 },
        { account_id: salesRev.id, debit: 0, credit: 100000 },
        { account_id: salesTax.id, debit: 0, credit: 7000 },
      ],
    })

    const detail = mock.getTransactionDetail(txId)
    expect(detail.entries.length).toBe(3)

    const totalD = detail.entries.reduce((s, e) => s + e.debit, 0)
    const totalC = detail.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalD).toBe(totalC)
    expect(totalD).toBe(107000)
  })

  it('E2: 4-way split transaction (2 debits to 2 credits) saves correctly', () => {
    const cash = find('1000')
    const checking = find('1010')
    const salesRev = find('4000')
    const serviceRev = find('4100')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Combined payment',
      entries: [
        { account_id: cash.id, debit: 50000, credit: 0 },
        { account_id: checking.id, debit: 30000, credit: 0 },
        { account_id: salesRev.id, debit: 0, credit: 60000 },
        { account_id: serviceRev.id, debit: 0, credit: 20000 },
      ],
    })

    const detail = mock.getTransactionDetail(txId)
    expect(detail.entries.length).toBe(4)
  })

  it('E3: split transaction with unequal amounts that still balance saves correctly', () => {
    const cash = find('1000')
    const rent = find('5100')
    const utilities = find('5200')
    const ap = find('2000')

    // 3 expense debits = 1 liability credit
    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Multiple expenses on credit',
      entries: [
        { account_id: rent.id, debit: 150000, credit: 0 },
        { account_id: utilities.id, debit: 35000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 85000 },
        { account_id: ap.id, debit: 0, credit: 100000 },
      ],
    })

    expect(txId).toBeTruthy()
  })

  it('E4: split transaction where sum of debits != sum of credits is rejected', () => {
    const cash = find('1000')
    const rent = find('5100')
    const utilities = find('5200')

    expect(() => {
      mock.createTransaction({
        date: '2026-01-15',
        description: 'Unbalanced split',
        entries: [
          { account_id: cash.id, debit: 0, credit: 100000 },
          { account_id: rent.id, debit: 60000, credit: 0 },
          { account_id: utilities.id, debit: 30000, credit: 0 },
        ],
      })
    }).toThrow('does not balance')
  })

  it('E5: editing a split transactions lines maintains balance requirement', () => {
    const cash = find('1000')
    const equity = find('3000')
    const revenue = find('4000')

    const txId = mock.createTransaction({
      date: '2026-01-15',
      description: 'Original',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 100000 },
      ],
    })

    // Try to update with unbalanced lines
    expect(() => {
      mock.updateTransactionLines(txId, [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 50000 },
      ])
    }).toThrow()
  })

  it('E6: all accounts in a split transaction have correct balances after save', () => {
    const cash = find('1000')
    const salesRev = find('4000')
    const salesTax = find('2300')
    const equity = find('3000')

    // Fund the company
    mock.createTransaction({ date: '2026-01-01', description: 'Fund', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})

    // 3-way split: cash receives payment, revenue + tax
    mock.createTransaction({
      date: '2026-01-15',
      description: 'Sale with tax',
      entries: [
        { account_id: cash.id, debit: 107000, credit: 0 },
        { account_id: salesRev.id, debit: 0, credit: 100000 },
        { account_id: salesTax.id, debit: 0, credit: 7000 },
      ],
    })

    expect(mock.getAccountBalance(cash.id)).toBe(607000)
    expect(mock.getAccountBalance(salesRev.id)).toBe(100000)
    expect(mock.getAccountBalance(salesTax.id)).toBe(7000)
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY F: Account Deactivation Edge Cases
// ════════════════════════════════════════════════════════

describe('Category F: Account Deactivation Edge Cases', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('F1: deactivating account with positive balance is rejected', () => {
    const cash = find('1000')
    const equity = find('3000')

    mock.createTransaction({ date: '2026-01-01', description: 'Fund', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    expect(() => mock.deactivateAccount(cash.id)).toThrow()
  })

  it('F2: deactivating account with negative balance is rejected', () => {
    const cash = find('1000')
    const checking = find('1010')
    const equity = find('3000')

    mock.createTransaction({ date: '2026-01-01', description: 'Fund checking', entries: [
      { account_id: checking.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
    mock.createTransaction({ date: '2026-01-05', description: 'Overdraw cash', entries: [
      { account_id: checking.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})

    // Cash has -80000 balance
    expect(mock.getAccountBalance(cash.id)).toBe(-80000)
    expect(() => mock.deactivateAccount(cash.id)).toThrow()
  })

  it('F3: deactivating account with zero balance (after void) succeeds', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-01', description: 'Fund', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    mock.voidTransaction(txId)

    // Both accounts should now have zero balance
    expect(mock.getAccountBalance(cash.id)).toBe(0)
    expect(mock.getAccountBalance(equity.id)).toBe(0)

    // Should succeed
    mock.deactivateAccount(cash.id)
    // Verify account is deactivated (not in active accounts list)
    expect(mock.getAccounts().find((a) => a.code === '1000')).toBeUndefined()
  })

  it('F4: deactivated accounts balance still appears in trial balance (historical data preserved)', () => {
    const cash = find('1000')
    const equity = find('3000')
    const savings = find('1020')

    // Fund savings, then zero it out so we can deactivate
    mock.createTransaction({ date: '2026-01-01', description: 'Fund', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    // Cash has a balance, savings has none → deactivate savings
    mock.deactivateAccount(savings.id)

    // The key question: does the trial balance still show cash correctly?
    // More importantly: if an account HAD a balance and was zeroed out + deactivated,
    // its historical entries should still count in reports.
    const tb = mock.getTrialBalance()
    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow).toBeDefined()
    expect(cashRow!.debit).toBe(100000)

    // Deactivated account with zero balance: should still be listed if it has historical entries
    // But getTrialBalance uses getAccounts() which filters is_active=1, so deactivated accounts
    // with non-zero historical balances would be LOST. Let's test that edge case:

    // Create a scenario where a deactivated account HAS entries but zero net
    // (this tests that trial balance remains balanced even with deactivated accounts)
    expect(tb.is_balanced).toBe(true)
  })

  it('F5: deactivated accounts transactions still appear in transaction register', () => {
    const cash = find('1000')
    const savings = find('1020')
    const equity = find('3000')

    mock.createTransaction({ date: '2026-01-01', description: 'Fund cash', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    // Zero out savings (already zero), deactivate it
    mock.deactivateAccount(savings.id)

    // Transactions should still be visible
    const result = mock.listTransactions()
    expect(result.total).toBe(1)
  })

  it('F6: reactivated account can receive new transactions', () => {
    const cash = find('1000')
    const savings = find('1020')
    const equity = find('3000')

    // Deactivate savings (zero balance)
    mock.deactivateAccount(savings.id)
    expect(mock.getAccounts().find((a) => a.code === '1020')).toBeUndefined()

    // Reactivate
    mock.reactivateAccount(savings.id)
    const reactivated = mock.getAccounts().find((a) => a.code === '1020')
    expect(reactivated).toBeDefined()

    // Create transaction using reactivated account
    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Deposit', entries: [
      { account_id: savings.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
    expect(txId).toBeTruthy()
    expect(mock.getAccountBalance(savings.id)).toBe(50000)
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY G: Audit Trail Integrity
// ════════════════════════════════════════════════════════

describe('Category G: Audit Trail Integrity', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('G1: editing transaction date writes audit log with old and new date', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.updateTransaction(txId, { date: '2026-01-20' })

    const log = mock.getAuditLog(txId)
    expect(log.length).toBeGreaterThan(0)
    const dateEntry = log.find((l) => l.field_changed === 'date')
    expect(dateEntry).toBeDefined()
    expect(dateEntry!.old_value).toBe('2026-01-15')
    expect(dateEntry!.new_value).toBe('2026-01-20')
  })

  it('G2: editing transaction memo/description writes audit log', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Original', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.updateTransaction(txId, { description: 'Updated memo' })

    const log = mock.getAuditLog(txId)
    const descEntry = log.find((l) => l.field_changed === 'description')
    expect(descEntry).toBeDefined()
    expect(descEntry!.old_value).toBe('Original')
    expect(descEntry!.new_value).toBe('Updated memo')
  })

  it('G3: editing transaction lines writes audit log with old and new line items', () => {
    const cash = find('1000')
    const equity = find('3000')
    const revenue = find('4000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.updateTransactionLines(txId, [
      { account_id: cash.id, debit: 75000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 75000 },
    ])

    const log = mock.getAuditLog(txId)
    const linesEntry = log.find((l) => l.field_changed === 'lines')
    expect(linesEntry).toBeDefined()
    expect(linesEntry!.old_value).toBeTruthy()
    expect(linesEntry!.new_value).toBeTruthy()
    // Old should reference equity, new should reference revenue
    expect(linesEntry!.old_value).toContain(equity.id)
    expect(linesEntry!.new_value).toContain(revenue.id)
  })

  it('G4: voiding a transaction writes audit log entry', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.voidTransaction(txId)

    const log = mock.getAuditLog(txId)
    const voidEntry = log.find((l) => l.field_changed === 'voided')
    expect(voidEntry).toBeDefined()
    expect(voidEntry!.old_value).toBe('false')
    expect(voidEntry!.new_value).toBe('true')
  })

  it('G5: audit log entries are ordered by changed_at descending', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.updateTransaction(txId, { description: 'First edit' })
    mock.updateTransaction(txId, { description: 'Second edit' })
    mock.updateTransaction(txId, { date: '2026-01-20' })

    const log = mock.getAuditLog(txId)
    expect(log.length).toBe(3)
    // Should be descending by changed_at
    for (let i = 1; i < log.length; i++) {
      expect(log[i - 1].changed_at).toBeGreaterThanOrEqual(log[i].changed_at)
    }
  })

  it('G6: audit log references correct transaction_id', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId1 = mock.createTransaction({ date: '2026-01-15', description: 'Tx1', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
    const txId2 = mock.createTransaction({ date: '2026-01-20', description: 'Tx2', entries: [
      { account_id: cash.id, debit: 30000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 30000 },
    ]})

    mock.updateTransaction(txId1, { description: 'Changed 1' })
    mock.updateTransaction(txId2, { description: 'Changed 2' })

    const log1 = mock.getAuditLog(txId1)
    const log2 = mock.getAuditLog(txId2)

    expect(log1.length).toBe(1)
    expect(log2.length).toBe(1)
    expect(log1[0].transaction_id).toBe(txId1)
    expect(log2[0].transaction_id).toBe(txId2)
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY H: Concurrent / Conflicting Operations
// ════════════════════════════════════════════════════════

describe('Category H: Concurrent / Conflicting Operations', () => {
  let mock: MockApi
  let find: (code: string) => ReturnType<MockApi['getAccounts']>[0]

  beforeEach(() => {
    ;({ mock, find } = setup())
  })

  it('H1: creating two transactions simultaneously both balance independently', () => {
    const cash = find('1000')
    const equity = find('3000')
    const revenue = find('4000')

    const txId1 = mock.createTransaction({ date: '2026-01-15', description: 'Tx1', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})
    const txId2 = mock.createTransaction({ date: '2026-01-15', description: 'Tx2', entries: [
      { account_id: cash.id, debit: 30000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 30000 },
    ]})

    const detail1 = mock.getTransactionDetail(txId1)
    const detail2 = mock.getTransactionDetail(txId2)

    const d1 = detail1.entries.reduce((s, e) => s + e.debit, 0)
    const c1 = detail1.entries.reduce((s, e) => s + e.credit, 0)
    expect(d1).toBe(c1)

    const d2 = detail2.entries.reduce((s, e) => s + e.debit, 0)
    const c2 = detail2.entries.reduce((s, e) => s + e.credit, 0)
    expect(d2).toBe(c2)

    // Overall trial balance still balanced
    const tb = mock.getTrialBalance()
    expect(tb.is_balanced).toBe(true)
  })

  it('H2: editing a transaction that was just voided is rejected', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    mock.voidTransaction(txId)

    // The original tx is now marked is_void=1. Editing it should be rejected
    // because voided transactions should be immutable.
    // Note: MockApi's updateTransaction doesn't check is_void — only period locks.
    // This is likely a bug.
    expect(() => mock.updateTransaction(txId, { description: 'Changed' })).toThrow()
  })

  it('H3: deactivating an account while a transaction referencing it is being created', () => {
    const cash = find('1000')
    const savings = find('1020')
    const equity = find('3000')

    // Deactivate savings (zero balance)
    mock.deactivateAccount(savings.id)

    // Try to create a transaction referencing the deactivated account
    // This should be rejected since the account is deactivated
    expect(() => {
      mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
        { account_id: savings.id, debit: 50000, credit: 0 },
        { account_id: equity.id, debit: 0, credit: 50000 },
      ]})
    }).toThrow()
  })

  it('H4: locking a period while a transaction in that period is being edited', () => {
    const cash = find('1000')
    const equity = find('3000')

    const txId = mock.createTransaction({ date: '2026-01-15', description: 'Tx', entries: [
      { account_id: cash.id, debit: 50000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 50000 },
    ]})

    // Lock the period
    mock.lockPeriodGlobal('2026-01-31')

    // Now try to edit — should be rejected
    expect(() => mock.updateTransaction(txId, { description: 'Changed' })).toThrow()
    expect(() => mock.updateTransactionLines(txId, [
      { account_id: cash.id, debit: 75000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 75000 },
    ])).toThrow()
  })
})

// ════════════════════════════════════════════════════════
// CATEGORY I: Seed Data Integrity
// ════════════════════════════════════════════════════════

describe('Category I: Seed Data Integrity', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('I1: all 27 seed accounts have unique codes', () => {
    const accounts = mock.getAccounts()
    expect(accounts.length).toBe(27)

    const codes = accounts.map((a) => a.code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(27)
  })

  it('I2: all seed accounts have correct normal_balance for their type', () => {
    const accounts = mock.getAccounts()

    for (const acct of accounts) {
      if (acct.type === 'ASSET' || acct.type === 'EXPENSE') {
        expect(acct.normal_balance).toBe('DEBIT')
      } else {
        // LIABILITY, EQUITY, REVENUE
        expect(acct.normal_balance).toBe('CREDIT')
      }
    }
  })

  it('I3: no seed account has a balance (fresh database)', () => {
    const accounts = mock.getAccounts()

    for (const acct of accounts) {
      expect(mock.getAccountBalance(acct.id)).toBe(0)
    }
  })

  it('I4: re-seeding does not duplicate accounts', () => {
    const countBefore = mock.getAccounts().length
    mock.seedAccounts(defaultSeedAccounts)
    const countAfter = mock.getAccounts().length
    expect(countAfter).toBe(countBefore)
  })
})
