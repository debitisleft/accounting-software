import { invoke } from '@tauri-apps/api/core'

// ── Types matching Rust structs ──────────────────────────

export interface Account {
  id: string
  code: string
  name: string
  type: string
  normal_balance: string
  parent_id: string | null
  is_active: number
  created_at: number
}

export interface JournalEntryInput {
  account_id: string
  debit: number   // integer cents
  credit: number  // integer cents
  memo?: string
}

export interface JournalEntryOutput {
  id: string
  transaction_id: string
  account_id: string
  debit: number
  credit: number
  memo: string | null
}

export interface TransactionWithEntries {
  id: string
  date: string
  description: string
  reference: string | null
  is_locked: number
  created_at: number
  entries: JournalEntryOutput[]
}

export interface AccountBalanceRow {
  account_id: string
  code: string
  name: string
  type: string
  debit: number
  credit: number
}

export interface TrialBalanceResult {
  rows: AccountBalanceRow[]
  total_debits: number
  total_credits: number
  is_balanced: boolean
}

export interface AccountBalanceItem {
  account_id: string
  code: string
  name: string
  balance: number
}

export interface IncomeStatementResult {
  revenue: AccountBalanceItem[]
  expenses: AccountBalanceItem[]
  total_revenue: number
  total_expenses: number
  net_income: number
  start_date: string
  end_date: string
}

export interface BalanceSheetResult {
  assets: AccountBalanceItem[]
  liabilities: AccountBalanceItem[]
  equity: AccountBalanceItem[]
  total_assets: number
  total_liabilities: number
  total_equity: number
  is_balanced: boolean
  as_of_date: string
}

export interface TransactionFilters {
  account_id?: string
  start_date?: string
  end_date?: string
}

export interface AppMetadata {
  version: string
  db_path: string
  last_backup_date: string | null
}

export interface DashboardSummary {
  total_assets: number
  total_liabilities: number
  total_equity: number
  total_revenue: number
  total_expenses: number
  net_income: number
  transaction_count: number
  recent_transactions: TransactionWithEntries[]
}

// ── API — the ONLY place invoke() is called ──────────────

export const api = {
  getAccounts: () =>
    invoke<Account[]>('get_accounts'),

  createTransaction: (data: {
    date: string
    description: string
    reference?: string
    entries: JournalEntryInput[]
  }) =>
    invoke<string>('create_transaction', data),

  getAccountBalance: (accountId: string, asOfDate?: string) =>
    invoke<number>('get_account_balance', {
      accountId,
      asOfDate: asOfDate ?? null,
    }),

  getTrialBalance: (asOfDate?: string) =>
    invoke<TrialBalanceResult>('get_trial_balance', {
      asOfDate: asOfDate ?? null,
    }),

  getIncomeStatement: (startDate: string, endDate: string) =>
    invoke<IncomeStatementResult>('get_income_statement', {
      startDate,
      endDate,
    }),

  getBalanceSheet: (asOfDate: string) =>
    invoke<BalanceSheetResult>('get_balance_sheet', {
      asOfDate,
    }),

  getTransactions: (filters?: TransactionFilters) =>
    invoke<TransactionWithEntries[]>('get_transactions', {
      accountId: filters?.account_id ?? null,
      startDate: filters?.start_date ?? null,
      endDate: filters?.end_date ?? null,
    }),

  updateJournalEntry: (
    journalEntryId: string,
    field: string,
    newValue: string,
  ) =>
    invoke<void>('update_journal_entry', {
      journalEntryId,
      field,
      newValue,
    }),

  lockPeriod: (accountId: string, periodStart: string, periodEnd: string) =>
    invoke<void>('lock_period', {
      accountId,
      periodStart,
      periodEnd,
    }),

  checkPeriodLocked: (accountId: string, date: string) =>
    invoke<boolean>('check_period_locked', {
      accountId,
      date,
    }),

  getAppMetadata: () =>
    invoke<AppMetadata>('get_app_metadata'),

  getDashboardSummary: () =>
    invoke<DashboardSummary>('get_dashboard_summary'),
}
