import type { BookkeepingDatabase, AccountType, Account, JournalEntry } from '../db/index'

// ── Types ────────────────────────────────────────────────

export interface JournalEntryLine {
  accountId: number
  debit: number   // integer cents
  credit: number  // integer cents
  memo?: string
}

export interface CreateTransactionInput {
  date: string        // YYYY-MM-DD
  description: string
  entries: JournalEntryLine[]
}

export class UnbalancedTransactionError extends Error {
  constructor(
    public readonly totalDebit: number,
    public readonly totalCredit: number,
  ) {
    super(
      `Transaction is unbalanced: debits=${totalDebit} credits=${totalCredit} (difference=${totalDebit - totalCredit})`,
    )
    this.name = 'UnbalancedTransactionError'
  }
}

export interface AccountBalance {
  accountId: number
  code: string
  name: string
  type: AccountType
  balance: number // integer cents, positive = normal balance side
}

export interface TrialBalanceRow {
  accountId: number
  code: string
  name: string
  type: AccountType
  debit: number  // integer cents
  credit: number // integer cents
}

export interface TrialBalance {
  rows: TrialBalanceRow[]
  totalDebit: number
  totalCredit: number
}

export interface IncomeStatementSection {
  accounts: AccountBalance[]
  total: number // integer cents
}

export interface IncomeStatement {
  revenue: IncomeStatementSection
  expenses: IncomeStatementSection
  netIncome: number // integer cents (revenue - expenses)
  startDate: string
  endDate: string
}

export interface BalanceSheet {
  assets: IncomeStatementSection
  liabilities: IncomeStatementSection
  equity: IncomeStatementSection
  asOfDate: string
  isBalanced: boolean // assets === liabilities + equity
}

// ── Helpers ──────────────────────────────────────────────

/** Returns true if this account type's normal balance is debit */
function isDebitNormal(type: AccountType): boolean {
  return type === 'ASSET' || type === 'EXPENSE'
}

/** Sum debit/credit for entries matching an account, optionally filtered by txIds */
function sumEntries(
  entries: JournalEntry[],
  accountId: number,
  txIds?: Set<number>,
): { totalDebit: number; totalCredit: number } {
  let totalDebit = 0
  let totalCredit = 0
  for (const e of entries) {
    if (e.accountId !== accountId) continue
    if (txIds && !txIds.has(e.transactionId)) continue
    totalDebit += e.debit
    totalCredit += e.credit
  }
  return { totalDebit, totalCredit }
}

/** Compute balance for an account given entries */
function computeBalance(
  account: Account,
  entries: JournalEntry[],
  txIds?: Set<number>,
): AccountBalance {
  const { totalDebit, totalCredit } = sumEntries(entries, account.id!, txIds)
  const balance = isDebitNormal(account.type)
    ? totalDebit - totalCredit
    : totalCredit - totalDebit
  return {
    accountId: account.id!,
    code: account.code,
    name: account.name,
    type: account.type,
    balance,
  }
}

// ── Core Functions ─���─────────────────────────────────────

/**
 * Creates a transaction with journal entries.
 * Enforces: SUM(debit) === SUM(credit) — throws UnbalancedTransactionError if not.
 * All amounts must be non-negative integer cents.
 */
export async function createTransaction(
  database: BookkeepingDatabase,
  input: CreateTransactionInput,
): Promise<number> {
  const totalDebit = input.entries.reduce((sum, e) => sum + e.debit, 0)
  const totalCredit = input.entries.reduce((sum, e) => sum + e.credit, 0)

  if (totalDebit !== totalCredit) {
    throw new UnbalancedTransactionError(totalDebit, totalCredit)
  }

  if (totalDebit === 0) {
    throw new Error('Transaction must have non-zero amounts')
  }

  const txId = await database.transactions.add({
    date: input.date,
    description: input.description,
    createdAt: Date.now(),
  })

  await database.journalEntries.bulkAdd(
    input.entries.map((entry) => ({
      transactionId: txId,
      accountId: entry.accountId,
      debit: entry.debit,
      credit: entry.credit,
      memo: entry.memo,
    })),
  )

  return txId
}

/**
 * Returns the balance for a single account, respecting its normal balance side.
 * ASSET/EXPENSE: balance = SUM(debit) - SUM(credit)
 * LIABILITY/EQUITY/REVENUE: balance = SUM(credit) - SUM(debit)
 */
