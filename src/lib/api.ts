import { invoke } from '@tauri-apps/api/core'

// ── File Management Types ────────────────────────────────

export interface FileInfo {
  path: string
  company_name: string
}

export interface RecentFile {
  path: string
  company_name: string
  last_opened: string
}

// ── Types matching Rust structs ──────────────────────────

export interface Account {
  id: string
  code: string
  name: string
  type: string
  normal_balance: string
  parent_id: string | null
  is_active: number
  is_system: number
  is_cash_account: number
  cash_flow_category: string | null
  depth: number
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
  journal_type: string
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

export interface LedgerEntry {
  transaction_id: string
  date: string
  description: string
  reference: string | null
  debit: number
  credit: number
  running_balance: number
  memo: string | null
}

export interface AccountLedgerResult {
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  entries: LedgerEntry[]
  total: number
}

export interface LockedPeriod {
  id: string
  end_date: string
  locked_at: number
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
  depth: number
  parent_id: string | null
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
  depth: number
  parent_id: string | null
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

// ── Dimension Types (Phase 32) ──────────────────────────

export interface Dimension {
  id: string
  type: string
  name: string
  code: string | null
  parent_id: string | null
  is_active: number
  created_at: string
  depth: number
}

export interface LineDimension {
  transaction_line_id: string
  dimension_id: string
  dimension_type: string
  dimension_name: string
}

export interface DimensionFilter {
  type: string
  dimension_id: string
}

// ── Contact Types (Phase 33) ──────────────────────────

export interface Contact {
  id: string
  type: string
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country: string | null
  tax_id: string | null
  notes: string | null
  is_active: number
  created_at: string
  updated_at: string
}

export interface ContactLedgerEntry {
  transaction_id: string
  date: string
  description: string
  reference: string | null
  journal_type: string
  total_debit: number
  total_credit: number
  running_balance: number
}

export interface ContactLedgerResult {
  contact_id: string
  contact_name: string
  entries: ContactLedgerEntry[]
  total_debits: number
  total_credits: number
  net_balance: number
}

// ── General Ledger Types (Phase 34) ───────────────────

export interface GLEntryDimension {
  type: string
  name: string
}

export interface GLEntry {
  transaction_id: string
  transaction_line_id: string
  date: string
  reference: string | null
  description: string
  debit: number
  credit: number
  running_balance: number
  contact_name: string | null
  dimensions: GLEntryDimension[]
  is_void: boolean
  journal_type: string
}

export interface GLAccountGroup {
  account: {
    id: string
    code: string
    name: string
    type: string
    normal_balance: string
  }
  opening_balance: number
  entries: GLEntry[]
  closing_balance: number
  total_debits: number
  total_credits: number
}

export interface GLFilters {
  account_id?: string
  account_ids?: string[]
  start_date?: string
  end_date?: string
  dimension_filters?: DimensionFilter[]
  contact_id?: string
  journal_type?: string
  include_void?: boolean
}

// ── Document Attachment Types (Phase 35) ─────────────

export interface DocumentMeta {
  id: string
  entity_type: string
  entity_id: string
  filename: string
  stored_filename: string
  mime_type: string
  file_size_bytes: number
  description: string | null
  uploaded_at: string
  uploaded_by: string
}

// ── API — the ONLY place invoke() is called ──────────────

export const api = {
  // File management
  createNewFile: (path: string, companyName: string) =>
    invoke<FileInfo>('create_new_file', { path, companyName }),

  openFile: (path: string) =>
    invoke<FileInfo>('open_file', { path }),

  closeFile: () =>
    invoke<void>('close_file'),

  getRecentFiles: () =>
    invoke<RecentFile[]>('get_recent_files'),

  openRecentFile: (path: string) =>
    invoke<FileInfo>('open_recent_file', { path }),

  removeRecentFile: (path: string) =>
    invoke<void>('remove_recent_file', { path }),

  isFileOpen: () =>
    invoke<boolean>('is_file_open'),

  // Accounting
  getAccounts: () =>
    invoke<Account[]>('get_accounts'),

  enterOpeningBalances: (balances: { account_id: string; balance: number }[], effectiveDate: string) =>
    invoke<string>('enter_opening_balances', { balances, effectiveDate }),

  startReconciliation: (accountId: string, statementDate: string, statementBalance: number) =>
    invoke<string>('start_reconciliation', { accountId, statementDate, statementBalance }),

  completeReconciliation: (accountId: string, statementDate: string) =>
    invoke<void>('complete_reconciliation', { accountId, statementDate }),

  getUnreconciledEntries: (accountId: string) =>
    invoke<{ id: string; transaction_id: string; account_id: string; debit: number; credit: number; memo: string | null }[]>('get_unreconciled_entries', { accountId }),

  importBankTransactions: (items: { date: string; description: string; amount: number; payee?: string; bank_ref?: string }[]) =>
    invoke<number>('import_bank_transactions', { items }),

  listPendingBankTransactions: () =>
    invoke<{ id: string; date: string; description: string; amount: number; payee: string | null; status: string; suggested_account_id: string | null }[]>('list_pending_bank_transactions'),

  approveBankTransaction: (pendingId: string, accountId: string) =>
    invoke<string>('approve_bank_transaction', { pendingId, accountId }),

  dismissBankTransaction: (pendingId: string) =>
    invoke<void>('dismiss_bank_transaction', { pendingId }),

  createRecurring: (data: {
    description: string; recurrence: string; start_date: string; end_date?: string;
    entries: { account_id: string; debit: number; credit: number; memo?: string }[]
  }) => invoke<string>('create_recurring', data),

  listRecurring: () =>
    invoke<{ id: string; description: string; recurrence: string; start_date: string; end_date: string | null; last_generated: string | null; is_paused: number; entries_json: string; created_at: number }[]>('list_recurring'),

  updateRecurring: (id: string, data: { description?: string; recurrence?: string; end_date?: string }) =>
    invoke<void>('update_recurring', { id, ...data }),

  pauseRecurring: (id: string) => invoke<void>('pause_recurring', { id }),
  resumeRecurring: (id: string) => invoke<void>('resume_recurring', { id }),
  deleteRecurring: (id: string) => invoke<void>('delete_recurring', { id }),

  generateRecurring: (templateId: string, date: string) =>
    invoke<string>('generate_recurring', { templateId, date }),

  getCashFlowStatement: (startDate: string, endDate: string) =>
    invoke<{
      net_income: number
      operating: { account_id: string; code: string; name: string; amount: number }[]
      investing: { account_id: string; code: string; name: string; amount: number }[]
      financing: { account_id: string; code: string; name: string; amount: number }[]
      total_operating: number
      total_investing: number
      total_financing: number
      net_change_in_cash: number
      beginning_cash: number
      ending_cash: number
    }>('get_cash_flow_statement', { startDate, endDate }),

  listModules: () =>
    invoke<{ id: string; name: string; version: string; description: string | null; table_prefix: string; enabled: number; installed_at: number }[]>('list_modules'),

  getModule: (moduleId: string) =>
    invoke<{ id: string; name: string; version: string; description: string | null; table_prefix: string; enabled: number; installed_at: number }>('get_module', { moduleId }),

  closeFiscalYear: (fiscalYearEndDate: string) =>
    invoke<{ transaction_id: string; net_income: number }>('close_fiscal_year', { fiscalYearEndDate }),

  listFiscalYearCloses: () =>
    invoke<{ transaction_id: string; date: string; net_income: number }[]>('list_fiscal_year_closes'),

  createTransaction: (data: {
    date: string
    description: string
    reference?: string
    journal_type?: string
    entries: JournalEntryInput[]
    dimensions?: { line_index: number; dimension_id: string }[]
  }) =>
    invoke<string>('create_transaction', {
      ...data,
      dimensions: data.dimensions ?? null,
    }),

  getAccountBalance: (accountId: string, asOfDate?: string) =>
    invoke<number>('get_account_balance', {
      accountId,
      asOfDate: asOfDate ?? null,
    }),

  getTrialBalance: (asOfDate?: string, excludeJournalTypes?: string[]) =>
    invoke<TrialBalanceResult>('get_trial_balance', {
      asOfDate: asOfDate ?? null,
      excludeJournalTypes: excludeJournalTypes ?? null,
    }),

  getIncomeStatement: (startDate: string, endDate: string, excludeJournalTypes?: string[], basis?: string) =>
    invoke<IncomeStatementResult>('get_income_statement', {
      startDate,
      endDate,
      excludeJournalTypes: excludeJournalTypes ?? null,
      basis: basis ?? null,
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

  exportCsv: (exportType: string, options?: {
    startDate?: string
    endDate?: string
    asOfDate?: string
    accountId?: string
    memoSearch?: string
  }) =>
    invoke<string>('export_csv', {
      exportType,
      startDate: options?.startDate ?? null,
      endDate: options?.endDate ?? null,
      asOfDate: options?.asOfDate ?? null,
      accountId: options?.accountId ?? null,
      memoSearch: options?.memoSearch ?? null,
    }),

  getSetting: (key: string) =>
    invoke<string | null>('get_setting', { key }),

  setSetting: (key: string, value: string) =>
    invoke<void>('set_setting', { key, value }),

  getAllSettings: () =>
    invoke<Record<string, string>>('get_all_settings'),

  lockPeriodGlobal: (endDate: string) =>
    invoke<void>('lock_period_global', { endDate }),

  unlockPeriodGlobal: () =>
    invoke<void>('unlock_period_global'),

  listLockedPeriodsGlobal: () =>
    invoke<LockedPeriod[]>('list_locked_periods_global'),

  getAccountLedger: (accountId: string, options?: {
    startDate?: string; endDate?: string; offset?: number; limit?: number
  }) =>
    invoke<AccountLedgerResult>('get_account_ledger', {
      accountId,
      startDate: options?.startDate ?? null,
      endDate: options?.endDate ?? null,
      offset: options?.offset ?? null,
      limit: options?.limit ?? null,
    }),

  // Phase 32: Dimensions
  createDimension: (data: { dimType: string; name: string; code?: string; parentId?: string }) =>
    invoke<string>('create_dimension', {
      dimType: data.dimType,
      name: data.name,
      code: data.code ?? null,
      parentId: data.parentId ?? null,
    }),

  updateDimension: (id: string, data: { name?: string; code?: string; parentId?: string; isActive?: number }) =>
    invoke<void>('update_dimension', {
      id,
      name: data.name ?? null,
      code: data.code ?? null,
      parentId: data.parentId ?? null,
      isActive: data.isActive ?? null,
    }),

  listDimensions: (dimType?: string) =>
    invoke<Dimension[]>('list_dimensions', { dimType: dimType ?? null }),

  listDimensionTypes: () =>
    invoke<string[]>('list_dimension_types'),

  deleteDimension: (id: string) =>
    invoke<void>('delete_dimension', { id }),

  getTransactionDimensions: (transactionId: string) =>
    invoke<LineDimension[]>('get_transaction_dimensions', { transactionId }),

  // Phase 33: Contacts
  createContact: (data: {
    contactType: string; name: string; companyName?: string; email?: string; phone?: string;
    addressLine1?: string; addressLine2?: string; city?: string; state?: string;
    postalCode?: string; country?: string; taxId?: string; notes?: string
  }) =>
    invoke<string>('create_contact', {
      contactType: data.contactType,
      name: data.name,
      companyName: data.companyName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      postalCode: data.postalCode ?? null,
      country: data.country ?? null,
      taxId: data.taxId ?? null,
      notes: data.notes ?? null,
    }),

  updateContact: (id: string, data: {
    name?: string; companyName?: string; email?: string; phone?: string;
    addressLine1?: string; addressLine2?: string; city?: string; state?: string;
    postalCode?: string; country?: string; taxId?: string; notes?: string
  }) =>
    invoke<void>('update_contact', {
      id,
      name: data.name ?? null,
      companyName: data.companyName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      addressLine1: data.addressLine1 ?? null,
      addressLine2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      postalCode: data.postalCode ?? null,
      country: data.country ?? null,
      taxId: data.taxId ?? null,
      notes: data.notes ?? null,
    }),

  getContact: (id: string) =>
    invoke<Contact>('get_contact', { id }),

  listContacts: (contactType?: string, search?: string, isActive?: number) =>
    invoke<Contact[]>('list_contacts', {
      contactType: contactType ?? null,
      search: search ?? null,
      isActive: isActive ?? null,
    }),

  deactivateContact: (id: string) =>
    invoke<void>('deactivate_contact', { id }),

  reactivateContact: (id: string) =>
    invoke<void>('reactivate_contact', { id }),

  deleteContact: (id: string) =>
    invoke<void>('delete_contact', { id }),

  linkTransactionContact: (transactionId: string, contactId: string) =>
    invoke<void>('link_transaction_contact', { transactionId, contactId }),

  unlinkTransactionContact: (transactionId: string) =>
    invoke<void>('unlink_transaction_contact', { transactionId }),

  getContactLedger: (contactId: string, startDate?: string, endDate?: string) =>
    invoke<ContactLedgerResult>('get_contact_ledger', {
      contactId,
      startDate: startDate ?? null,
      endDate: endDate ?? null,
    }),

  getContactBalance: (contactId: string, asOf?: string) =>
    invoke<number>('get_contact_balance', {
      contactId,
      asOf: asOf ?? null,
    }),

  // Phase 34: General Ledger
  getGeneralLedger: (filters?: GLFilters) =>
    invoke<GLAccountGroup[]>('get_general_ledger', {
      accountId: filters?.account_id ?? null,
      accountIds: filters?.account_ids ?? null,
      startDate: filters?.start_date ?? null,
      endDate: filters?.end_date ?? null,
      dimensionFilters: filters?.dimension_filters ?? null,
      contactId: filters?.contact_id ?? null,
      journalType: filters?.journal_type ?? null,
      includeVoid: filters?.include_void ?? false,
    }),

  // Phase 35: Document Attachments
  attachDocument: (entityType: string, entityId: string, filePath: string, filename: string, description?: string) =>
    invoke<string>('attach_document', {
      entityType,
      entityId,
      filePath,
      filename,
      description: description ?? null,
    }),

  listDocuments: (entityType: string, entityId: string) =>
    invoke<DocumentMeta[]>('list_documents', { entityType, entityId }),

  getDocumentPath: (documentId: string) =>
    invoke<string>('get_document_path', { documentId }),

  deleteDocument: (documentId: string) =>
    invoke<void>('delete_document', { documentId }),

  getDocumentCount: (entityType: string, entityId: string) =>
    invoke<number>('get_document_count', { entityType, entityId }),

  // Phase 38: Module Storage Sandbox
  attachModuleDb: (moduleId: string) =>
    invoke<void>('attach_module_db', { moduleId }),

  detachModuleDb: (moduleId: string) =>
    invoke<void>('detach_module_db', { moduleId }),

  listAttachedModules: () =>
    invoke<string[]>('list_attached_modules'),

  moduleCreateTable: (moduleId: string, tableName: string, columnsSql: string) =>
    invoke<void>('module_create_table', { moduleId, tableName, columnsSql }),

  moduleInsert: (moduleId: string, tableName: string, row: Record<string, unknown>) =>
    invoke<number>('module_insert', { moduleId, tableName, rowJson: row }),

  moduleQuery: (
    moduleId: string,
    tableName: string,
    filters?: { column: string; op: string; value: unknown }[],
  ) =>
    invoke<Record<string, unknown>[]>('module_query', {
      moduleId,
      tableName,
      filters: filters ?? null,
    }),

  moduleUpdate: (
    moduleId: string,
    tableName: string,
    id: unknown,
    fields: Record<string, unknown>,
  ) => invoke<number>('module_update', { moduleId, tableName, id, fields }),

  moduleDelete: (moduleId: string, tableName: string, id: unknown) =>
    invoke<number>('module_delete', { moduleId, tableName, id }),

  moduleExecuteMigration: (moduleId: string, version: string, sql: string) =>
    invoke<void>('module_execute_migration', { moduleId, version, sql }),

  // Phase 39: Migration Coordinator
  registerModuleMigrations: (
    moduleId: string,
    migrations: { version: number; description: string; sql: string; checksum: string }[],
  ) => invoke<{ version: number; description: string; sql: string; checksum: string }[]>(
    'register_module_migrations',
    { moduleId, migrations },
  ),

  runModuleMigrations: (moduleId: string) =>
    invoke<{ applied: number[]; failed: number | null; error: string | null }>(
      'run_module_migrations',
      { moduleId },
    ),

  getMigrationStatus: (moduleId?: string) =>
    invoke<MigrationStatus[]>('get_migration_status', { moduleId: moduleId ?? null }),

  registerModuleDependency: (moduleId: string, dependsOnModuleId: string, minVersion?: number) =>
    invoke<void>('register_module_dependency', {
      moduleId,
      dependsOnModuleId,
      minVersion: minVersion ?? null,
    }),

  checkDependencyGraph: () =>
    invoke<string[]>('check_dependency_graph'),

  // Phase 40: Module Lifecycle
  installModule: (manifest: ModuleManifest, installPath?: string) =>
    invoke<ModuleRegistryEntry>('install_module', {
      manifestJson: manifest,
      installPath: installPath ?? null,
    }),

  uninstallModule: (moduleId: string, keepData?: boolean) =>
    invoke<void>('uninstall_module', { moduleId, keepData: keepData ?? false }),

  enableModule: (moduleId: string) => invoke<void>('enable_module', { moduleId }),
  disableModule: (moduleId: string) => invoke<void>('disable_module', { moduleId }),

  getModuleInfo: (moduleId: string) =>
    invoke<ModuleRegistryEntry>('get_module_info', { moduleId }),

  listInstalledModules: () =>
    invoke<ModuleRegistryEntry[]>('list_installed_modules'),

  // Phase 40: SDK v1 (a thin selection — most code calls the SDK from within
  // module iframes, but the host can use these too)
  getSdkVersion: () => invoke<string>('get_sdk_version'),

  sdkRegisterService: (moduleId: string, serviceName: string, info: ServiceHandlerInfo) =>
    invoke<void>('sdk_register_service', { moduleId, serviceName, info }),

  sdkCallService: (
    callerModuleId: string,
    targetModuleId: string,
    serviceName: string,
    params: unknown,
  ) =>
    invoke<unknown>('sdk_call_service', {
      callerModuleId,
      targetModuleId,
      serviceName,
      params,
    }),

  sdkListServices: () =>
    invoke<RegisteredService[]>('sdk_list_services'),

  // Phase 41: Permission management
  grantModulePermission: (moduleId: string, scope: string) =>
    invoke<void>('grant_module_permission', { moduleId, scope }),

  revokeModulePermission: (moduleId: string, scope: string) =>
    invoke<void>('revoke_module_permission', { moduleId, scope }),

  getModulePermissions: (moduleId: string) =>
    invoke<string[]>('get_module_permissions', { moduleId }),

  // Phase 42: Hooks (sync) and Events (async)
  sdkRegisterHook: (moduleId: string, hookType: string, priority?: number) =>
    invoke<void>('sdk_register_hook', {
      moduleId,
      hookType,
      priority: priority ?? null,
    }),

  sdkUnregisterHook: (moduleId: string, hookType: string) =>
    invoke<void>('sdk_unregister_hook', { moduleId, hookType }),

  listHooks: () =>
    invoke<{ module_id: string; hook_type: string; priority: number }[]>('list_hooks'),

  sdkSubscribeEvent: (moduleId: string, eventType: string) =>
    invoke<void>('sdk_subscribe_event', { moduleId, eventType }),

  sdkUnsubscribeEvent: (moduleId: string, eventType: string) =>
    invoke<void>('sdk_unsubscribe_event', { moduleId, eventType }),

  sdkEmitEvent: (moduleId: string, eventType: string, payload: unknown) =>
    invoke<void>('sdk_emit_event', { moduleId, eventType, payload }),

  listSubscriptions: () =>
    invoke<{ module_id: string; event_type: string }[]>('list_subscriptions'),

  getRecentEvents: (limit?: number) =>
    invoke<{ event_type: string; timestamp: string; data: unknown }[]>('get_recent_events', {
      limit: limit ?? null,
    }),

  // Phase 43: UI Extensions
  sdkRegisterNavItem: (moduleId: string, label: string, icon?: string, route?: string) =>
    invoke<void>('sdk_register_nav_item', { moduleId, label, icon: icon ?? null, route: route ?? null }),

  sdkRegisterSettingsPane: (moduleId: string, label: string, route?: string) =>
    invoke<void>('sdk_register_settings_pane', { moduleId, label, route: route ?? null }),

  sdkRegisterTransactionAction: (moduleId: string, label: string, actionId: string) =>
    invoke<void>('sdk_register_transaction_action', { moduleId, label, actionId }),

  getNavItems: () =>
    invoke<NavItemExtension[]>('get_nav_items'),

  getSettingsPanes: () =>
    invoke<SettingsPaneExtension[]>('get_settings_panes'),

  getTransactionActions: () =>
    invoke<TransactionActionExtension[]>('get_transaction_actions'),

  getModuleFile: (moduleId: string, filePath: string) =>
    invoke<{ mime_type: string; content: string; is_binary: boolean }>('get_module_file', {
      moduleId,
      filePath,
    }),

  // Phase 44: Health Monitor
  getHealthStatus: (moduleId: string) =>
    invoke<ModuleHealth>('get_health_status', { moduleId }),

  getAllHealthStatuses: () =>
    invoke<ModuleHealth[]>('get_all_health_statuses'),

  getHealthHistory: (moduleId: string, limit?: number) =>
    invoke<HealthLogEntry[]>('get_health_history', { moduleId, limit: limit ?? null }),

  // Phase 45: Distribution & Install Flow
  installModuleFromZip: (zipPath: string, authorId?: string) =>
    invoke<InstallReport>('install_module_from_zip', { zipPath, authorId: authorId ?? null }),

  validateModulePackage: (zipPath: string) =>
    invoke<ValidationReport>('validate_module_package', { zipPath }),

  exportModulePackage: (moduleId: string, outputPath: string) =>
    invoke<string>('export_module_package', { moduleId, outputPath }),

  checkModuleUpdates: (moduleId: string, newZipPath: string) =>
    invoke<UpdateCheck>('check_module_updates', { moduleId, newZipPath }),

  updateModule: (moduleId: string, zipPath: string) =>
    invoke<ModuleRegistryEntry>('update_module', { moduleId, zipPath }),

  addTrustedKey: (authorId: string, publicKeyHex: string) =>
    invoke<void>('add_trusted_key', { authorId, publicKeyHex }),
}

export interface InstallReport {
  success: boolean
  module_id: string | null
  steps_completed: string[]
  errors: string[]
  warnings: string[]
}

export interface ValidationReport {
  valid: boolean
  manifest: unknown | null
  errors: string[]
  warnings: string[]
}

export interface UpdateCheck {
  installed_version: string
  new_version: string
  is_newer: boolean
}

export interface ModuleHealth {
  module_id: string
  status: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'DISABLED'
  error_count: number
  last_error: string | null
  last_success_at: number | null
  window_start: number | null
}

export interface HealthLogEntry {
  id: number
  module_id: string
  event_type: 'error' | 'recovery' | 'auto_disable' | 'manual_disable' | 'manual_enable' | 'init_failed'
  message: string | null
  error_count: number
  timestamp: string
}

export interface NavItemExtension {
  module_id: string
  label: string
  icon: string | null
  route: string
}

export interface SettingsPaneExtension {
  module_id: string
  label: string
  route: string
}

export interface TransactionActionExtension {
  module_id: string
  label: string
  action_id: string
}

export interface ModuleManifest {
  id: string
  name: string
  version: string
  sdk_version: string
  description?: string | null
  author?: string | null
  license?: string | null
  permissions?: string[]
  dependencies?: unknown[]
  entry_point?: string | null
  migrations?: unknown[]
}

export interface ModuleRegistryEntry {
  id: string
  name: string
  version: string
  sdk_version: string
  description: string | null
  author: string | null
  license: string | null
  permissions: string[]
  dependencies: unknown
  entry_point: string | null
  install_path: string | null
  status: string
  installed_at: string
  updated_at: string
  error_message: string | null
}

export interface ServiceHandlerInfo {
  description?: string | null
  params_schema?: unknown
  returns_schema?: unknown
}

export interface RegisteredService {
  module_id: string
  service_name: string
  info: ServiceHandlerInfo
}

export interface MigrationStatus {
  module_id: string
  latest_version: number
  applied_count: number
  pending_count: number
  failed_count: number
  last_error: string | null
}
