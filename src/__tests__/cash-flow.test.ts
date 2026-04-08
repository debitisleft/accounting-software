import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 24 — Cash Flow Statement', () => {
  let mock: MockApi
  let cash: string
  let ar: string
  let equipment: string
  let revenue: string
  let rent: string

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
    const accounts = mock.getAccounts()
    cash = accounts.find((a) => a.code === '1000')!.id
    ar = accounts.find((a) => a.code === '1100')!.id
    equipment = accounts.find((a) => a.code === '1500')!.id
    revenue = accounts.find((a) => a.code === '4000')!.id
    rent = accounts.find((a) => a.code === '5100')!.id

    // Sale on account
    mock.createTransaction({
      date: '2026-03-01', description: 'Sale on account',
      entries: [
        { account_id: ar, debit: 100000, credit: 0 },
        { account_id: revenue, debit: 0, credit: 100000 },
      ],
    })
    // Collect cash from customer
    mock.createTransaction({
      date: '2026-04-01', description: 'Cash collection',
      entries: [
        { account_id: cash, debit: 60000, credit: 0 },
        { account_id: ar, debit: 0, credit: 60000 },
      ],
    })
    // Buy equipment with cash
    mock.createTransaction({
      date: '2026-05-01', description: 'Buy equipment',
      entries: [
        { account_id: equipment, debit: 200000, credit: 0 },
        { account_id: cash, debit: 0, credit: 200000 },
      ],
    })
    // Pay rent
    mock.createTransaction({
      date: '2026-06-01', description: 'Rent',
      entries: [
        { account_id: rent, debit: 50000, credit: 0 },
        { account_id: cash, debit: 0, credit: 50000 },
      ],
    })
  })

  it('beginning cash + net change = ending cash', () => {
    const cf = mock.getCashFlowStatement('2026-01-01', '2026-12-31')
    expect(cf.beginning_cash + cf.net_change_in_cash).toBe(cf.ending_cash)
  })

  it('cash flow equals actual change in cash accounts', () => {
    const cf = mock.getCashFlowStatement('2026-01-01', '2026-12-31')
    const actualChange = cf.ending_cash - cf.beginning_cash
    expect(cf.net_change_in_cash).toBe(actualChange)
  })

  it('net income from income statement matches operating section starting point', () => {
    const cf = mock.getCashFlowStatement('2026-01-01', '2026-12-31')
    const is = mock.getIncomeStatement('2026-01-01', '2026-12-31')
    expect(cf.net_income).toBe(is.net_income)
  })

  it('equipment purchase appears in investing section', () => {
    const cf = mock.getCashFlowStatement('2026-01-01', '2026-12-31')
    const equipItem = cf.investing.find((i) => i.code === '1500')
    expect(equipItem).toBeDefined()
    expect(equipItem!.amount).toBe(-200000) // cash outflow
  })

  it('AR change appears in operating section', () => {
    const cf = mock.getCashFlowStatement('2026-01-01', '2026-12-31')
    const arItem = cf.operating.find((i) => i.code === '1100')
    expect(arItem).toBeDefined()
    // AR increased by 40000 (100000 sale - 60000 collection), so cash impact is -40000
    expect(arItem!.amount).toBe(-40000)
  })
})
