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
  is_void: number
  void_of: string | null
  created_at: number
  entries: JournalEntryOutput[]
}

export interface ListTransactionsResult {
  transactions: TransactionWithEntries[]
  total: number
}

export interface ListTransactionsFilters {
  offset?: number
  limit?: number
  start_date?: string
  end_date?: string
  account_id?: string
  memo_search?: string
}

export interface ExportResult {
  path: string
  size: number
}

export interface ImportResult {
  account_count: number
  transaction_count: number
}

export interface AutoBackupResult {
  path: string
  backup_count: number
}

export interface BackupInfo {
  path: string
  filename: string
  size: number
  created_at: string
}

export interface AuditLogEntry {
  id: string
  transaction_id: string | null
  field_changed: string
  old_value: string
  new_value: string
  changed_at: number
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

  createAccount: (data: { code: string; name: string; acctType: string; parentId?: string }) =>
    invoke<string>('create_account', {
      code: data.code,
      name: data.name,
      acctType: data.acctType,
      parentId: data.parentId ?? null,
    }),

  updateAccount: (accountId: string, data: { name?: string; code?: string }) =>
    invoke<void>('update_account', {
      accountId,
      name: data.name ?? null,
      code: data.code ?? null,
    }),

  deactivateAccount: (accountId: string) =>
    invoke<void>('deactivate_account', { accountId }),

  reactivateAccount: (accountId: string) =>
    invoke<void>('reactivate_account', { accountId }),

  listTransactions: (filters?: ListTransactionsFilters) =>
    invoke<ListTransactionsResult>('list_transactions', {
      offset: filters?.offset ?? null,
      limit: filters?.limit ?? null,
      startDate: filters?.start_date ?? null,
      endDate: filters?.end_date ?? null,
      accountId: filters?.account_id ?? null,
      memoSearch: filters?.memo_search ?? null,
    }),

  getTransactionDetail: (transactionId: string) =>
    invoke<TransactionWithEntries>('get_transaction_detail', { transactionId }),

  countTransactions: (filters?: ListTransactionsFilters) =>
    invoke<number>('count_transactions', {
      startDate: filters?.start_date ?? null,
      endDate: filters?.end_date ?? null,
      accountId: filters?.account_id ?? null,
      memoSearch: filters?.memo_search ?? null,
    }),

  updateTransaction: (transactionId: string, data: { date?: string; description?: string; reference?: string }) =>
    invoke<void>('update_transaction', {
      transactionId,
      date: data.date ?? null,
      description: data.description ?? null,
      reference: data.reference ?? null,
    }),

  updateTransactionLines: (transactionId: string, entries: JournalEntryInput[]) =>
    invoke<void>('update_transaction_lines', { transactionId, entries }),

  voidTransaction: (transactionId: string) =>
    invoke<string>('void_transaction', { transactionId }),

  getAuditLog: (transactionId: string) =>
    invoke<AuditLogEntry[]>('get_audit_log', { transactionId }),

  exportDatabase: (destination: string) =>
    invoke<ExportResult>('export_database', { destination }),

  importDatabase: (source: string) =>
    invoke<ImportResult>('import_database', { source }),

  autoBackup: () =>
    invoke<AutoBackupResult>('auto_backup'),

  listBackups: () =>
    invoke<BackupInfo[]>('list_backups'),
}
