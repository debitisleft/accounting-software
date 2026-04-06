import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 28 — Recurring Transactions', () => {
  let mock: MockApi
  let cash: string
  let rent: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    rent = accounts.find((a) => a.code === '5100')!.id
  })

  it('recurring template generates correct transaction on due date', () => {
    const tmplId = mock.createRecurring({
      description: 'Monthly Rent',
      recurrence: 'MONTHLY',
      start_date: '2026-01-01',
      entries: [
        { account_id: rent, debit: 150000, credit: 0 },
        { account_id: cash, debit: 0, credit: 150000 },
      ],
    })

    // Check due
    const due = mock.getDueRecurring('2026-01-15')
    expect(due.length).toBe(1)
    expect(due[0].template_id).toBe(tmplId)
    expect(due[0].due_date).toBe('2026-01-01')

    // Generate
    const txId = mock.generateRecurring(tmplId, '2026-01-01')
    const tx = mock.getTransactionDetail(txId)
    expect(tx.description).toBe('Monthly Rent')
    expect(tx.date).toBe('2026-01-01')
    expect(tx.entries.length).toBe(2)

    // After generation, next due should be February
    const due2 = mock.getDueRecurring('2026-02-15')
    expect(due2.length).toBe(1)
    expect(due2[0].due_date).toBe('2026-02-01')
  })

  it('paused template does not generate', () => {
    const tmplId = mock.createRecurring({
      description: 'Weekly Office Clean',
      recurrence: 'WEEKLY',
      start_date: '2026-03-01',
      entries: [
        { account_id: rent, debit: 10000, credit: 0 },
        { account_id: cash, debit: 0, credit: 10000 },
      ],
    })

    mock.pauseRecurring(tmplId)

    // Should not show as due
    const due = mock.getDueRecurring('2026-03-15')
    expect(due.length).toBe(0)

    // Should throw when trying to generate
    expect(() => mock.generateRecurring(tmplId, '2026-03-01')).toThrow('paused')
  })

  it('generated transaction has correct accounts and amounts', () => {
    const tmplId = mock.createRecurring({
      description: 'Quarterly Insurance',
      recurrence: 'QUARTERLY',
      start_date: '2026-01-01',
      entries: [
        { account_id: rent, debit: 300000, credit: 0 },
        { account_id: cash, debit: 0, credit: 300000 },
      ],
    })

    const txId = mock.generateRecurring(tmplId, '2026-01-01')
    const tx = mock.getTransactionDetail(txId)

    const rentEntry = tx.entries.find((e) => e.account_id === rent)!
    const cashEntry = tx.entries.find((e) => e.account_id === cash)!

    expect(rentEntry.debit).toBe(300000)
    expect(rentEntry.credit).toBe(0)
    expect(cashEntry.debit).toBe(0)
    expect(cashEntry.credit).toBe(300000)

    // Verify balanced
    const totalD = tx.entries.reduce((s, e) => s + e.debit, 0)
    const totalC = tx.entries.reduce((s, e) => s + e.credit, 0)
    expect(totalD).toBe(totalC)
  })

  it('resume after pause allows generation', () => {
    const tmplId = mock.createRecurring({
      description: 'Monthly Subs',
      recurrence: 'MONTHLY',
      start_date: '2026-04-01',
      entries: [
        { account_id: rent, debit: 5000, credit: 0 },
        { account_id: cash, debit: 0, credit: 5000 },
      ],
    })

    mock.pauseRecurring(tmplId)
    expect(mock.getDueRecurring('2026-04-15').length).toBe(0)

    mock.resumeRecurring(tmplId)
    expect(mock.getDueRecurring('2026-04-15').length).toBe(1)
  })

  it('delete removes template', () => {
    const tmplId = mock.createRecurring({
      description: 'To Delete',
      recurrence: 'YEARLY',
      start_date: '2026-01-01',
      entries: [
        { account_id: rent, debit: 1000, credit: 0 },
        { account_id: cash, debit: 0, credit: 1000 },
      ],
    })

    expect(mock.listRecurring().length).toBe(1)
    mock.deleteRecurring(tmplId)
    expect(mock.listRecurring().length).toBe(0)
  })
})
