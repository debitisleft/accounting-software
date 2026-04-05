/**
 * In-memory mock of the Tauri API layer.
 * Implements the same business logic as the Rust backend
 * so we can test accounting rules without Tauri running.
 */

import type {
  Account,
  JournalEntryInput,
  TrialBalanceResult,
  IncomeStatementResult,
  BalanceSheetResult,
  AccountBalanceRow,
  AccountBalanceItem,
} from '../../lib/api'

interface StoredTransaction {
  id: string
  date: string
  description: string
  reference: string | null
  is_locked: number
  created_at: number
}

interface StoredEntry {
  id: string
  transaction_id: string
  account_id: string
  debit: number
  credit: number
  memo: string | null
}

function isDebitNormal(type: string): boolean {
  return type === 'ASSET' || type === 'EXPENSE'
}

function normalBalanceFor(type: string): string {
  return isDebitNormal(type) ? 'DEBIT' : 'CREDIT'
}

export class MockApi {
  accounts: Account[] = []
  transactions: StoredTransaction[] = []
  entries: StoredEntry[] = []
  private nextId = 1

  private genId(): string {
    return `mock-${this.nextId++}`
  }

  seedAccounts(seedData: { code: string; name: string; type: string }[]): void {
    if (this.accounts.length > 0) return
    const now = Date.now()
    for (const s of seedData) {
      this.accounts.push({
        id: this.genId(),
        code: s.code,
        name: s.name,
        type: s.type,
        normal_balance: normalBalanceFor(s.type),
        parent_id: null,
        is_active: 1,
        created_at: now,
      })
    }
  }

  getAccounts(): Account[] {
    return this.accounts.filter((a) => a.is_active === 1).sort((a, b) => a.code.localeCompare(b.code))
  }

  createTransaction(data: {
    date: string
    description: string
    reference?: string
    entries: JournalEntryInput[]
  }): string {
    const totalDebit = data.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = data.entries.reduce((s, e) => s + e.credit, 0)

    if (totalDebit !== totalCredit) {
      throw new Error(
        `Transaction does not balance: debits=${totalDebit} credits=${totalCredit} difference=${totalDebit - totalCredit}`,
      )
    }
    if (totalDebit === 0) {
      throw new Error('Transaction must have non-zero amounts')
    }

    const txId = this.genId()
    this.transactions.push({
      id: txId,
      date: data.date,
      description: data.description,
      reference: data.reference ?? null,
      is_locked: 0,
      created_at: Date.now(),
    })

    for (const entry of data.entries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: txId,
        account_id: entry.account_id,
        debit: entry.debit,
        credit: entry.credit,
        memo: entry.memo ?? null,
      })
    }

    return txId
  }

  getAccountBalance(accountId: string, asOfDate?: string): number {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)

    let relevantEntries = this.entries.filter((e) => e.account_id === accountId)
    if (asOfDate) {
      const txIds = new Set(
        this.transactions.filter((t) => t.date <= asOfDate).map((t) => t.id),
      )
      relevantEntries = relevantEntries.filter((e) => txIds.has(e.transaction_id))
    }

    const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)

    return isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit
  }

  getTrialBalance(asOfDate?: string): TrialBalanceResult {
    const rows: AccountBalanceRow[] = []

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter((e) => e.account_id === acct.id)
      if (asOfDate) {
        const txIds = new Set(
          this.transactions.filter((t) => t.date <= asOfDate).map((t) => t.id),
        )
        relevantEntries = relevantEntries.filter((e) => txIds.has(e.transaction_id))
      }

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const net = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit

      if (net !== 0) {
        // Column determined by sign: positive = normal side, negative = abnormal side
        let debit: number, credit: number
        if (net >= 0) {
          debit = isDebitNormal(acct.type) ? net : 0
          credit = !isDebitNormal(acct.type) ? net : 0
        } else {
          debit = !isDebitNormal(acct.type) ? -net : 0
          credit = isDebitNormal(acct.type) ? -net : 0
        }
        rows.push({
          account_id: acct.id,
          code: acct.code,
          name: acct.name,
          type: acct.type,
          debit,
          credit,
        })
      }
    }

    const total_debits = rows.reduce((s, r) => s + r.debit, 0)
    const total_credits = rows.reduce((s, r) => s + r.credit, 0)

    return { rows, total_debits, total_credits, is_balanced: total_debits === total_credits }
  }

  getIncomeStatement(startDate: string, endDate: string): IncomeStatementResult {
    const txIds = new Set(
      this.transactions
        .filter((t) => t.date >= startDate && t.date <= endDate)
        .map((t) => t.id),
    )

    const revenue: AccountBalanceItem[] = []
    const expenses: AccountBalanceItem[] = []

    for (const acct of this.getAccounts()) {
      if (acct.type !== 'REVENUE' && acct.type !== 'EXPENSE') continue
      const relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )
      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance }
      if (acct.type === 'REVENUE') revenue.push(item)
      else expenses.push(item)
    }

    const total_revenue = revenue.reduce((s, r) => s + r.balance, 0)
    const total_expenses = expenses.reduce((s, r) => s + r.balance, 0)

    return {
      revenue,
      expenses,
      total_revenue,
      total_expenses,
      net_income: total_revenue - total_expenses,
      start_date: startDate,
      end_date: endDate,
    }
  }

  getBalanceSheet(asOfDate: string): BalanceSheetResult {
    const txIds = new Set(
      this.transactions.filter((t) => t.date <= asOfDate).map((t) => t.id),
    )

    const assets: AccountBalanceItem[] = []
    const liabilities: AccountBalanceItem[] = []
    const equity: AccountBalanceItem[] = []
    let netIncome = 0

    for (const acct of this.getAccounts()) {
      const relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )
      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance }
      switch (acct.type) {
        case 'ASSET': assets.push(item); break
        case 'LIABILITY': liabilities.push(item); break
        case 'EQUITY': equity.push(item); break
        case 'REVENUE': netIncome += balance; break
        case 'EXPENSE': netIncome -= balance; break
      }
    }

    const total_assets = assets.reduce((s, r) => s + r.balance, 0)
    const total_liabilities = liabilities.reduce((s, r) => s + r.balance, 0)
    const total_equity = equity.reduce((s, r) => s + r.balance, 0) + netIncome

    return {
      assets,
      liabilities,
      equity,
      total_assets,
      total_liabilities,
      total_equity,
      is_balanced: total_assets === total_liabilities + total_equity,
      as_of_date: asOfDate,
    }
  }
}

