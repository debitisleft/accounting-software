import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { accounts, transactions, journalEntries, type AccountType } from '../db/schema'
import type { AppDatabase } from '../db/connection'

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

// ── Core Functions ───────────────────────────────────────

/**
 * Creates a transaction with journal entries.
 * Enforces: SUM(debit) === SUM(credit) — throws UnbalancedTransactionError if not.
 * All amounts must be non-negative integer cents.
 */
export function createTransaction(
  db: AppDatabase,
  input: CreateTransactionInput,
): number {
  const totalDebit = input.entries.reduce((sum, e) => sum + e.debit, 0)
  const totalCredit = input.entries.reduce((sum, e) => sum + e.credit, 0)

  if (totalDebit !== totalCredit) {
    throw new UnbalancedTransactionError(totalDebit, totalCredit)
  }

  if (totalDebit === 0) {
    throw new Error('Transaction must have non-zero amounts')
  }

  const tx = db.insert(transactions)
    .values({ date: input.date, description: input.description })
    .returning()
    .get()

  for (const entry of input.entries) {
    db.insert(journalEntries)
      .values({
        transactionId: tx.id,
        accountId: entry.accountId,
        debit: entry.debit,
        credit: entry.credit,
        memo: entry.memo,
      })
      .run()
  }

  return tx.id
}

/**
 * Returns the balance for a single account, respecting its normal balance side.
 * ASSET/EXPENSE: balance = SUM(debit) - SUM(credit)
 * LIABILITY/EQUITY/REVENUE: balance = SUM(credit) - SUM(debit)
 */
export function getAccountBalance(
  db: AppDatabase,
  accountId: number,
): AccountBalance {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get()
  if (!account) {
    throw new Error(`Account not found: ${accountId}`)
  }

  const result = db
    .select({
      totalDebit: sql<number>`COALESCE(SUM(${journalEntries.debit}), 0)`,
      totalCredit: sql<number>`COALESCE(SUM(${journalEntries.credit}), 0)`,
    })
    .from(journalEntries)
    .where(eq(journalEntries.accountId, accountId))
    .get()

  const totalDebit = result?.totalDebit ?? 0
  const totalCredit = result?.totalCredit ?? 0

  const balance = isDebitNormal(account.type)
    ? totalDebit - totalCredit
    : totalCredit - totalDebit

  return {
    accountId: account.id,
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
export function getTrialBalance(db: AppDatabase): TrialBalance {
  const allAccounts = db.select().from(accounts).all()

  const rows: TrialBalanceRow[] = allAccounts.map((account) => {
    const result = db
      .select({
        totalDebit: sql<number>`COALESCE(SUM(${journalEntries.debit}), 0)`,
        totalCredit: sql<number>`COALESCE(SUM(${journalEntries.credit}), 0)`,
      })
      .from(journalEntries)
      .where(eq(journalEntries.accountId, account.id))
      .get()

    const totalDebit = result?.totalDebit ?? 0
    const totalCredit = result?.totalCredit ?? 0

    // Trial balance shows the normal balance in the appropriate column
    const netBalance = isDebitNormal(account.type)
      ? totalDebit - totalCredit
      : totalCredit - totalDebit

    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      debit: isDebitNormal(account.type) ? netBalance : 0,
      credit: !isDebitNormal(account.type) ? netBalance : 0,
    }
  }).filter((row) => row.debit !== 0 || row.credit !== 0)

  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0)
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0)

  return { rows, totalDebit, totalCredit }
}

/**
 * Returns an income statement for a date range.
 * Revenue - Expenses = Net Income.
 * Only includes journal entries from transactions within the date range.
 */
export function getIncomeStatement(
  db: AppDatabase,
  startDate: string,
  endDate: string,
): IncomeStatement {
  // Get all transactions in range
  const txInRange = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(gte(transactions.date, startDate), lte(transactions.date, endDate)))
    .all()
    .map((t) => t.id)

  const revenueAccounts = db.select().from(accounts).where(eq(accounts.type, 'REVENUE')).all()
  const expenseAccounts = db.select().from(accounts).where(eq(accounts.type, 'EXPENSE')).all()

  function getBalancesForAccounts(
    accountList: typeof revenueAccounts,
    txIds: number[],
  ): AccountBalance[] {
    return accountList.map((account) => {
      if (txIds.length === 0) {
        return { accountId: account.id, code: account.code, name: account.name, type: account.type, balance: 0 }
      }

      const result = db
        .select({
          totalDebit: sql<number>`COALESCE(SUM(${journalEntries.debit}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalEntries.credit}), 0)`,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.accountId, account.id),
            sql`${journalEntries.transactionId} IN (${sql.join(txIds.map((id) => sql`${id}`), sql`, `)})`,
          ),
        )
        .get()

      const totalDebit = result?.totalDebit ?? 0
      const totalCredit = result?.totalCredit ?? 0

      const balance = isDebitNormal(account.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        balance,
      }
    }).filter((a) => a.balance !== 0)
  }

  const revenueBalances = getBalancesForAccounts(revenueAccounts, txInRange)
  const expenseBalances = getBalancesForAccounts(expenseAccounts, txInRange)

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
export function getBalanceSheet(
  db: AppDatabase,
  asOfDate: string,
): BalanceSheet {
  // Get all transactions up to and including asOfDate
  const txUpToDate = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(lte(transactions.date, asOfDate))
    .all()
    .map((t) => t.id)

  function getBalancesForType(type: AccountType): AccountBalance[] {
    const accts = db.select().from(accounts).where(eq(accounts.type, type)).all()

    return accts.map((account) => {
      if (txUpToDate.length === 0) {
        return { accountId: account.id, code: account.code, name: account.name, type: account.type, balance: 0 }
      }

      const result = db
        .select({
          totalDebit: sql<number>`COALESCE(SUM(${journalEntries.debit}), 0)`,
          totalCredit: sql<number>`COALESCE(SUM(${journalEntries.credit}), 0)`,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.accountId, account.id),
            sql`${journalEntries.transactionId} IN (${sql.join(txUpToDate.map((id) => sql`${id}`), sql`, `)})`,
          ),
        )
        .get()

      const totalDebit = result?.totalDebit ?? 0
      const totalCredit = result?.totalCredit ?? 0

      const balance = isDebitNormal(account.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit

      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        balance,
      }
    }).filter((a) => a.balance !== 0)
  }

  const assetBalances = getBalancesForType('ASSET')
  const liabilityBalances = getBalancesForType('LIABILITY')
  const equityBalances = getBalancesForType('EQUITY')

  // Net income from revenue and expenses goes into equity side
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