export async function getAccountBalance(
  database: BookkeepingDatabase,
  accountId: number,
): Promise<AccountBalance> {
  const account = await database.accounts.get(accountId)
  if (!account) {
    throw new Error(`Account not found: ${accountId}`)
  }

  const entries = await database.journalEntries
    .where('accountId')
    .equals(accountId)
    .toArray()

  const { totalDebit, totalCredit } = sumEntries(entries, accountId)
  const balance = isDebitNormal(account.type)
    ? totalDebit - totalCredit
    : totalCredit - totalDebit

  return {
    accountId: account.id!,
    code: account.code,
    name: account.name,
    type: account.type,
    balance,
  }
}

/**
 * Returns a trial balance: all accounts with their total debits and credits.
 * totalDebit must equal totalCredit if books are balanced.
 */
export async function getTrialBalance(
  database: BookkeepingDatabase,
): Promise<TrialBalance> {
  const allAccounts = await database.accounts.toArray()
  const allEntries = await database.journalEntries.toArray()

  const rows: TrialBalanceRow[] = allAccounts
    .map((account) => {
      const bal = computeBalance(account, allEntries)
      return {
        accountId: account.id!,
        code: account.code,
        name: account.name,
        type: account.type,
        debit: isDebitNormal(account.type) ? bal.balance : 0,
        credit: !isDebitNormal(account.type) ? bal.balance : 0,
      }
    })
    .filter((row) => row.debit !== 0 || row.credit !== 0)

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0)
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0)

  return { rows, totalDebit, totalCredit }
}

/**
 * Returns an income statement for a date range.
 * Revenue - Expenses = Net Income.
 * Only includes journal entries from transactions within the date range.
 */
export async function getIncomeStatement(
  database: BookkeepingDatabase,
  startDate: string,
  endDate: string,
): Promise<IncomeStatement> {
  const txInRange = await database.transactions
    .where('date')
    .between(startDate, endDate, true, true)
    .toArray()
  const txIds = new Set(txInRange.map((t) => t.id!))

  const allEntries = await database.journalEntries.toArray()
  const allAccounts = await database.accounts.toArray()

  const revenueAccounts = allAccounts.filter((a) => a.type === 'REVENUE')
  const expenseAccounts = allAccounts.filter((a) => a.type === 'EXPENSE')

  function getBalances(accountList: Account[]): AccountBalance[] {
    return accountList
      .map((account) => computeBalance(account, allEntries, txIds))
      .filter((a) => a.balance !== 0)
  }

  const revenueBalances = getBalances(revenueAccounts)
  const expenseBalances = getBalances(expenseAccounts)

  const totalRevenue = revenueBalances.reduce((sum, a) => sum + a.balance, 0)
  const totalExpenses = expenseBalances.reduce((sum, a) => sum + a.balance, 0)

  return {
    revenue: { accounts: revenueBalances, total: totalRevenue },
    expenses: { accounts: expenseBalances, total: totalExpenses },
    netIncome: totalRevenue - totalExpenses,
    startDate,
    endDate,
  }
}

/**
 * Returns a balance sheet as of a given date.
 * Assets = Liabilities + Equity (includes retained earnings from revenue/expenses).
 */
export async function getBalanceSheet(
  database: BookkeepingDatabase,
  asOfDate: string,
): Promise<BalanceSheet> {
  const txUpToDate = await database.transactions
    .where('date')
    .belowOrEqual(asOfDate)
    .toArray()
  const txIds = new Set(txUpToDate.map((t) => t.id!))

  const allEntries = await database.journalEntries.toArray()
  const allAccounts = await database.accounts.toArray()

  function getBalancesForType(type: AccountType): AccountBalance[] {
    return allAccounts
      .filter((a) => a.type === type)
      .map((account) => computeBalance(account, allEntries, txIds))
      .filter((a) => a.balance !== 0)
  }

  const assetBalances = getBalancesForType('ASSET')
  const liabilityBalances = getBalancesForType('LIABILITY')
  const equityBalances = getBalancesForType('EQUITY')

  const revenueBalances = getBalancesForType('REVENUE')
  const expenseBalances = getBalancesForType('EXPENSE')
  const netIncome =
    revenueBalances.reduce((sum, a) => sum + a.balance, 0) -
    expenseBalances.reduce((sum, a) => sum + a.balance, 0)

  const totalAssets = assetBalances.reduce((sum, a) => sum + a.balance, 0)
  const totalLiabilities = liabilityBalances.reduce((sum, a) => sum + a.balance, 0)
  const totalEquity = equityBalances.reduce((sum, a) => sum + a.balance, 0) + netIncome

  return {
    assets: { accounts: assetBalances, total: totalAssets },
    liabilities: { accounts: liabilityBalances, total: totalLiabilities },
    equity: { accounts: equityBalances, total: totalEquity },
    asOfDate,
    isBalanced: totalAssets === totalLiabilities + totalEquity,
  }
}
