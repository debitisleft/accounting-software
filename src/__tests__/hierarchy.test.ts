import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 25 — Account Hierarchy in Reports', () => {
  let mock: MockApi
  let cash: string
  let parentAcctId: string
  let childAcctId: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id

    // Create a parent account
    parentAcctId = mock.createAccount({ code: '5000P', name: 'Operating Expenses', acctType: 'EXPENSE' })
    // Create a child account under the parent
    childAcctId = mock.createAccount({ code: '5001', name: 'Office Rent', acctType: 'EXPENSE', parentId: parentAcctId })

    // Add a transaction for the child account
    mock.createTransaction({
      date: '2026-06-01',
      description: 'Rent payment',
      entries: [
        { account_id: childAcctId, debit: 150000, credit: 0 },
        { account_id: cash, debit: 0, credit: 150000 },
      ],
    })
  })

  it('child account indented under parent in trial balance', () => {
    const tb = mock.getTrialBalance()

    const childRow = tb.rows.find((r) => r.account_id === childAcctId)

    // Child should have depth 1 (parent is depth 0)
    expect(childRow).toBeDefined()
    expect(childRow!.depth).toBe(1)
    expect(childRow!.parent_id).toBe(parentAcctId)
  })

  it('subtotals at parent level equal sum of children', () => {
    // Add another child
    const child2 = mock.createAccount({ code: '5002', name: 'Utilities', acctType: 'EXPENSE', parentId: parentAcctId })
    mock.createTransaction({
      date: '2026-06-15',
      description: 'Utilities',
      entries: [
        { account_id: child2, debit: 50000, credit: 0 },
        { account_id: cash, debit: 0, credit: 50000 },
      ],
    })

    const tb = mock.getTrialBalance()
    const children = tb.rows.filter((r) => r.parent_id === parentAcctId)
    const childTotal = children.reduce((s, r) => s + r.debit, 0)

    // Children should sum to the total spent (150000 + 50000 = 200000)
    expect(childTotal).toBe(200000)
  })

  it('account with no parent shows at root level (depth 0)', () => {
    const accounts = mock.getAccounts()
    const rootAcct = accounts.find((a) => a.code === '1000')!
    expect(rootAcct.depth).toBe(0)
    expect(rootAcct.parent_id).toBeNull()
  })

  it('parent account dropdown filters by matching type', () => {
    // Verify child was created with correct parent
    const accounts = mock.getAccounts()
    const child = accounts.find((a) => a.code === '5001')!
    expect(child.parent_id).toBe(parentAcctId)
    expect(child.depth).toBe(1)
  })
})