export const defaultSeedAccounts = [
  { code: '1000', name: 'Cash', type: 'ASSET' },
  { code: '1010', name: 'Checking Account', type: 'ASSET' },
  { code: '1020', name: 'Savings Account', type: 'ASSET' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET' },
  { code: '1200', name: 'Inventory', type: 'ASSET' },
  { code: '1300', name: 'Prepaid Expenses', type: 'ASSET' },
  { code: '1500', name: 'Equipment', type: 'ASSET' },
  { code: '1510', name: 'Accumulated Depreciation', type: 'ASSET' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' },
  { code: '2100', name: 'Credit Card Payable', type: 'LIABILITY' },
  { code: '2200', name: 'Wages Payable', type: 'LIABILITY' },
  { code: '2300', name: 'Sales Tax Payable', type: 'LIABILITY' },
  { code: '2500', name: 'Notes Payable', type: 'LIABILITY' },
  { code: '3000', name: "Owner's Equity", type: 'EQUITY' },
  { code: '3100', name: "Owner's Draws", type: 'EQUITY' },
  { code: '3200', name: 'Retained Earnings', type: 'EQUITY' },
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE' },
  { code: '4100', name: 'Service Revenue', type: 'REVENUE' },
  { code: '4200', name: 'Interest Income', type: 'REVENUE' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE' },
  { code: '5100', name: 'Rent Expense', type: 'EXPENSE' },
  { code: '5200', name: 'Utilities Expense', type: 'EXPENSE' },
  { code: '5300', name: 'Wages Expense', type: 'EXPENSE' },
  { code: '5400', name: 'Office Supplies', type: 'EXPENSE' },
  { code: '5500', name: 'Depreciation Expense', type: 'EXPENSE' },
  { code: '5600', name: 'Insurance Expense', type: 'EXPENSE' },
]
