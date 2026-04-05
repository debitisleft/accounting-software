import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 14 — CSV Export', () => {
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
    const revenue = findAccount('4000')
    const rent = findAccount('5100')

    mock.createTransaction({ date: '2026-01-01', description: 'Investment', entries: [
      { account_id: cash.id, debit: 500000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 500000 },
    ]})
    mock.createTransaction({ date: '2026-02-15', description: 'Sale', entries: [
      { account_id: cash.id, debit: 200000, credit: 0 },
      { account_id: revenue.id, debit: 0, credit: 200000 },
    ]})
    mock.createTransaction({ date: '2026-03-01', description: 'Rent', entries: [
      { account_id: rent.id, debit: 80000, credit: 0 },
      { account_id: cash.id, debit: 0, credit: 80000 },
    ]})
  })

  it('transaction register CSV has correct headers and row count', () => {
    const csv = mock.exportCsv('TransactionRegister')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Date,Reference,Description,Account,Debit,Credit')
    // 3 transactions × 2 entries each = 6 data rows
    expect(lines.length).toBe(7) // header + 6 rows
  })

  it('amounts formatted as decimal dollars (not cents)', () => {
    const csv = mock.exportCsv('TransactionRegister')
    // $5,000.00 = 500000 cents should appear as 5000.00
    expect(csv).toContain('5000.00')
    // Should NOT contain raw cent values
    expect(csv).not.toContain('500000')
  })

  it('trial balance CSV debits === credits', () => {
    const csv = mock.exportCsv('TrialBalance')
    const lines = csv.trim().split('\n')
    const totalLine = lines[lines.length - 1]
    expect(totalLine).toContain('TOTAL')
    // Parse the total debits and credits
    const parts = totalLine.split(',')
    const totalDebits = parts[2]
    const totalCredits = parts[3]
    expect(totalDebits).toBe(totalCredits)
  })

  it('date filter applies to transaction register export', () => {
    const csv = mock.exportCsv('TransactionRegister', { startDate: '2026-02-01', endDate: '2026-02-28' })
    const lines = csv.trim().split('\n')
    // Only February sale = 1 transaction × 2 entries = 2 data rows + header
    expect(lines.length).toBe(3)
    expect(csv).toContain('Sale')
    expect(csv).not.toContain('Investment')
    expect(csv).not.toContain('Rent')
  })

  it('chart of accounts CSV includes all accounts', () => {
    const csv = mock.exportCsv('ChartOfAccounts')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Account Number,Account Name,Type,Active,Balance')
    expect(lines.length).toBe(27) // header + 26 accounts
  })

  it('income statement CSV shows net income', () => {
    const csv = mock.exportCsv('IncomeStatement')
    expect(csv).toContain('Net Income')
    // Revenue 2000 - Rent 800 = 1200
    expect(csv).toContain('1200.00')
  })
})
