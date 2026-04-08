import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 32 — Dimensions/Tags Engine', () => {
  let mock: MockApi

  function findAccount(code: string) {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  // ── Dimension CRUD ─────────────────────────────────────

  it('create dimension and list by type', () => {
    const id1 = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const id2 = mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })
    const id3 = mock.createDimension({ dimType: 'LOCATION', name: 'New York' })

    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id3).toBeTruthy()

    const classDims = mock.listDimensions('CLASS')
    expect(classDims).toHaveLength(2)
    expect(classDims.map((d) => d.name)).toContain('Retail')
    expect(classDims.map((d) => d.name)).toContain('Wholesale')

    const locDims = mock.listDimensions('LOCATION')
    expect(locDims).toHaveLength(1)
    expect(locDims[0].name).toBe('New York')

    const all = mock.listDimensions()
    expect(all).toHaveLength(3)
  })

  it('create dimension with parent, hierarchy returned correctly', () => {
    const parentId = mock.createDimension({ dimType: 'LOCATION', name: 'US' })
    const childId = mock.createDimension({ dimType: 'LOCATION', name: 'New York', parentId })
    const grandchildId = mock.createDimension({ dimType: 'LOCATION', name: 'Manhattan', parentId: childId })

    const dims = mock.listDimensions('LOCATION')
    const us = dims.find((d) => d.id === parentId)!
    const ny = dims.find((d) => d.id === childId)!
    const manhattan = dims.find((d) => d.id === grandchildId)!

    expect(us.depth).toBe(0)
    expect(ny.depth).toBe(1)
    expect(ny.parent_id).toBe(parentId)
    expect(manhattan.depth).toBe(2)
    expect(manhattan.parent_id).toBe(childId)
  })

  it('cannot create duplicate dimension (same type + name)', () => {
    mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    expect(() => mock.createDimension({ dimType: 'CLASS', name: 'Retail' })).toThrow('already exists')
  })

  it('cannot create dimension with parent of different type', () => {
    const locId = mock.createDimension({ dimType: 'LOCATION', name: 'US' })
    expect(() =>
      mock.createDimension({ dimType: 'CLASS', name: 'Test', parentId: locId }),
    ).toThrow('does not match')
  })

  it('list dimension types returns distinct types', () => {
    mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    mock.createDimension({ dimType: 'LOCATION', name: 'NY' })
    mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })

    const types = mock.listDimensionTypes()
    expect(types).toEqual(['CLASS', 'LOCATION'])
  })

  it('delete dimension succeeds when no references', () => {
    const id = mock.createDimension({ dimType: 'CLASS', name: 'Temp' })
    mock.deleteDimension(id)
    expect(mock.listDimensions('CLASS')).toHaveLength(0)
  })

  it('cannot delete dimension with child dimensions', () => {
    const parentId = mock.createDimension({ dimType: 'LOCATION', name: 'US' })
    mock.createDimension({ dimType: 'LOCATION', name: 'NY', parentId })
    expect(() => mock.deleteDimension(parentId)).toThrow('child dimensions')
  })

  it('update dimension name and code', () => {
    const id = mock.createDimension({ dimType: 'CLASS', name: 'Old', code: 'OLD' })
    mock.updateDimension(id, { name: 'New', code: 'NEW' })
    const dims = mock.listDimensions('CLASS')
    expect(dims[0].name).toBe('New')
    expect(dims[0].code).toBe('NEW')
  })

  it('deactivate dimension', () => {
    const id = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    mock.updateDimension(id, { isActive: 0 })
    const dims = mock.listDimensions('CLASS')
    expect(dims[0].is_active).toBe(0)
  })

  // ── Transaction Integration ────────────────────────────

  it('create transaction with dimensions on lines', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const dimId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })

    const txId = mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Retail sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: dimId },
        { line_index: 1, dimension_id: dimId },
      ],
    })

    expect(txId).toBeTruthy()
    const dims = mock.getTransactionDimensions(txId)
    expect(dims).toHaveLength(2)
    expect(dims[0].dimension_type).toBe('CLASS')
    expect(dims[0].dimension_name).toBe('Retail')
  })

  it('cannot create transaction with inactive dimension', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const dimId = mock.createDimension({ dimType: 'CLASS', name: 'Old' })
    mock.updateDimension(dimId, { isActive: 0 })

    expect(() =>
      mock.createTransactionWithDimensions({
        date: '2026-01-15',
        description: 'Test',
        entries: [
          { account_id: cash.id, debit: 5000, credit: 0 },
          { account_id: revenue.id, debit: 0, credit: 5000 },
        ],
        dimensions: [{ line_index: 0, dimension_id: dimId }],
      }),
    ).toThrow('inactive dimension')
  })

  it('cannot delete dimension with transaction references', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const dimId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })

    mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [{ line_index: 0, dimension_id: dimId }],
    })

    expect(() => mock.deleteDimension(dimId)).toThrow('transaction references')
  })

  it('deactivated dimension excluded from active list but existing data preserved', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const dimId = mock.createDimension({ dimType: 'CLASS', name: 'Legacy' })

    const txId = mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [{ line_index: 0, dimension_id: dimId }],
    })

    mock.updateDimension(dimId, { isActive: 0 })

    // Dimension still in list (just inactive)
    const dims = mock.listDimensions('CLASS')
    expect(dims[0].is_active).toBe(0)

    // Transaction dimensions still preserved
    const txDims = mock.getTransactionDimensions(txId)
    expect(txDims).toHaveLength(1)
    expect(txDims[0].dimension_name).toBe('Legacy')
  })

  // ── Report Filtering ──────────────────────────────────

  it('dimension filter on trial balance returns only matching lines', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const expense = findAccount('5100')

    const retailId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const wholesaleId = mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })

    // Retail sale: $100
    mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Retail sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: retailId },
        { line_index: 1, dimension_id: retailId },
      ],
    })

    // Wholesale sale: $200
    mock.createTransactionWithDimensions({
      date: '2026-01-16',
      description: 'Wholesale sale',
      entries: [
        { account_id: cash.id, debit: 20000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 20000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: wholesaleId },
        { line_index: 1, dimension_id: wholesaleId },
      ],
    })

    // Untagged rent: $50
    mock.createTransaction({
      date: '2026-01-17',
      description: 'Rent',
      entries: [
        { account_id: expense.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ],
    })

    // Filter by Retail only
    const tb = mock.getTrialBalanceWithDimensions(undefined, undefined, [
      { type: 'CLASS', dimension_id: retailId },
    ])

    // Only retail-tagged lines should show
    const cashRow = tb.rows.find((r) => r.code === '1000')
    const revenueRow = tb.rows.find((r) => r.code === '4000')
    expect(cashRow?.debit).toBe(10000) // Only retail cash
    expect(revenueRow?.credit).toBe(10000) // Only retail revenue
    // Rent expense should not appear (no dimension tag)
    const rentRow = tb.rows.find((r) => r.code === '5100')
    expect(rentRow).toBeUndefined()
  })

  it('dimension filter on income statement returns only matching lines', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const expense = findAccount('5100')

    const retailId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })

    // Retail sale: $100
    mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Retail sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: retailId },
        { line_index: 1, dimension_id: retailId },
      ],
    })

    // Untagged expense: $50
    mock.createTransaction({
      date: '2026-01-17',
      description: 'Rent',
      entries: [
        { account_id: expense.id, debit: 5000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 5000 },
      ],
    })

    const is = mock.getIncomeStatementWithDimensions('2026-01-01', '2026-12-31', undefined, undefined, [
      { type: 'CLASS', dimension_id: retailId },
    ])

    expect(is.total_revenue).toBe(10000)
    expect(is.total_expenses).toBe(0) // rent has no dimension tag
    expect(is.net_income).toBe(10000)
  })

  it('AND logic: two different dimension types filter correctly', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const retailId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const nyId = mock.createDimension({ dimType: 'LOCATION', name: 'New York' })
    const sfId = mock.createDimension({ dimType: 'LOCATION', name: 'San Francisco' })

    // Retail + NY: $100
    mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Retail NY sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: retailId },
        { line_index: 0, dimension_id: nyId },
        { line_index: 1, dimension_id: retailId },
        { line_index: 1, dimension_id: nyId },
      ],
    })

    // Retail + SF: $200
    mock.createTransactionWithDimensions({
      date: '2026-01-16',
      description: 'Retail SF sale',
      entries: [
        { account_id: cash.id, debit: 20000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 20000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: retailId },
        { line_index: 0, dimension_id: sfId },
        { line_index: 1, dimension_id: retailId },
        { line_index: 1, dimension_id: sfId },
      ],
    })

    // Filter: CLASS=Retail AND LOCATION=NY (should only get $100)
    const tb = mock.getTrialBalanceWithDimensions(undefined, undefined, [
      { type: 'CLASS', dimension_id: retailId },
      { type: 'LOCATION', dimension_id: nyId },
    ])

    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow?.debit).toBe(10000) // Only NY retail
  })

  it('OR logic: two values of same type filter correctly', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const retailId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const wholesaleId = mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })
    const onlineId = mock.createDimension({ dimType: 'CLASS', name: 'Online' })

    // Retail: $100
    mock.createTransactionWithDimensions({
      date: '2026-01-15',
      description: 'Retail sale',
      entries: [
        { account_id: cash.id, debit: 10000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 10000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: retailId },
        { line_index: 1, dimension_id: retailId },
      ],
    })

    // Wholesale: $200
    mock.createTransactionWithDimensions({
      date: '2026-01-16',
      description: 'Wholesale sale',
      entries: [
        { account_id: cash.id, debit: 20000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 20000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: wholesaleId },
        { line_index: 1, dimension_id: wholesaleId },
      ],
    })

    // Online: $300
    mock.createTransactionWithDimensions({
      date: '2026-01-17',
      description: 'Online sale',
      entries: [
        { account_id: cash.id, debit: 30000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 30000 },
      ],
      dimensions: [
        { line_index: 0, dimension_id: onlineId },
        { line_index: 1, dimension_id: onlineId },
      ],
    })

    // Filter: CLASS=Retail OR CLASS=Wholesale (should get $300 total)
    const tb = mock.getTrialBalanceWithDimensions(undefined, undefined, [
      { type: 'CLASS', dimension_id: retailId },
      { type: 'CLASS', dimension_id: wholesaleId },
    ])

    const cashRow = tb.rows.find((r) => r.code === '1000')
    expect(cashRow?.debit).toBe(30000) // Retail + Wholesale
  })
})
