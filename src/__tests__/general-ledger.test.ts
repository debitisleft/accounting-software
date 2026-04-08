import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 34 — General Ledger View', () => {
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

  it('GL for single account returns correct entries and running balance', () => {
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const revenue = findAccount('4000')

    // Two transactions touching cash
    mock.createTransaction({
      date: '2025-01-10',
      description: 'Revenue received',
      entries: [
        { account_id: cash.id, debit: 500000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 500000 },
      ],
    })

    mock.createTransaction({
      date: '2025-01-20',
      description: 'Rent payment',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    const gl = mock.getGeneralLedger({ account_id: cash.id })
    expect(gl).toHaveLength(1)
    const cashGroup = gl[0]
    expect(cashGroup.account.code).toBe('1000')
    expect(cashGroup.opening_balance).toBe(0) // no start_date
    expect(cashGroup.entries).toHaveLength(2)

    // Cash is debit-normal: running = debit - credit
    expect(cashGroup.entries[0].debit).toBe(500000)
    expect(cashGroup.entries[0].running_balance).toBe(500000)
    expect(cashGroup.entries[1].credit).toBe(100000)
    expect(cashGroup.entries[1].running_balance).toBe(400000)

    expect(cashGroup.closing_balance).toBe(400000)
    expect(cashGroup.total_debits).toBe(500000)
    expect(cashGroup.total_credits).toBe(100000)
  })

  it('GL opening balance correct when start_date excludes earlier transactions', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    // January transaction
    mock.createTransaction({
      date: '2025-01-15',
      description: 'Jan revenue',
      entries: [
        { account_id: cash.id, debit: 300000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 300000 },
      ],
    })

    // February transaction
    mock.createTransaction({
      date: '2025-02-15',
      description: 'Feb rent',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    // GL starting from Feb — Jan tx is opening balance
    const gl = mock.getGeneralLedger({ account_id: cash.id, start_date: '2025-02-01' })
    expect(gl).toHaveLength(1)
    const cashGroup = gl[0]
    expect(cashGroup.opening_balance).toBe(300000) // Jan debit to cash
    expect(cashGroup.entries).toHaveLength(1) // Only Feb entry
    expect(cashGroup.entries[0].description).toBe('Feb rent')
    expect(cashGroup.entries[0].running_balance).toBe(200000) // 300000 - 100000
    expect(cashGroup.closing_balance).toBe(200000)
  })

  it('GL with dimension filter returns only matching lines', () => {
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const supplies = findAccount('5400')

    const retailDim = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const wholeDim = mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })

    // Rent tagged as Retail
    mock.createTransactionWithDimensions({
      date: '2025-01-10',
      description: 'Retail rent',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      dimensions: [{ line_index: 0, dimension_id: retailDim }],
    })

    // Supplies tagged as Wholesale
    mock.createTransactionWithDimensions({
      date: '2025-01-15',
      description: 'Wholesale supplies',
      entries: [
        { account_id: supplies.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
      dimensions: [{ line_index: 0, dimension_id: wholeDim }],
    })

    // Filter by Retail dimension
    const gl = mock.getGeneralLedger({
      dimension_filters: [{ type: 'CLASS', dimension_id: retailDim }],
    })

    // Rent line tagged Retail should appear
    const rentGroup = gl.find((g) => g.account.code === '5100')
    expect(rentGroup).toBeDefined()
    expect(rentGroup!.entries).toHaveLength(1)

    // Supplies line tagged Wholesale should NOT appear
    const suppliesGroup = gl.find((g) => g.account.code === '5400')
    expect(suppliesGroup).toBeUndefined()
  })

  it('GL with contact filter returns only matching transactions', () => {
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const supplies = findAccount('5400')

    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })

    // Transaction WITH contact
    mock.createTransactionWithContact({
      date: '2025-01-10',
      description: 'Acme rent',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
    })

    // Transaction WITHOUT contact
    mock.createTransaction({
      date: '2025-01-20',
      description: 'Other supplies',
      entries: [
        { account_id: supplies.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
    })

    const gl = mock.getGeneralLedger({ contact_id: contactId })

    // Only Acme transactions
    const rentGroup = gl.find((g) => g.account.code === '5100')
    expect(rentGroup).toBeDefined()
    expect(rentGroup!.entries).toHaveLength(1)
    expect(rentGroup!.entries[0].contact_name).toBe('Acme Corp')

    // Supplies should NOT appear
    const suppliesGroup = gl.find((g) => g.account.code === '5400')
    expect(suppliesGroup).toBeUndefined()
  })

  it('GL with date range returns only entries within range', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    mock.createTransaction({
      date: '2025-01-10',
      description: 'Jan',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })
    mock.createTransaction({
      date: '2025-02-10',
      description: 'Feb',
      entries: [
        { account_id: cash.id, debit: 200000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 200000 },
      ],
    })
    mock.createTransaction({
      date: '2025-03-10',
      description: 'Mar',
      entries: [
        { account_id: cash.id, debit: 300000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 300000 },
      ],
    })

    const gl = mock.getGeneralLedger({
      account_id: cash.id,
      start_date: '2025-02-01',
      end_date: '2025-02-28',
    })

    expect(gl).toHaveLength(1)
    expect(gl[0].entries).toHaveLength(1) // Only Feb
    expect(gl[0].entries[0].description).toBe('Feb')
    expect(gl[0].opening_balance).toBe(100000) // Jan debit
  })

  it('GL running balance matches closing balance at end', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    mock.createTransaction({
      date: '2025-01-05',
      description: 'Revenue',
      entries: [
        { account_id: cash.id, debit: 1000000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 1000000 },
      ],
    })
    mock.createTransaction({
      date: '2025-01-10',
      description: 'Rent',
      entries: [
        { account_id: rent.id, debit: 250000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 250000 },
      ],
    })
    mock.createTransaction({
      date: '2025-01-15',
      description: 'More revenue',
      entries: [
        { account_id: cash.id, debit: 500000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 500000 },
      ],
    })

    const gl = mock.getGeneralLedger({ account_id: cash.id })
    const group = gl[0]
    const lastEntry = group.entries[group.entries.length - 1]
    expect(lastEntry.running_balance).toBe(group.closing_balance)
    expect(group.closing_balance).toBe(1250000) // 1000000 - 250000 + 500000
  })

  it('GL excludes voided entries by default, includes when toggled', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const txId = mock.createTransaction({
      date: '2025-01-10',
      description: 'Will be voided',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    mock.createTransaction({
      date: '2025-01-15',
      description: 'Normal tx',
      entries: [
        { account_id: cash.id, debit: 200000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 200000 },
      ],
    })

    // Void the first transaction
    mock.voidTransaction(txId)

    // Default: no voided entries
    const glDefault = mock.getGeneralLedger({ account_id: cash.id })
    const defaultGroup = glDefault[0]
    // Should have normal tx + void reversal (which is not void itself, it's REVERSING)
    const nonVoidEntries = defaultGroup.entries.filter((e) => !e.is_void)
    expect(nonVoidEntries.length).toBeGreaterThan(0)
    // Original voided tx should not appear
    const voidedEntries = defaultGroup.entries.filter((e) => e.is_void)
    expect(voidedEntries).toHaveLength(0)

    // Include void
    const glVoid = mock.getGeneralLedger({ account_id: cash.id, include_void: true })
    const voidGroup = glVoid[0]
    const voidedNow = voidGroup.entries.filter((e) => e.is_void)
    expect(voidedNow.length).toBeGreaterThan(0)
  })

  it('GL for multiple accounts returns separate groups', () => {
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const revenue = findAccount('4000')

    mock.createTransaction({
      date: '2025-01-10',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    mock.createTransaction({
      date: '2025-01-15',
      description: 'Rent',
      entries: [
        { account_id: rent.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
    })

    const gl = mock.getGeneralLedger({
      account_ids: [cash.id, rent.id, revenue.id],
    })

    expect(gl.length).toBe(3)
    const codes = gl.map((g) => g.account.code).sort()
    expect(codes).toEqual(['1000', '4000', '5100'])
  })

  it('GL total debits and total credits across all accounts', () => {
    const cash = findAccount('1000')
    const rent = findAccount('5100')

    mock.createTransaction({
      date: '2025-01-10',
      description: 'Rent',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
    })

    const gl = mock.getGeneralLedger()
    // Sum total debits and credits across all groups
    const grandTotalDebits = gl.reduce((s, g) => s + g.total_debits, 0)
    const grandTotalCredits = gl.reduce((s, g) => s + g.total_credits, 0)
    expect(grandTotalDebits).toBe(grandTotalCredits) // balanced transaction
    expect(grandTotalDebits).toBe(100000)
  })

  it('GL entries are date-ordered ascending within each account', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    // Create in reverse date order
    mock.createTransaction({
      date: '2025-03-01',
      description: 'March',
      entries: [
        { account_id: cash.id, debit: 300000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 300000 },
      ],
    })
    mock.createTransaction({
      date: '2025-01-01',
      description: 'January',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })
    mock.createTransaction({
      date: '2025-02-01',
      description: 'February',
      entries: [
        { account_id: cash.id, debit: 200000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 200000 },
      ],
    })

    const gl = mock.getGeneralLedger({ account_id: cash.id })
    const dates = gl[0].entries.map((e) => e.date)
    expect(dates).toEqual(['2025-01-01', '2025-02-01', '2025-03-01'])
  })
})
