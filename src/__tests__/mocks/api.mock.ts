/**
 * In-memory mock of the Tauri API layer.
 * Implements the same business logic as the Rust backend
 * so we can test accounting rules without Tauri running.
 */

import type {
  Account,
  JournalEntryInput,
  AccountLedgerResult,
  LedgerEntry,
  TrialBalanceResult,
  IncomeStatementResult,
  BalanceSheetResult,
  AccountBalanceRow,
  AccountBalanceItem,
  AppMetadata,
  DashboardSummary,
  TransactionWithEntries,
  ListTransactionsResult,
  ListTransactionsFilters,
  AuditLogEntry,
  ExportResult,
  ImportResult,
  AutoBackupResult,
  BackupInfo,
  FileInfo,
  RecentFile,
  LockedPeriod,
  Dimension,
  LineDimension,
  DimensionFilter,
  Contact,
  ContactLedgerEntry,
  ContactLedgerResult,
  GLAccountGroup,
  GLEntry,
  GLEntryDimension,
  GLFilters,
  DocumentMeta,
} from '../../lib/api'

interface StoredTransaction {
  id: string
  date: string
  description: string
  reference: string | null
  journal_type: string
  is_locked: number
  is_void: number
  void_of: string | null
  created_at: number
}

interface StoredEntry {
  id: string
  transaction_id: string
  account_id: string
  debit: number
  credit: number
  memo: string | null
  is_reconciled: number
}

function isDebitNormal(type: string): boolean {
  return type === 'ASSET' || type === 'EXPENSE'
}

function normalBalanceFor(type: string): string {
  return isDebitNormal(type) ? 'DEBIT' : 'CREDIT'
}

interface StoredAuditLog {
  id: string
  transaction_id: string
  field_changed: string
  old_value: string
  new_value: string
  changed_at: number
}

interface StoredLockPeriod {
  account_id: string
  period_start: string
  period_end: string
}

export class MockApi {
  accounts: Account[] = []
  transactions: StoredTransaction[] = []
  entries: StoredEntry[] = []
  auditLog: StoredAuditLog[] = []
  lockPeriods: StoredLockPeriod[] = []
  backups: { path: string; filename: string; size: number; created_at: string }[] = []
  globalLocks: { id: string; end_date: string; locked_at: number }[] = []
  settings: Record<string, string> = {
    company_name: 'My Company',
    fiscal_year_start_month: '1',
    currency_symbol: '$',
    date_format: 'YYYY-MM-DD',
  }
  modules: { id: string; name: string; version: string; description: string | null; table_prefix: string; enabled: number; installed_at: number }[] = []
  pendingBankTxs: {
    id: string; date: string; description: string; amount: number; payee: string | null;
    bank_ref: string | null; status: string; suggested_account_id: string | null;
    created_transaction_id: string | null; imported_at: number
  }[] = []
  recurringTemplates: {
    id: string; description: string; recurrence: string; start_date: string; end_date: string | null;
    last_generated: string | null; is_paused: number; entries: { account_id: string; debit: number; credit: number; memo?: string }[];
    created_at: number
  }[] = []
  dimensions: Dimension[] = []
  lineDimensions: { id: string; transaction_line_id: string; dimension_id: string }[] = []
  contacts: Contact[] = []
  transactionContacts: { id: string; transaction_id: string; contact_id: string; role: string }[] = []
  documents: DocumentMeta[] = []
  recentFiles: RecentFile[] = []
  fileOpen = false
  currentPath: string | null = null
  private nextId = 1
  private auditSeq = 0

  private guardFileOpen(): void {
    if (!this.fileOpen) throw new Error('No file is open')
  }

  private genId(): string {
    return `mock-${this.nextId++}`
  }

  createNewFile(path: string, companyName: string): FileInfo {
    this.resetData()
    this.fileOpen = true
    this.currentPath = path
    this.settings.company_name = companyName
    this.seedAccounts(defaultSeedAccounts)
    this.addToRecent(path, companyName)
    return { path, company_name: companyName }
  }

  openFile(path: string): FileInfo {
    if (path.includes('missing')) throw new Error(`File not found: ${path}`)
    if (path.includes('invalid')) throw new Error("Invalid book file: missing 'accounts' table")
    this.fileOpen = true
    this.currentPath = path
    this.addToRecent(path, this.settings.company_name)
    return { path, company_name: this.settings.company_name }
  }

  closeFile(): void {
    this.fileOpen = false
    this.currentPath = null
  }

  getRecentFiles(): RecentFile[] {
    return this.recentFiles.slice()
  }

  openRecentFile(path: string): FileInfo {
    return this.openFile(path)
  }

  removeRecentFile(path: string): void {
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)
  }

  isFileOpen(): boolean {
    return this.fileOpen
  }

  private addToRecent(path: string, companyName: string): void {
    this.recentFiles = this.recentFiles.filter((f) => f.path !== path)
    this.recentFiles.unshift({ path, company_name: companyName, last_opened: new Date().toISOString() })
    if (this.recentFiles.length > 10) this.recentFiles.length = 10
  }

  private resetData(): void {
    this.accounts = []
    this.transactions = []
    this.entries = []
    this.auditLog = []
    this.lockPeriods = []
    this.globalLocks = []
    this.modules = []
    this.pendingBankTxs = []
    this.reconciliations = []
    this.recurringTemplates = []
    this.dimensions = []
    this.lineDimensions = []
    this.settings = {
      company_name: 'My Company',
      fiscal_year_start_month: '1',
      currency_symbol: '$',
      date_format: 'YYYY-MM-DD',
    }
  }

  seedAccounts(seedData: { code: string; name: string; type: string }[]): void {
    this.fileOpen = true // seedAccounts implies a file is open
    if (this.accounts.length > 0) return
    const now = Date.now()
    const systemCodes = new Set(['3200', '3500'])
    const cashCodes = new Set(['1000', '1010', '1020'])
    for (const s of seedData) {
      this.accounts.push({
        id: this.genId(),
        code: s.code,
        name: s.name,
        type: s.type,
        normal_balance: normalBalanceFor(s.type),
        parent_id: null,
        is_active: 1,
        is_system: systemCodes.has(s.code) ? 1 : 0,
        is_cash_account: cashCodes.has(s.code) ? 1 : 0,
        cash_flow_category: null,
        depth: 0,
        created_at: now,
      })
    }
  }

  getAccounts(): Account[] {
    this.guardFileOpen()
    const active = this.accounts.filter((a) => a.is_active === 1)
    // Compute depth
    const idToParent = new Map(this.accounts.map((a) => [a.id, a.parent_id]))
    for (const acct of active) {
      let depth = 0
      let current = acct.parent_id
      while (current) {
        depth++
        current = idToParent.get(current) ?? null
        if (depth > 10) break
      }
      acct.depth = depth
    }
    return active.sort((a, b) => a.code.localeCompare(b.code))
  }

  createTransaction(data: {
    date: string
    description: string
    reference?: string
    journal_type?: string
    entries: JournalEntryInput[]
  }): string {
    const journalType = data.journal_type ?? 'GENERAL'
    const validTypes = ['GENERAL', 'ADJUSTING', 'CLOSING', 'REVERSING', 'OPENING']
    if (!validTypes.includes(journalType)) {
      throw new Error(`Invalid journal type: ${journalType}`)
    }
    // Users cannot manually create system journal types
    if (['CLOSING', 'REVERSING', 'OPENING'].includes(journalType)) {
      throw new Error(`Cannot manually create ${journalType} journal entries`)
    }
    // Check period locks
    if (this.globalLocks.some((gl) => gl.end_date >= data.date)) {
      throw new Error('Cannot create transaction in a locked period')
    }

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

    // Check for deactivated accounts
    for (const entry of data.entries) {
      const acct = this.accounts.find((a) => a.id === entry.account_id)
      if (acct && acct.is_active !== 1) {
        throw new Error(`Cannot create transaction with deactivated account: ${acct.name}`)
      }
    }

    // Auto-reference number if not provided
    let ref_ = data.reference ?? null
    if (!ref_) {
      const prefixMap: Record<string, string> = {
        GENERAL: 'GJ', ADJUSTING: 'AJ', CLOSING: 'CJ', REVERSING: 'RJ', OPENING: 'OJ',
      }
      const prefix = prefixMap[journalType] ?? 'GJ'
      const counterKey = `next_ref_${journalType.toLowerCase()}`
      const counter = parseInt(this.settings[counterKey] ?? '1', 10)
      ref_ = `${prefix}-${String(counter).padStart(4, '0')}`
      this.settings[counterKey] = String(counter + 1)
    }

    const txId = this.genId()
    this.transactions.push({
      id: txId,
      date: data.date,
      description: data.description,
      reference: ref_,
      journal_type: journalType,
      is_locked: 0,
      is_void: 0,
      void_of: null,
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
        is_reconciled: 0,
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

  getTrialBalance(asOfDate?: string, excludeJournalTypes?: string[]): TrialBalanceResult {
    const rows: AccountBalanceRow[] = []
    const excludeTypes = new Set(excludeJournalTypes ?? [])

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter((e) => e.account_id === acct.id)
      const filteredTxs = this.transactions.filter((t) => {
        if (asOfDate && t.date > asOfDate) return false
        if (excludeTypes.size > 0 && excludeTypes.has(t.journal_type)) return false
        return true
      })
      const txIds = new Set(filteredTxs.map((t) => t.id))
      relevantEntries = relevantEntries.filter((e) => txIds.has(e.transaction_id))

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
          depth: acct.depth ?? 0,
          parent_id: acct.parent_id,
        })
      }
    }

    const total_debits = rows.reduce((s, r) => s + r.debit, 0)
    const total_credits = rows.reduce((s, r) => s + r.credit, 0)

    return { rows, total_debits, total_credits, is_balanced: total_debits === total_credits }
  }

  getIncomeStatement(startDate: string, endDate: string, excludeJournalTypes?: string[], basis?: string): IncomeStatementResult {
    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const cashAccountIds = new Set(this.accounts.filter((a) => a.is_cash_account === 1).map((a) => a.id))
    let filteredTxs = this.transactions
      .filter((t) => t.date >= startDate && t.date <= endDate && !excludeTypes.has(t.journal_type))
    if (basis === 'CASH') {
      // Only include transactions that have at least one entry to a cash account
      filteredTxs = filteredTxs.filter((t) =>
        this.entries.some((e) => e.transaction_id === t.id && cashAccountIds.has(e.account_id))
      )
    }
    const txIds = new Set(filteredTxs.map((t) => t.id))

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

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

  private buildTxWithEntries(tx: StoredTransaction): TransactionWithEntries {
    return {
      ...tx,
      entries: this.entries
        .filter((e) => e.transaction_id === tx.id)
        .map((e) => ({ ...e })),
    }
  }

  listTransactions(filters?: ListTransactionsFilters): ListTransactionsResult {
    let txs = this.transactions.slice()

    if (filters?.start_date) {
      txs = txs.filter((t) => t.date >= filters.start_date!)
    }
    if (filters?.end_date) {
      txs = txs.filter((t) => t.date <= filters.end_date!)
    }
    if (filters?.account_id) {
      const aid = filters.account_id
      const txIds = new Set(this.entries.filter((e) => e.account_id === aid).map((e) => e.transaction_id))
      txs = txs.filter((t) => txIds.has(t.id))
    }
    if (filters?.memo_search) {
      const search = filters.memo_search.toLowerCase()
      txs = txs.filter((t) => t.description.toLowerCase().includes(search))
    }

    txs.sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)

    const total = txs.length
    const off = filters?.offset ?? 0
    const lim = filters?.limit ?? 50
    txs = txs.slice(off, off + lim)

    return {
      transactions: txs.map((tx) => this.buildTxWithEntries(tx)),
      total,
    }
  }

  getTransactionDetail(transactionId: string): TransactionWithEntries {
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) throw new Error(`Transaction not found: ${transactionId}`)
    return this.buildTxWithEntries(tx)
  }

  countTransactions(filters?: ListTransactionsFilters): number {
    return this.listTransactions(filters).total
  }

  private isTransactionLocked(transactionId: string): boolean {
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) return false

    // Check global locks
    if (this.globalLocks.some((gl) => gl.end_date >= tx.date)) return true

    // Check per-account locks
    const txEntryAccountIds = this.entries
      .filter((e) => e.transaction_id === transactionId)
      .map((e) => e.account_id)
    return this.lockPeriods.some((lp) =>
      txEntryAccountIds.includes(lp.account_id) &&
      lp.period_start <= tx.date && lp.period_end >= tx.date
    )
  }

  private writeAuditLog(transactionId: string, fieldChanged: string, oldValue: string, newValue: string): void {
    this.auditSeq++
    this.auditLog.push({
      id: this.genId(),
      transaction_id: transactionId,
      field_changed: fieldChanged,
      old_value: oldValue,
      new_value: newValue,
      changed_at: this.auditSeq,
    })
  }

  addLockPeriod(accountId: string, periodStart: string, periodEnd: string): void {
    this.lockPeriods.push({ account_id: accountId, period_start: periodStart, period_end: periodEnd })
  }

  updateTransaction(transactionId: string, data: { date?: string; description?: string; reference?: string }): void {
    if (this.isTransactionLocked(transactionId)) {
      throw new Error('Cannot edit: transaction is in a locked period')
    }
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) throw new Error(`Transaction not found: ${transactionId}`)
    if (tx.is_void === 1) throw new Error('Cannot edit a voided transaction')

    if (data.date !== undefined && data.date !== tx.date) {
      this.writeAuditLog(transactionId, 'date', tx.date, data.date)
      tx.date = data.date
    }
    if (data.description !== undefined && data.description !== tx.description) {
      this.writeAuditLog(transactionId, 'description', tx.description, data.description)
      tx.description = data.description
    }
    if (data.reference !== undefined && data.reference !== (tx.reference ?? '')) {
      this.writeAuditLog(transactionId, 'reference', tx.reference ?? '', data.reference)
      tx.reference = data.reference
    }
  }

  updateTransactionLines(transactionId: string, newEntries: JournalEntryInput[], dimensions?: { line_index: number; dimension_id: string }[]): void {
    if (this.isTransactionLocked(transactionId)) {
      throw new Error('Cannot edit: transaction is in a locked period')
    }
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) throw new Error(`Transaction not found: ${transactionId}`)
    if (tx.is_void === 1) throw new Error('Cannot edit a voided transaction')

    const totalDebit = newEntries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = newEntries.reduce((s, e) => s + e.credit, 0)
    if (totalDebit !== totalCredit) {
      throw new Error(`Lines do not balance: debits=${totalDebit} credits=${totalCredit}`)
    }
    if (totalDebit === 0) throw new Error('Transaction must have non-zero amounts')

    // Validate dimensions
    if (dimensions) {
      for (const dimRef of dimensions) {
        const dim = this.dimensions.find((d) => d.id === dimRef.dimension_id)
        if (!dim) throw new Error(`Dimension not found: ${dimRef.dimension_id}`)
        if (dim.is_active !== 1) throw new Error(`Cannot use inactive dimension: ${dim.name}`)
        if (dimRef.line_index < 0 || dimRef.line_index >= newEntries.length) {
          throw new Error(`Invalid line_index: ${dimRef.line_index}`)
        }
      }
    }

    const oldEntries = this.entries.filter((e) => e.transaction_id === transactionId)
    const oldStr = oldEntries.map((e) => `${e.account_id}:D${e.debit}C${e.credit}`).join(';')
    const newStr = newEntries.map((e) => `${e.account_id}:D${e.debit}C${e.credit}`).join(';')

    // Remove old dimensions for old entries
    const oldEntryIds = new Set(oldEntries.map((e) => e.id))
    this.lineDimensions = this.lineDimensions.filter((ld) => !oldEntryIds.has(ld.transaction_line_id))

    this.entries = this.entries.filter((e) => e.transaction_id !== transactionId)
    for (const entry of newEntries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: transactionId,
        account_id: entry.account_id,
        debit: entry.debit,
        credit: entry.credit,
        memo: entry.memo ?? null,
        is_reconciled: 0,
      })
    }

    // Add new dimensions
    if (dimensions) {
      const txEntries = this.entries.filter((e) => e.transaction_id === transactionId)
      for (const dimRef of dimensions) {
        const lineId = txEntries[dimRef.line_index].id
        this.lineDimensions.push({
          id: this.genId(),
          transaction_line_id: lineId,
          dimension_id: dimRef.dimension_id,
        })
      }
    }

    this.writeAuditLog(transactionId, 'lines', oldStr, newStr)
  }

  voidTransaction(transactionId: string): string {
    if (this.isTransactionLocked(transactionId)) {
      throw new Error('Cannot void: transaction is in a locked period')
    }
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) throw new Error(`Transaction not found: ${transactionId}`)
    if (tx.is_void) throw new Error('Transaction is already voided')
    if (tx.void_of !== null) throw new Error('Cannot void a reversing entry')

    const originalEntries = this.entries.filter((e) => e.transaction_id === transactionId)

    // Create reversing transaction
    const voidTxId = this.genId()
    this.transactions.push({
      id: voidTxId,
      date: tx.date,
      description: `VOID: ${tx.description}`,
      reference: 'VOID',
      journal_type: 'REVERSING',
      is_locked: 0,
      is_void: 0,
      void_of: transactionId,
      created_at: Date.now(),
    })

    // Reversed entries (debit↔credit)
    for (const entry of originalEntries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: voidTxId,
        account_id: entry.account_id,
        debit: entry.credit,
        credit: entry.debit,
        memo: entry.memo,
        is_reconciled: 0,
      })
    }

    tx.is_void = 1
    this.writeAuditLog(transactionId, 'voided', 'false', 'true')
    return voidTxId
  }

  getAuditLog(transactionId: string): AuditLogEntry[] {
    return this.auditLog
      .filter((a) => a.transaction_id === transactionId)
      .sort((a, b) => b.changed_at - a.changed_at)
  }

  exportDatabase(destination: string): ExportResult {
    // Simulate: just record the export
    return { path: destination, size: 1024 }
  }

  importDatabase(source: string): ImportResult {
    // Simulate validation: reject if source is "corrupt"
    if (source.includes('corrupt')) {
      throw new Error('Invalid database file')
    }
    // In real implementation this replaces the db; in mock we just return counts
    return {
      account_count: this.accounts.length,
      transaction_count: this.transactions.length,
    }
  }

  autoBackup(): AutoBackupResult {
    const filename = `bookkeeping-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
    const path = `/backups/${filename}`
    this.backups.push({ path, filename, size: 1024, created_at: new Date().toISOString() })

    // Keep only 5 most recent
    this.backups.sort((a, b) => b.filename.localeCompare(a.filename))
    if (this.backups.length > 5) {
      this.backups = this.backups.slice(0, 5)
    }

    return { path, backup_count: this.backups.length }
  }

  listBackups(): BackupInfo[] {
    return this.backups.sort((a, b) => b.filename.localeCompare(a.filename))
  }

  exportCsv(exportType: string, options?: {
    startDate?: string; endDate?: string; asOfDate?: string;
    accountId?: string; memoSearch?: string;
  }): string {
    const dollarStr = (cents: number): string => {
      const neg = cents < 0
      const abs = Math.abs(cents)
      const d = Math.floor(abs / 100)
      const r = abs % 100
      return neg ? `-${d}.${String(r).padStart(2, '0')}` : `${d}.${String(r).padStart(2, '0')}`
    }

    switch (exportType) {
      case 'ChartOfAccounts': {
        let csv = 'Account Number,Account Name,Type,Active,Balance\n'
        for (const acct of this.accounts.slice().sort((a, b) => a.code.localeCompare(b.code))) {
          const balance = this.getAccountBalance(acct.id)
          csv += `${acct.code},"${acct.name}",${acct.type},${acct.is_active ? 'Yes' : 'No'},${dollarStr(balance)}\n`
        }
        return csv
      }
      case 'TrialBalance': {
        const tb = this.getTrialBalance(options?.asOfDate)
        let csv = 'Account Number,Account Name,Debit,Credit\n'
        for (const row of tb.rows) {
          csv += `${row.code},"${row.name}",${dollarStr(row.debit)},${dollarStr(row.credit)}\n`
        }
        csv += `TOTAL,,${dollarStr(tb.total_debits)},${dollarStr(tb.total_credits)}\n`
        return csv
      }
      case 'IncomeStatement': {
        const is = this.getIncomeStatement(
          options?.startDate ?? '0000-01-01',
          options?.endDate ?? '9999-12-31',
        )
        let csv = 'Account Name,Type,Amount\n'
        for (const acct of [...is.revenue, ...is.expenses]) {
          const type = is.revenue.includes(acct) ? 'REVENUE' : 'EXPENSE'
          csv += `"${acct.name}",${type},${dollarStr(acct.balance)}\n`
        }
        csv += `Net Income,,${dollarStr(is.net_income)}\n`
        return csv
      }
      case 'BalanceSheet': {
        const bs = this.getBalanceSheet(options?.asOfDate ?? '9999-12-31')
        let csv = 'Account Name,Type,Amount\n'
        for (const acct of bs.assets) csv += `"${acct.name}",ASSET,${dollarStr(acct.balance)}\n`
        for (const acct of bs.liabilities) csv += `"${acct.name}",LIABILITY,${dollarStr(acct.balance)}\n`
        for (const acct of bs.equity) csv += `"${acct.name}",EQUITY,${dollarStr(acct.balance)}\n`
        return csv
      }
      case 'TransactionRegister': {
        let txs = this.transactions.slice()
        if (options?.startDate) txs = txs.filter((t) => t.date >= options.startDate!)
        if (options?.endDate) txs = txs.filter((t) => t.date <= options.endDate!)
        if (options?.accountId) {
          const aid = options.accountId
          const txIds = new Set(this.entries.filter((e) => e.account_id === aid).map((e) => e.transaction_id))
          txs = txs.filter((t) => txIds.has(t.id))
        }
        if (options?.memoSearch) {
          const s = options.memoSearch.toLowerCase()
          txs = txs.filter((t) => t.description.toLowerCase().includes(s))
        }
        txs.sort((a, b) => a.date.localeCompare(b.date))
        let csv = 'Date,Reference,Description,Account,Debit,Credit\n'
        for (const tx of txs) {
          const entries = this.entries.filter((e) => e.transaction_id === tx.id)
          for (const e of entries) {
            const acct = this.accounts.find((a) => a.id === e.account_id)
            csv += `${tx.date},${tx.reference ?? ''},"${tx.description}","${acct?.name ?? e.account_id}",${dollarStr(e.debit)},${dollarStr(e.credit)}\n`
          }
        }
        return csv
      }
      default:
        throw new Error(`Unknown export type: ${exportType}`)
    }
  }

  getAccountLedger(accountId: string, options?: {
    startDate?: string; endDate?: string; offset?: number; limit?: number
  }): AccountLedgerResult {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)

    // Get all journal entries for this account, joined with transactions
    let pairs = this.entries
      .filter((e) => e.account_id === accountId)
      .map((e) => {
        const tx = this.transactions.find((t) => t.id === e.transaction_id)!
        return { entry: e, tx }
      })
      .filter((p) => {
        if (options?.startDate && p.tx.date < options.startDate) return false
        if (options?.endDate && p.tx.date > options.endDate) return false
        return true
      })
      .sort((a, b) => a.tx.date.localeCompare(b.tx.date) || a.tx.created_at - b.tx.created_at)

    const total = pairs.length
    const off = options?.offset ?? 0
    const lim = options?.limit ?? 100
    pairs = pairs.slice(off, off + lim)

    const isDebit = isDebitNormal(acct.type)
    let running = 0
    const entries: LedgerEntry[] = pairs.map(({ entry, tx }) => {
      running += isDebit ? entry.debit - entry.credit : entry.credit - entry.debit
      return {
        transaction_id: tx.id,
        date: tx.date,
        description: tx.description,
        reference: tx.reference,
        debit: entry.debit,
        credit: entry.credit,
        running_balance: running,
        memo: entry.memo,
      }
    })

    return {
      account_id: accountId,
      account_code: acct.code,
      account_name: acct.name,
      account_type: acct.type,
      entries,
      total,
    }
  }

  lockPeriodGlobal(endDate: string): void {
    if (this.globalLocks.some((gl) => gl.end_date > endDate)) {
      throw new Error('Cannot lock: a later period is already locked (would create gap)')
    }
    if (this.globalLocks.some((gl) => gl.end_date === endDate)) {
      return // Duplicate — idempotent
    }
    this.globalLocks.push({ id: this.genId(), end_date: endDate, locked_at: Date.now() })
  }

  unlockPeriodGlobal(): void {
    if (this.globalLocks.length === 0) throw new Error('No locked periods to unlock')
    this.globalLocks.sort((a, b) => b.end_date.localeCompare(a.end_date))
    this.globalLocks.shift()
  }

  listLockedPeriodsGlobal(): LockedPeriod[] {
    return this.globalLocks
      .slice()
      .sort((a, b) => b.end_date.localeCompare(a.end_date))
  }

  isDateLocked(date: string): boolean {
    return this.globalLocks.some((gl) => gl.end_date >= date)
  }

  getSetting(key: string): string | null {
    return this.settings[key] ?? null
  }

  setSetting(key: string, value: string): void {
    this.settings[key] = value
  }

  getAllSettings(): Record<string, string> {
    return { ...this.settings }
  }

  getAppMetadata(): AppMetadata {
    return {
      version: '0.1.0',
      db_path: ':memory:',
      last_backup_date: null,
    }
  }

  createAccount(data: { code: string; name: string; acctType: string; parentId?: string }): string {
    const validTypes = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']
    if (!validTypes.includes(data.acctType)) {
      throw new Error(`Invalid account type: ${data.acctType}`)
    }
    if (!data.name.trim()) throw new Error('Account name cannot be empty')
    if (!data.code.trim()) throw new Error('Account code cannot be empty')
    if (this.accounts.some((a) => a.code === data.code)) {
      throw new Error(`Account code '${data.code}' already exists`)
    }

    // Check for circular parent reference
    if (data.parentId) {
      const parent = this.accounts.find((a) => a.id === data.parentId)
      if (!parent) throw new Error(`Parent account not found: ${data.parentId}`)
      // Walk parent chain — if we find data.parentId pointing back, it's circular
      let current = parent.parent_id
      let depth = 0
      while (current) {
        if (current === data.parentId) throw new Error('Circular parent reference detected')
        const p = this.accounts.find((a) => a.id === current)
        current = p?.parent_id ?? null
        if (++depth > 10) throw new Error('Circular parent reference detected')
      }
    }

    const id = this.genId()
    this.accounts.push({
      id,
      code: data.code.trim(),
      name: data.name.trim(),
      type: data.acctType,
      normal_balance: isDebitNormal(data.acctType) ? 'DEBIT' : 'CREDIT',
      parent_id: data.parentId ?? null,
      is_active: 1,
      is_system: 0,
      is_cash_account: 0,
      cash_flow_category: null,
      depth: 0,
      created_at: Date.now(),
    })
    return id
  }

  updateAccount(accountId: string, data: { name?: string; code?: string; acctType?: string; parentId?: string }): void {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)

    // Reject account type changes
    if (data.acctType !== undefined) {
      throw new Error('Account type cannot be changed after creation')
    }

    if (data.name !== undefined) {
      if (!data.name.trim()) throw new Error('Account name cannot be empty')
      acct.name = data.name.trim()
    }
    if (data.code !== undefined) {
      if (!data.code.trim()) throw new Error('Account code cannot be empty')
      if (this.accounts.some((a) => a.code === data.code && a.id !== accountId)) {
        throw new Error(`Account code '${data.code}' already exists`)
      }
      acct.code = data.code.trim()
    }
    if (data.parentId !== undefined) {
      if (data.parentId) {
        const parent = this.accounts.find((a) => a.id === data.parentId)
        if (!parent) throw new Error(`Parent account not found: ${data.parentId}`)
        // Walk parent chain to detect cycles
        let current: string | null = data.parentId
        let depth = 0
        while (current) {
          if (current === accountId) throw new Error('Circular parent reference detected')
          const p = this.accounts.find((a) => a.id === current)
          current = p?.parent_id ?? null
          if (++depth > 10) throw new Error('Circular parent reference detected')
        }
      }
      acct.parent_id = data.parentId
    }
  }

  deactivateAccount(accountId: string): void {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)
    if (acct.is_system === 1) throw new Error('Cannot deactivate a system account')

    const balance = this.getAccountBalance(accountId)
    if (balance !== 0) {
      throw new Error(`Cannot deactivate account with non-zero balance (${balance})`)
    }
    acct.is_active = 0
  }

  reactivateAccount(accountId: string): void {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)
    acct.is_active = 1
  }

  enterOpeningBalances(balances: { account_id: string; balance: number }[], effectiveDate: string): string {
    // Find Opening Balance Equity account
    const obeAcct = this.accounts.find((a) => a.code === '3500')
    if (!obeAcct) throw new Error('Opening Balance Equity account not found')

    // Check for existing non-voided OPENING transaction
    const existingOpening = this.transactions.find((t) => t.journal_type === 'OPENING' && t.is_void === 0)
    if (existingOpening) {
      throw new Error('Opening balances have already been entered. Void the existing opening balance entry first if you need to re-enter.')
    }

    const entries: { account_id: string; debit: number; credit: number; memo?: string }[] = []

    for (const { account_id, balance } of balances) {
      if (balance === 0) continue
      const acct = this.accounts.find((a) => a.id === account_id)
      if (!acct) throw new Error(`Account not found: ${account_id}`)

      if (isDebitNormal(acct.type)) {
        if (balance > 0) {
          entries.push({ account_id, debit: balance, credit: 0 })
        } else {
          entries.push({ account_id, debit: 0, credit: -balance })
        }
      } else {
        if (balance > 0) {
          entries.push({ account_id, debit: 0, credit: balance })
        } else {
          entries.push({ account_id, debit: -balance, credit: 0 })
        }
      }
    }

    if (entries.length === 0) throw new Error('No non-zero balances provided')

    // Calculate offset for Opening Balance Equity
    const totalDebit = entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = entries.reduce((s, e) => s + e.credit, 0)
    const diff = totalDebit - totalCredit
    if (diff > 0) {
      entries.push({ account_id: obeAcct.id, debit: 0, credit: diff })
    } else if (diff < 0) {
      entries.push({ account_id: obeAcct.id, debit: -diff, credit: 0 })
    }

    // Create transaction directly (bypass system type restriction)
    const txId = this.genId()
    this.transactions.push({
      id: txId,
      date: effectiveDate,
      description: 'Opening Balances',
      reference: 'OJ-0001',
      journal_type: 'OPENING',
      is_locked: 0,
      is_void: 0,
      void_of: null,
      created_at: Date.now(),
    })

    for (const entry of entries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: txId,
        account_id: entry.account_id,
        debit: entry.debit,
        credit: entry.credit,
        memo: entry.memo ?? null,
        is_reconciled: 0,
      })
    }

    return txId
  }

  closeFiscalYear(fiscalYearEndDate: string): { transaction_id: string; net_income: number } {
    // Check not already closed
    const existing = this.transactions.find(
      (t) => t.journal_type === 'CLOSING' && t.date === fiscalYearEndDate
    )
    if (existing) throw new Error('Fiscal year already closed for this date')

    // Find retained earnings account
    const reAcct = this.accounts.find((a) => a.code === '3200')
    if (!reAcct) throw new Error('Retained Earnings account not found')

    // Determine fiscal year start from settings
    const startMonth = parseInt(this.settings.fiscal_year_start_month ?? '1', 10)
    const endYear = parseInt(fiscalYearEndDate.split('-')[0], 10)
    const startYear = startMonth === 1 ? endYear : endYear - 1
    const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`

    // Get income statement for the fiscal year
    const is = this.getIncomeStatement(startDate, fiscalYearEndDate)

    const entries: { account_id: string; debit: number; credit: number }[] = []

    // Zero out revenue accounts (debit them)
    for (const rev of is.revenue) {
      entries.push({ account_id: rev.account_id, debit: rev.balance, credit: 0 })
    }

    // Zero out expense accounts (credit them)
    for (const exp of is.expenses) {
      entries.push({ account_id: exp.account_id, debit: 0, credit: exp.balance })
    }

    // Net income to Retained Earnings
    const netIncome = is.net_income
    if (netIncome > 0) {
      entries.push({ account_id: reAcct.id, debit: 0, credit: netIncome })
    } else if (netIncome < 0) {
      entries.push({ account_id: reAcct.id, debit: -netIncome, credit: 0 })
    }

    // Create CLOSING transaction directly (bypass system type restriction)
    // Zero-activity years are valid — create the entry even with no lines
    const txId = this.genId()
    this.transactions.push({
      id: txId,
      date: fiscalYearEndDate,
      description: `Closing Entry — FY ending ${fiscalYearEndDate}`,
      reference: 'CJ-CLOSE',
      journal_type: 'CLOSING',
      is_locked: 0,
      is_void: 0,
      void_of: null,
      created_at: Date.now(),
    })

    for (const entry of entries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: txId,
        account_id: entry.account_id,
        debit: entry.debit,
        credit: entry.credit,
        memo: null,
        is_reconciled: 0,
      })
    }

    // Lock the period through the fiscal year end date
    if (!this.globalLocks.some((gl) => gl.end_date >= fiscalYearEndDate)) {
      this.globalLocks.push({ id: this.genId(), end_date: fiscalYearEndDate, locked_at: Date.now() })
    }

    return { transaction_id: txId, net_income: netIncome }
  }

  listFiscalYearCloses(): { transaction_id: string; date: string; net_income: number }[] {
    return this.transactions
      .filter((t) => t.journal_type === 'CLOSING')
      .map((t) => {
        const entries = this.entries.filter((e) => e.transaction_id === t.id)
        const reAcct = this.accounts.find((a) => a.code === '3200')
        const reEntry = entries.find((e) => e.account_id === reAcct?.id)
        const netIncome = reEntry ? (reEntry.credit - reEntry.debit) : 0
        return { transaction_id: t.id, date: t.date, net_income: netIncome }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  getCashFlowStatement(startDate: string, endDate: string): {
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
  } {
    // Net income for the period
    const is = this.getIncomeStatement(startDate, endDate)
    const netIncome = is.net_income

    // Calculate beginning and ending cash balances
    const cashAccounts = this.accounts.filter((a) => a.is_cash_account === 1)
    const dayBefore = (() => {
      const d = new Date(startDate)
      d.setDate(d.getDate() - 1)
      return d.toISOString().split('T')[0]
    })()

    let beginningCash = 0
    for (const ca of cashAccounts) {
      beginningCash += this.getAccountBalance(ca.id, dayBefore)
    }

    let endingCash = 0
    for (const ca of cashAccounts) {
      endingCash += this.getAccountBalance(ca.id, endDate)
    }

    // Changes in non-cash balance sheet accounts = adjustments
    const operating: { account_id: string; code: string; name: string; amount: number }[] = []
    const investing: { account_id: string; code: string; name: string; amount: number }[] = []
    const financing: { account_id: string; code: string; name: string; amount: number }[] = []

    for (const acct of this.accounts.filter((a) => a.is_active === 1)) {
      if (acct.is_cash_account === 1) continue
      if (acct.type === 'REVENUE' || acct.type === 'EXPENSE') continue

      const beginBal = this.getAccountBalance(acct.id, dayBefore)
      const endBal = this.getAccountBalance(acct.id, endDate)
      const change = endBal - beginBal
      if (change === 0) continue

      // For cash flow: increase in assets = cash outflow (negative)
      // increase in liabilities/equity = cash inflow (positive)
      const cashImpact = isDebitNormal(acct.type) ? -change : change

      const category = acct.cash_flow_category
      const item = { account_id: acct.id, code: acct.code, name: acct.name, amount: cashImpact }

      if (category === 'INVESTING') {
        investing.push(item)
      } else if (category === 'FINANCING') {
        financing.push(item)
      } else {
        // Default: current assets/liabilities → operating, long-term → investing/financing
        // Simple heuristic: ASSET codes < 1500 are operating, >= 1500 investing
        // LIABILITY codes < 2500 operating, >= 2500 financing
        // EQUITY → financing
        if (acct.type === 'ASSET') {
          if (parseInt(acct.code) < 1500) operating.push(item)
          else investing.push(item)
        } else if (acct.type === 'LIABILITY') {
          if (parseInt(acct.code) < 2500) operating.push(item)
          else financing.push(item)
        } else {
          financing.push(item)
        }
      }
    }

    const totalOperating = netIncome + operating.reduce((s, i) => s + i.amount, 0)
    const totalInvesting = investing.reduce((s, i) => s + i.amount, 0)
    const totalFinancing = financing.reduce((s, i) => s + i.amount, 0)

    return {
      net_income: netIncome,
      operating,
      investing,
      financing,
      total_operating: totalOperating,
      total_investing: totalInvesting,
      total_financing: totalFinancing,
      net_change_in_cash: totalOperating + totalInvesting + totalFinancing,
      beginning_cash: beginningCash,
      ending_cash: endingCash,
    }
  }

  importCsvRows(rows: { date: string; description: string; account_code: string; debit: number; credit: number }[]): {
    imported: number; skipped: number; duplicates: number; errors: { row: number; message: string }[]
  } {
    let imported = 0
    let skipped = 0
    let duplicates = 0
    const errors: { row: number; message: string }[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      // Validate date
      if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        errors.push({ row: i, message: `Invalid date: "${row.date}"` })
        skipped++
        continue
      }

      // Validate account
      const acct = this.accounts.find((a) => a.code === row.account_code)
      if (!acct) {
        errors.push({ row: i, message: `Unknown account code: "${row.account_code}"` })
        skipped++
        continue
      }

      // Must have debit or credit but not both
      if (row.debit === 0 && row.credit === 0) {
        errors.push({ row: i, message: 'Row has no amount' })
        skipped++
        continue
      }

      // Duplicate detection: same date + amount + description
      const isDuplicate = this.transactions.some((t) => {
        if (t.date !== row.date || t.description !== row.description) return false
        const txEntries = this.entries.filter((e) => e.transaction_id === t.id)
        return txEntries.some((e) =>
          e.account_id === acct.id &&
          e.debit === row.debit &&
          e.credit === row.credit
        )
      })

      if (isDuplicate) {
        duplicates++
        skipped++
        continue
      }

      // Find a cash account for the offset side
      const cashAcct = this.accounts.find((a) => a.code === '1000')
      if (!cashAcct) {
        errors.push({ row: i, message: 'No cash account found for offset' })
        skipped++
        continue
      }

      // Create a balanced transaction
      try {
        this.createTransaction({
          date: row.date,
          description: row.description || `Import row ${i + 1}`,
          entries: [
            { account_id: acct.id, debit: row.debit, credit: row.credit },
            { account_id: cashAcct.id, debit: row.credit, credit: row.debit },
          ],
        })
        imported++
      } catch (e) {
        errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
        skipped++
      }
    }

    return { imported, skipped, duplicates, errors }
  }

  reconciliations: {
    id: string; account_id: string; statement_date: string; statement_balance: number;
    book_balance: number; is_reconciled: number; reconciled_at: number | null
  }[] = []

  // ── Reconciliation ───────────────────────────────────
  startReconciliation(accountId: string, statementDate: string, statementBalance: number): string {
    const bookBalance = this.getAccountBalance(accountId, statementDate)
    const id = this.genId()
    this.reconciliations.push({
      id, account_id: accountId, statement_date: statementDate,
      statement_balance: statementBalance, book_balance: bookBalance,
      is_reconciled: 0, reconciled_at: null,
    })
    return id
  }

  getReconciliation(reconciliationId: string): typeof this.reconciliations[0] & { difference: number } {
    const rec = this.reconciliations.find((r) => r.id === reconciliationId)
    if (!rec) throw new Error(`Reconciliation not found: ${reconciliationId}`)
    return { ...rec, difference: rec.statement_balance - rec.book_balance }
  }

  completeReconciliation(reconciliationId: string): void {
    const rec = this.reconciliations.find((r) => r.id === reconciliationId)
    if (!rec) throw new Error(`Reconciliation not found: ${reconciliationId}`)

    const diff = rec.statement_balance - rec.book_balance
    if (diff !== 0) throw new Error(`Cannot reconcile: difference of ${diff} cents`)

    rec.is_reconciled = 1
    rec.reconciled_at = Date.now()

    // Mark all entries in the reconciled period + account as reconciled
    const reconciledTxIds = new Set(
      this.transactions
        .filter((t) => t.date <= rec.statement_date)
        .map((t) => t.id)
    )
    for (const entry of this.entries) {
      if (entry.account_id === rec.account_id && reconciledTxIds.has(entry.transaction_id)) {
        entry.is_reconciled = 1
      }
    }

    // Lock the period through the statement date
    if (!this.globalLocks.some((gl) => gl.end_date >= rec.statement_date)) {
      this.globalLocks.push({ id: this.genId(), end_date: rec.statement_date, locked_at: Date.now() })
    }
  }

  listReconciliationHistory(accountId: string): typeof this.reconciliations {
    return this.reconciliations
      .filter((r) => r.account_id === accountId && r.is_reconciled === 1)
      .sort((a, b) => b.statement_date.localeCompare(a.statement_date))
  }

  getUnreconciledEntries(accountId: string): StoredEntry[] {
    return this.entries.filter((e) => e.account_id === accountId && e.is_reconciled === 0)
  }

  // ── Bank Feed ──────────────────────────────────────────
  importBankTransactions(items: { date: string; description: string; amount: number; payee?: string; bank_ref?: string }[]): number {
    let imported = 0
    for (const item of items) {
      // Deduplicate by bank_ref
      if (item.bank_ref && this.pendingBankTxs.some((p) => p.bank_ref === item.bank_ref)) continue

      // Auto-match: find previous categorization for same payee
      let suggested: string | null = null
      if (item.payee) {
        const prev = this.transactions.find((t) => t.description.includes(item.payee!))
        if (prev) {
          const prevEntry = this.entries.find((e) => e.transaction_id === prev.id && e.account_id !== this.accounts.find((a) => a.is_cash_account === 1)?.id)
          if (prevEntry) suggested = prevEntry.account_id
        }
      }

      this.pendingBankTxs.push({
        id: this.genId(), date: item.date, description: item.description,
        amount: item.amount, payee: item.payee ?? null, bank_ref: item.bank_ref ?? null,
        status: 'PENDING', suggested_account_id: suggested,
        created_transaction_id: null, imported_at: Date.now(),
      })
      imported++
    }
    return imported
  }

  listPendingBankTransactions(): typeof this.pendingBankTxs {
    return this.pendingBankTxs.filter((p) => p.status === 'PENDING')
  }

  approveBankTransaction(pendingId: string, accountId: string): string {
    const pending = this.pendingBankTxs.find((p) => p.id === pendingId)
    if (!pending) throw new Error(`Pending transaction not found: ${pendingId}`)
    if (pending.status !== 'PENDING') throw new Error('Transaction already processed')

    const cashAcct = this.accounts.find((a) => a.is_cash_account === 1)
    if (!cashAcct) throw new Error('No cash account found')

    const entries = pending.amount > 0
      ? [ // deposit
          { account_id: cashAcct.id, debit: pending.amount, credit: 0 },
          { account_id: accountId, debit: 0, credit: pending.amount },
        ]
      : [ // withdrawal
          { account_id: accountId, debit: -pending.amount, credit: 0 },
          { account_id: cashAcct.id, debit: 0, credit: -pending.amount },
        ]

    const txId = this.createTransaction({
      date: pending.date,
      description: pending.description,
      entries,
    })

    pending.status = 'APPROVED'
    pending.created_transaction_id = txId
    return txId
  }

  dismissBankTransaction(pendingId: string): void {
    const pending = this.pendingBankTxs.find((p) => p.id === pendingId)
    if (!pending) throw new Error(`Pending transaction not found: ${pendingId}`)
    pending.status = 'DISMISSED'
  }

  createRecurring(data: {
    description: string; recurrence: string; start_date: string; end_date?: string;
    entries: { account_id: string; debit: number; credit: number; memo?: string }[]
  }): string {
    const valid = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']
    if (!valid.includes(data.recurrence)) throw new Error(`Invalid recurrence: ${data.recurrence}`)
    const totalDebit = data.entries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = data.entries.reduce((s, e) => s + e.credit, 0)
    if (totalDebit !== totalCredit) throw new Error('Template entries do not balance')
    if (totalDebit === 0) throw new Error('Template must have non-zero amounts')

    const id = this.genId()
    this.recurringTemplates.push({
      id, description: data.description, recurrence: data.recurrence,
      start_date: data.start_date, end_date: data.end_date ?? null,
      last_generated: null, is_paused: 0, entries: data.entries,
      created_at: Date.now(),
    })
    return id
  }

  listRecurring(): typeof this.recurringTemplates {
    return this.recurringTemplates.slice()
  }

  updateRecurring(id: string, data: { description?: string; recurrence?: string; end_date?: string }): void {
    const tmpl = this.recurringTemplates.find((t) => t.id === id)
    if (!tmpl) throw new Error(`Recurring template not found: ${id}`)
    if (data.description !== undefined) tmpl.description = data.description
    if (data.recurrence !== undefined) tmpl.recurrence = data.recurrence
    if (data.end_date !== undefined) tmpl.end_date = data.end_date
  }

  pauseRecurring(id: string): void {
    const tmpl = this.recurringTemplates.find((t) => t.id === id)
    if (!tmpl) throw new Error(`Recurring template not found: ${id}`)
    tmpl.is_paused = 1
  }

  resumeRecurring(id: string): void {
    const tmpl = this.recurringTemplates.find((t) => t.id === id)
    if (!tmpl) throw new Error(`Recurring template not found: ${id}`)
    tmpl.is_paused = 0
  }

  deleteRecurring(id: string): void {
    const idx = this.recurringTemplates.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error(`Recurring template not found: ${id}`)
    this.recurringTemplates.splice(idx, 1)
  }

  private nextDueDate(tmpl: typeof this.recurringTemplates[0]): string | null {
    // If no last_generated, the first due date is start_date itself
    if (!tmpl.last_generated) return tmpl.start_date

    const base = tmpl.last_generated
    const [yearStr, monthStr] = base.split('-')
    let year = parseInt(yearStr, 10)
    let month = parseInt(monthStr, 10) - 1 // 0-based
    // Use the ORIGINAL start day for clamping (not last_generated day)
    const originalDay = parseInt(tmpl.start_date.split('-')[2], 10)

    switch (tmpl.recurrence) {
      case 'WEEKLY': {
        const d = new Date(Date.UTC(year, month, originalDay + 7))
        const next = d.toISOString().split('T')[0]
        return (tmpl.end_date && next > tmpl.end_date) ? null : next
      }
      case 'MONTHLY': month += 1; break
      case 'QUARTERLY': month += 3; break
      case 'YEARLY': year += 1; break
    }

    // Clamp to last day of target month to prevent date drift
    // e.g. Jan 31 → Feb 28, Mar 31, Apr 30
    const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const clampedDay = Math.min(originalDay, daysInTargetMonth)
    const next = `${year}-${String(month + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
    if (tmpl.end_date && next > tmpl.end_date) return null
    return next
  }

  getDueRecurring(asOfDate: string): { template_id: string; description: string; due_date: string }[] {
    const due: { template_id: string; description: string; due_date: string }[] = []
    for (const tmpl of this.recurringTemplates) {
      if (tmpl.is_paused) continue
      const dueDate = this.nextDueDate(tmpl)
      if (dueDate && dueDate <= asOfDate) {
        due.push({ template_id: tmpl.id, description: tmpl.description, due_date: dueDate })
      }
    }
    return due
  }

  generateRecurring(templateId: string, date: string): string {
    const tmpl = this.recurringTemplates.find((t) => t.id === templateId)
    if (!tmpl) throw new Error(`Recurring template not found: ${templateId}`)
    if (tmpl.is_paused) throw new Error('Cannot generate from paused template')

    const txId = this.createTransaction({
      date,
      description: tmpl.description,
      entries: tmpl.entries.map((e) => ({
        account_id: e.account_id, debit: e.debit, credit: e.credit, memo: e.memo,
      })),
    })
    tmpl.last_generated = date
    return txId
  }

  listModules(): typeof this.modules {
    return this.modules.slice().sort((a, b) => a.name.localeCompare(b.name))
  }

  getModule(moduleId: string): typeof this.modules[0] {
    const mod_ = this.modules.find((m) => m.id === moduleId)
    if (!mod_) throw new Error(`Module not found: ${moduleId}`)
    return { ...mod_ }
  }

  getDashboardSummary(): DashboardSummary {
    const bs = this.getBalanceSheet('9999-12-31')
    const is = this.getIncomeStatement('0000-01-01', '9999-12-31')

    const recentTxs: TransactionWithEntries[] = this.transactions
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at - a.created_at)
      .slice(0, 10)
      .map((tx) => this.buildTxWithEntries(tx))

    return {
      total_assets: bs.total_assets,
      total_liabilities: bs.total_liabilities,
      total_equity: bs.total_equity,
      total_revenue: is.total_revenue,
      total_expenses: is.total_expenses,
      net_income: is.net_income,
      transaction_count: this.transactions.length,
      recent_transactions: recentTxs,
    }
  }
  // ── Phase 32: Dimensions ────────────────────────────────

  createDimension(data: { dimType: string; name: string; code?: string; parentId?: string }): string {
    this.guardFileOpen()
    // Check unique(type, name)
    if (this.dimensions.some((d) => d.type === data.dimType && d.name === data.name)) {
      throw new Error(`Dimension '${data.name}' of type '${data.dimType}' already exists`)
    }
    // Validate parent
    if (data.parentId) {
      const parent = this.dimensions.find((d) => d.id === data.parentId)
      if (!parent) throw new Error(`Parent dimension not found: ${data.parentId}`)
      if (parent.type !== data.dimType) {
        throw new Error(`Parent dimension type '${parent.type}' does not match '${data.dimType}'`)
      }
    }
    const id = this.genId()
    this.dimensions.push({
      id,
      type: data.dimType,
      name: data.name,
      code: data.code ?? null,
      parent_id: data.parentId ?? null,
      is_active: 1,
      created_at: new Date().toISOString(),
      depth: 0,
    })
    return id
  }

  updateDimension(id: string, data: { name?: string; code?: string; parentId?: string; isActive?: number }): void {
    this.guardFileOpen()
    const dim = this.dimensions.find((d) => d.id === id)
    if (!dim) throw new Error(`Dimension not found: ${id}`)

    if (data.parentId !== undefined) {
      const parent = this.dimensions.find((d) => d.id === data.parentId)
      if (!parent) throw new Error(`Parent dimension not found: ${data.parentId}`)
      if (parent.type !== dim.type) {
        throw new Error(`Parent dimension type '${parent.type}' does not match '${dim.type}'`)
      }
      // Check circular
      let current: string | null = data.parentId!
      let depth = 0
      while (current) {
        if (current === id) throw new Error('Circular parent reference detected')
        depth++
        if (depth > 10) break
        const p = this.dimensions.find((d) => d.id === current)
        current = p?.parent_id ?? null
      }
      dim.parent_id = data.parentId!
    }
    if (data.name !== undefined) {
      // Check unique
      if (this.dimensions.some((d) => d.id !== id && d.type === dim.type && d.name === data.name)) {
        throw new Error(`Dimension '${data.name}' of type '${dim.type}' already exists`)
      }
      dim.name = data.name
    }
    if (data.code !== undefined) dim.code = data.code
    if (data.isActive !== undefined) dim.is_active = data.isActive
  }

  listDimensions(dimType?: string): Dimension[] {
    this.guardFileOpen()
    let dims = dimType
      ? this.dimensions.filter((d) => d.type === dimType)
      : [...this.dimensions]

    // Compute depth
    const idToParent = new Map(this.dimensions.map((d) => [d.id, d.parent_id]))
    for (const d of dims) {
      let depth = 0
      let current = d.parent_id
      while (current) {
        depth++
        current = idToParent.get(current) ?? null
        if (depth > 10) break
      }
      d.depth = depth
    }

    return dims.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return a.name.localeCompare(b.name)
    })
  }

  listDimensionTypes(): string[] {
    this.guardFileOpen()
    return [...new Set(this.dimensions.map((d) => d.type))].sort()
  }

  deleteDimension(id: string): void {
    this.guardFileOpen()
    // Check references
    if (this.lineDimensions.some((ld) => ld.dimension_id === id)) {
      throw new Error('Cannot delete dimension with transaction references. Deactivate instead.')
    }
    // Check children
    if (this.dimensions.some((d) => d.parent_id === id)) {
      throw new Error('Cannot delete dimension with child dimensions')
    }
    this.dimensions = this.dimensions.filter((d) => d.id !== id)
  }

  getTransactionDimensions(transactionId: string): LineDimension[] {
    this.guardFileOpen()
    const lineIds = new Set(
      this.entries.filter((e) => e.transaction_id === transactionId).map((e) => e.id),
    )
    return this.lineDimensions
      .filter((ld) => lineIds.has(ld.transaction_line_id))
      .map((ld) => {
        const dim = this.dimensions.find((d) => d.id === ld.dimension_id)!
        return {
          transaction_line_id: ld.transaction_line_id,
          dimension_id: ld.dimension_id,
          dimension_type: dim.type,
          dimension_name: dim.name,
        }
      })
      .sort((a, b) => {
        if (a.transaction_line_id !== b.transaction_line_id) return a.transaction_line_id.localeCompare(b.transaction_line_id)
        if (a.dimension_type !== b.dimension_type) return a.dimension_type.localeCompare(b.dimension_type)
        return a.dimension_name.localeCompare(b.dimension_name)
      })
  }

  createTransactionWithDimensions(data: {
    date: string
    description: string
    reference?: string
    journal_type?: string
    entries: JournalEntryInput[]
    dimensions?: { line_index: number; dimension_id: string }[]
  }): string {
    // Validate dimensions before creating
    if (data.dimensions) {
      for (const dimRef of data.dimensions) {
        const dim = this.dimensions.find((d) => d.id === dimRef.dimension_id)
        if (!dim) throw new Error(`Dimension not found: ${dimRef.dimension_id}`)
        if (dim.is_active !== 1) throw new Error(`Cannot use inactive dimension: ${dim.name}`)
        if (dimRef.line_index < 0 || dimRef.line_index >= data.entries.length) {
          throw new Error(`Invalid line_index: ${dimRef.line_index}`)
        }
      }
    }

    const txId = this.createTransaction(data)

    // Now attach dimensions to lines
    if (data.dimensions) {
      const txEntries = this.entries.filter((e) => e.transaction_id === txId)
      for (const dimRef of data.dimensions) {
        const lineId = txEntries[dimRef.line_index].id
        this.lineDimensions.push({
          id: this.genId(),
          transaction_line_id: lineId,
          dimension_id: dimRef.dimension_id,
        })
      }
    }

    return txId
  }

  /**
   * Filter entries by dimension filters.
   * Same type = OR, different types = AND.
   * Returns Set of entry IDs that match.
   */
  private filterEntriesByDimensions(entryIds: Set<string>, filters: DimensionFilter[]): Set<string> {
    if (!filters || filters.length === 0) return entryIds

    // Group filters by type
    const byType = new Map<string, string[]>()
    for (const f of filters) {
      const arr = byType.get(f.type) || []
      arr.push(f.dimension_id)
      byType.set(f.type, arr)
    }

    let result = entryIds
    // For each type, only keep entries that have at least one matching dimension (OR within type)
    // Then AND across types
    for (const [, dimIds] of byType) {
      const dimIdSet = new Set(dimIds)
      const matchingLineIds = new Set(
        this.lineDimensions
          .filter((ld) => dimIdSet.has(ld.dimension_id))
          .map((ld) => ld.transaction_line_id),
      )
      result = new Set([...result].filter((eid) => matchingLineIds.has(eid)))
    }

    return result
  }

  getTrialBalanceWithDimensions(asOfDate?: string, excludeJournalTypes?: string[], dimensionFilters?: DimensionFilter[]): TrialBalanceResult {
    if (!dimensionFilters || dimensionFilters.length === 0) {
      return this.getTrialBalance(asOfDate, excludeJournalTypes)
    }

    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const rows: AccountBalanceRow[] = []

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter((e) => e.account_id === acct.id)
      const filteredTxs = this.transactions.filter((t) => {
        if (asOfDate && t.date > asOfDate) return false
        if (excludeTypes.size > 0 && excludeTypes.has(t.journal_type)) return false
        return true
      })
      const txIds = new Set(filteredTxs.map((t) => t.id))
      relevantEntries = relevantEntries.filter((e) => txIds.has(e.transaction_id))

      // Apply dimension filter
      const entryIds = new Set(relevantEntries.map((e) => e.id))
      const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
      relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const net = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit

      if (net !== 0) {
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
          depth: acct.depth ?? 0,
          parent_id: acct.parent_id,
        })
      }
    }

    const total_debits = rows.reduce((s, r) => s + r.debit, 0)
    const total_credits = rows.reduce((s, r) => s + r.credit, 0)
    return { rows, total_debits, total_credits, is_balanced: total_debits === total_credits }
  }

  getIncomeStatementWithDimensions(startDate: string, endDate: string, excludeJournalTypes?: string[], basis?: string, dimensionFilters?: DimensionFilter[]): IncomeStatementResult {
    if (!dimensionFilters || dimensionFilters.length === 0) {
      return this.getIncomeStatement(startDate, endDate, excludeJournalTypes, basis)
    }

    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const cashAccountIds = new Set(this.accounts.filter((a) => a.is_cash_account === 1).map((a) => a.id))
    let filteredTxs = this.transactions
      .filter((t) => t.date >= startDate && t.date <= endDate && !excludeTypes.has(t.journal_type))
    if (basis === 'CASH') {
      filteredTxs = filteredTxs.filter((t) =>
        this.entries.some((e) => e.transaction_id === t.id && cashAccountIds.has(e.account_id))
      )
    }
    const txIds = new Set(filteredTxs.map((t) => t.id))

    const revenue: AccountBalanceItem[] = []
    const expenses: AccountBalanceItem[] = []

    for (const acct of this.getAccounts()) {
      if (acct.type !== 'REVENUE' && acct.type !== 'EXPENSE') continue
      let relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )

      // Apply dimension filter
      const entryIds = new Set(relevantEntries.map((e) => e.id))
      const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
      relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

  getBalanceSheetWithDimensions(asOfDate: string, dimensionFilters?: DimensionFilter[]): BalanceSheetResult {
    if (!dimensionFilters || dimensionFilters.length === 0) {
      return this.getBalanceSheet(asOfDate)
    }

    const txIds = new Set(
      this.transactions.filter((t) => t.date <= asOfDate).map((t) => t.id),
    )

    const assets: AccountBalanceItem[] = []
    const liabilities: AccountBalanceItem[] = []
    const equity: AccountBalanceItem[] = []
    let netIncome = 0

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )

      // Apply dimension filter
      const entryIds = new Set(relevantEntries.map((e) => e.id))
      const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
      relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

  // ── Phase 33: Contact Registry ──────────────────────────

  createContact(data: {
    contactType: string; name: string; companyName?: string; email?: string; phone?: string;
    addressLine1?: string; addressLine2?: string; city?: string; state?: string;
    postalCode?: string; country?: string; taxId?: string; notes?: string
  }): string {
    this.guardFileOpen()
    const validTypes = ['CUSTOMER', 'VENDOR', 'EMPLOYEE', 'OTHER']
    if (!validTypes.includes(data.contactType)) {
      throw new Error(`Invalid contact type: ${data.contactType}`)
    }
    const id = this.genId()
    const now = new Date().toISOString()
    this.contacts.push({
      id,
      type: data.contactType,
      name: data.name,
      company_name: data.companyName ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address_line1: data.addressLine1 ?? null,
      address_line2: data.addressLine2 ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      postal_code: data.postalCode ?? null,
      country: data.country ?? 'US',
      tax_id: data.taxId ?? null,
      notes: data.notes ?? null,
      is_active: 1,
      created_at: now,
      updated_at: now,
    })
    return id
  }

  updateContact(id: string, data: {
    name?: string; companyName?: string; email?: string; phone?: string;
    addressLine1?: string; addressLine2?: string; city?: string; state?: string;
    postalCode?: string; country?: string; taxId?: string; notes?: string
  }): void {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === id)
    if (!contact) throw new Error(`Contact not found: ${id}`)
    const now = new Date().toISOString()
    if (data.name !== undefined) contact.name = data.name
    if (data.companyName !== undefined) contact.company_name = data.companyName
    if (data.email !== undefined) contact.email = data.email
    if (data.phone !== undefined) contact.phone = data.phone
    if (data.addressLine1 !== undefined) contact.address_line1 = data.addressLine1
    if (data.addressLine2 !== undefined) contact.address_line2 = data.addressLine2
    if (data.city !== undefined) contact.city = data.city
    if (data.state !== undefined) contact.state = data.state
    if (data.postalCode !== undefined) contact.postal_code = data.postalCode
    if (data.country !== undefined) contact.country = data.country
    if (data.taxId !== undefined) contact.tax_id = data.taxId
    if (data.notes !== undefined) contact.notes = data.notes
    contact.updated_at = now
  }

  getContact(id: string): Contact {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === id)
    if (!contact) throw new Error(`Contact not found: ${id}`)
    return { ...contact }
  }

  listContacts(contactType?: string, search?: string, isActive?: number): Contact[] {
    this.guardFileOpen()
    let result = [...this.contacts]
    if (contactType) {
      result = result.filter((c) => c.type === contactType)
    }
    if (search) {
      const lower = search.toLowerCase()
      result = result.filter((c) =>
        c.name.toLowerCase().includes(lower) ||
        (c.company_name && c.company_name.toLowerCase().includes(lower)) ||
        (c.email && c.email.toLowerCase().includes(lower))
      )
    }
    if (isActive !== undefined) {
      result = result.filter((c) => c.is_active === isActive)
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  deactivateContact(id: string): void {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === id)
    if (!contact) throw new Error(`Contact not found: ${id}`)
    contact.is_active = 0
    contact.updated_at = new Date().toISOString()
  }

  reactivateContact(id: string): void {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === id)
    if (!contact) throw new Error(`Contact not found: ${id}`)
    contact.is_active = 1
    contact.updated_at = new Date().toISOString()
  }

  deleteContact(id: string): void {
    this.guardFileOpen()
    if (this.transactionContacts.some((tc) => tc.contact_id === id)) {
      throw new Error('Cannot delete contact with transaction references. Deactivate instead.')
    }
    const idx = this.contacts.findIndex((c) => c.id === id)
    if (idx === -1) throw new Error(`Contact not found: ${id}`)
    this.contacts.splice(idx, 1)
  }

  linkTransactionContact(transactionId: string, contactId: string): void {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === contactId)
    if (!contact) throw new Error(`Contact not found: ${contactId}`)
    const tx = this.transactions.find((t) => t.id === transactionId)
    if (!tx) throw new Error(`Transaction not found: ${transactionId}`)
    // Remove existing PRIMARY link
    this.transactionContacts = this.transactionContacts.filter(
      (tc) => !(tc.transaction_id === transactionId && tc.role === 'PRIMARY')
    )
    this.transactionContacts.push({
      id: this.genId(),
      transaction_id: transactionId,
      contact_id: contactId,
      role: 'PRIMARY',
    })
  }

  unlinkTransactionContact(transactionId: string): void {
    this.guardFileOpen()
    this.transactionContacts = this.transactionContacts.filter(
      (tc) => !(tc.transaction_id === transactionId && tc.role === 'PRIMARY')
    )
  }

  createTransactionWithContact(data: {
    date: string; description: string; reference?: string; journal_type?: string;
    entries: JournalEntryInput[]; contact_id?: string;
    dimensions?: { line_index: number; dimension_id: string }[]
  }): string {
    // Validate contact if provided
    if (data.contact_id) {
      const contact = this.contacts.find((c) => c.id === data.contact_id)
      if (!contact) throw new Error(`Contact not found: ${data.contact_id}`)
    }

    // Create transaction (with dimensions if provided)
    let txId: string
    if (data.dimensions) {
      txId = this.createTransactionWithDimensions(data)
    } else {
      txId = this.createTransaction(data)
    }

    // Link contact
    if (data.contact_id) {
      this.linkTransactionContact(txId, data.contact_id)
    }

    return txId
  }

  getContactLedger(contactId: string, startDate?: string, endDate?: string): ContactLedgerResult {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === contactId)
    if (!contact) throw new Error(`Contact not found: ${contactId}`)

    const linkedTxIds = new Set(
      this.transactionContacts.filter((tc) => tc.contact_id === contactId).map((tc) => tc.transaction_id)
    )

    let txs = this.transactions
      .filter((t) => linkedTxIds.has(t.id) && t.is_void === 0)
      .sort((a, b) => a.date.localeCompare(b.date) || a.created_at - b.created_at)

    if (startDate) txs = txs.filter((t) => t.date >= startDate)
    if (endDate) txs = txs.filter((t) => t.date <= endDate)

    let running = 0
    let totalDebits = 0
    let totalCredits = 0
    const entries: ContactLedgerEntry[] = []

    for (const tx of txs) {
      const txEntries = this.entries.filter((e) => e.transaction_id === tx.id)
      const debit = txEntries.reduce((s, e) => s + e.debit, 0)
      const credit = txEntries.reduce((s, e) => s + e.credit, 0)
      running += debit - credit
      totalDebits += debit
      totalCredits += credit
      entries.push({
        transaction_id: tx.id,
        date: tx.date,
        description: tx.description,
        reference: tx.reference,
        journal_type: tx.journal_type,
        total_debit: debit,
        total_credit: credit,
        running_balance: running,
      })
    }

    return {
      contact_id: contactId,
      contact_name: contact.name,
      entries,
      total_debits: totalDebits,
      total_credits: totalCredits,
      net_balance: running,
    }
  }

  getContactBalance(contactId: string, asOf?: string): number {
    this.guardFileOpen()
    const contact = this.contacts.find((c) => c.id === contactId)
    if (!contact) throw new Error(`Contact not found: ${contactId}`)

    const linkedTxIds = new Set(
      this.transactionContacts.filter((tc) => tc.contact_id === contactId).map((tc) => tc.transaction_id)
    )

    let txs = this.transactions.filter((t) => linkedTxIds.has(t.id) && t.is_void === 0)
    if (asOf) txs = txs.filter((t) => t.date <= asOf)

    const txIds = new Set(txs.map((t) => t.id))
    const relevantEntries = this.entries.filter((e) => txIds.has(e.transaction_id))
    const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
    const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
    return totalDebit - totalCredit
  }

  /** Filter transactions by contact — returns Set of transaction IDs linked to this contact */
  private filterTransactionsByContact(contactId: string): Set<string> {
    return new Set(
      this.transactionContacts.filter((tc) => tc.contact_id === contactId).map((tc) => tc.transaction_id)
    )
  }

  getTrialBalanceWithContact(asOfDate?: string, excludeJournalTypes?: string[], contactId?: string, dimensionFilters?: DimensionFilter[]): TrialBalanceResult {
    if (!contactId && (!dimensionFilters || dimensionFilters.length === 0)) {
      return this.getTrialBalance(asOfDate, excludeJournalTypes)
    }

    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const contactTxIds = contactId ? this.filterTransactionsByContact(contactId) : null
    const rows: AccountBalanceRow[] = []

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter((e) => e.account_id === acct.id)
      const filteredTxs = this.transactions.filter((t) => {
        if (asOfDate && t.date > asOfDate) return false
        if (excludeTypes.size > 0 && excludeTypes.has(t.journal_type)) return false
        if (contactTxIds && !contactTxIds.has(t.id)) return false
        return true
      })
      const txIds = new Set(filteredTxs.map((t) => t.id))
      relevantEntries = relevantEntries.filter((e) => txIds.has(e.transaction_id))

      // Apply dimension filter if provided
      if (dimensionFilters && dimensionFilters.length > 0) {
        const entryIds = new Set(relevantEntries.map((e) => e.id))
        const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
        relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))
      }

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const net = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit

      if (net !== 0) {
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
          depth: acct.depth ?? 0,
          parent_id: acct.parent_id,
        })
      }
    }

    const total_debits = rows.reduce((s, r) => s + r.debit, 0)
    const total_credits = rows.reduce((s, r) => s + r.credit, 0)
    return { rows, total_debits, total_credits, is_balanced: total_debits === total_credits }
  }

  getIncomeStatementWithContact(startDate: string, endDate: string, excludeJournalTypes?: string[], basis?: string, contactId?: string, dimensionFilters?: DimensionFilter[]): IncomeStatementResult {
    if (!contactId && (!dimensionFilters || dimensionFilters.length === 0)) {
      return this.getIncomeStatement(startDate, endDate, excludeJournalTypes, basis)
    }

    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const contactTxIds = contactId ? this.filterTransactionsByContact(contactId) : null
    const cashAccountIds = new Set(this.accounts.filter((a) => a.is_cash_account === 1).map((a) => a.id))
    let filteredTxs = this.transactions
      .filter((t) => t.date >= startDate && t.date <= endDate && !excludeTypes.has(t.journal_type))
    if (contactTxIds) {
      filteredTxs = filteredTxs.filter((t) => contactTxIds.has(t.id))
    }
    if (basis === 'CASH') {
      filteredTxs = filteredTxs.filter((t) =>
        this.entries.some((e) => e.transaction_id === t.id && cashAccountIds.has(e.account_id))
      )
    }
    const txIds = new Set(filteredTxs.map((t) => t.id))

    const revenue: AccountBalanceItem[] = []
    const expenses: AccountBalanceItem[] = []

    for (const acct of this.getAccounts()) {
      if (acct.type !== 'REVENUE' && acct.type !== 'EXPENSE') continue
      let relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )

      if (dimensionFilters && dimensionFilters.length > 0) {
        const entryIds = new Set(relevantEntries.map((e) => e.id))
        const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
        relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))
      }

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type) ? totalDebit - totalCredit : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

  getBalanceSheetWithContact(asOfDate: string, contactId?: string, dimensionFilters?: DimensionFilter[]): BalanceSheetResult {
    if (!contactId && (!dimensionFilters || dimensionFilters.length === 0)) {
      return this.getBalanceSheet(asOfDate)
    }

    const contactTxIds = contactId ? this.filterTransactionsByContact(contactId) : null
    let filteredTxs = this.transactions.filter((t) => t.date <= asOfDate)
    if (contactTxIds) {
      filteredTxs = filteredTxs.filter((t) => contactTxIds.has(t.id))
    }
    const txIds = new Set(filteredTxs.map((t) => t.id))

    const assets: AccountBalanceItem[] = []
    const liabilities: AccountBalanceItem[] = []
    const equity: AccountBalanceItem[] = []
    let netIncome = 0

    for (const acct of this.getAccounts()) {
      let relevantEntries = this.entries.filter(
        (e) => e.account_id === acct.id && txIds.has(e.transaction_id),
      )

      if (dimensionFilters && dimensionFilters.length > 0) {
        const entryIds = new Set(relevantEntries.map((e) => e.id))
        const filtered = this.filterEntriesByDimensions(entryIds, dimensionFilters)
        relevantEntries = relevantEntries.filter((e) => filtered.has(e.id))
      }

      const totalDebit = relevantEntries.reduce((s, e) => s + e.debit, 0)
      const totalCredit = relevantEntries.reduce((s, e) => s + e.credit, 0)
      const balance = isDebitNormal(acct.type)
        ? totalDebit - totalCredit
        : totalCredit - totalDebit
      if (balance === 0) continue

      const item = { account_id: acct.id, code: acct.code, name: acct.name, balance, depth: acct.depth ?? 0, parent_id: acct.parent_id }
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

  // ── Phase 34: General Ledger ───────────────────────────

  getGeneralLedger(filters?: GLFilters): GLAccountGroup[] {
    this.guardFileOpen()

    const accountId = filters?.account_id
    const accountIds = filters?.account_ids
    const startDate = filters?.start_date
    const endDate = filters?.end_date
    const dimensionFilters = filters?.dimension_filters
    const contactId = filters?.contact_id
    const journalType = filters?.journal_type
    const includeVoid = filters?.include_void ?? false

    // Determine which accounts to include
    let targetAccounts = this.accounts.filter((a) => a.is_active === 1)
    if (accountId) {
      targetAccounts = targetAccounts.filter((a) => a.id === accountId)
    } else if (accountIds && accountIds.length > 0) {
      const idSet = new Set(accountIds)
      targetAccounts = targetAccounts.filter((a) => idSet.has(a.id))
    }
    targetAccounts.sort((a, b) => a.code.localeCompare(b.code))

    // Build set of contact-linked transaction IDs if filtering by contact
    const contactTxIds = contactId
      ? new Set(this.transactionContacts.filter((tc) => tc.contact_id === contactId).map((tc) => tc.transaction_id))
      : null

    const result: GLAccountGroup[] = []

    for (const acct of targetAccounts) {
      const isDebitNorm = isDebitNormal(acct.type)

      // Get all entries for this account
      let allEntries = this.entries.filter((e) => e.account_id === acct.id)

      // Compute opening balance: sum of entries BEFORE start_date
      let openingBalance = 0
      if (startDate) {
        const priorEntries = allEntries.filter((e) => {
          const tx = this.transactions.find((t) => t.id === e.transaction_id)
          if (!tx) return false
          if (tx.is_void && !includeVoid) return false
          return tx.date < startDate
        })
        const priorDebit = priorEntries.reduce((s, e) => s + e.debit, 0)
        const priorCredit = priorEntries.reduce((s, e) => s + e.credit, 0)
        openingBalance = isDebitNorm ? priorDebit - priorCredit : priorCredit - priorDebit
      }

      // Filter entries by date range, void, journal type, contact
      const filteredEntries = allEntries.filter((e) => {
        const tx = this.transactions.find((t) => t.id === e.transaction_id)
        if (!tx) return false
        if (!includeVoid && tx.is_void) return false
        if (startDate && tx.date < startDate) return false
        if (endDate && tx.date > endDate) return false
        if (journalType && tx.journal_type !== journalType) return false
        if (contactTxIds && !contactTxIds.has(tx.id)) return false
        return true
      })

      // Apply dimension filter if provided
      let finalEntries = filteredEntries
      if (dimensionFilters && dimensionFilters.length > 0) {
        const entryIds = new Set(filteredEntries.map((e) => e.id))
        const matchedIds = this.filterEntriesByDimensions(entryIds, dimensionFilters)
        finalEntries = filteredEntries.filter((e) => matchedIds.has(e.id))
      }

      // Sort by date then by transaction created_at
      finalEntries.sort((a, b) => {
        const txA = this.transactions.find((t) => t.id === a.transaction_id)!
        const txB = this.transactions.find((t) => t.id === b.transaction_id)!
        const dateCmp = txA.date.localeCompare(txB.date)
        if (dateCmp !== 0) return dateCmp
        return txA.created_at - txB.created_at
      })

      // Build GL entries with running balance
      let running = openingBalance
      let totalDebits = 0
      let totalCredits = 0
      const glEntries: GLEntry[] = []

      for (const entry of finalEntries) {
        const tx = this.transactions.find((t) => t.id === entry.transaction_id)!

        // Compute running balance
        if (isDebitNorm) {
          running += entry.debit - entry.credit
        } else {
          running += entry.credit - entry.debit
        }
        totalDebits += entry.debit
        totalCredits += entry.credit

        // Get contact name if linked
        const tcLink = this.transactionContacts.find((tc) => tc.transaction_id === tx.id && tc.role === 'PRIMARY')
        const contactName = tcLink ? (this.contacts.find((c) => c.id === tcLink.contact_id)?.name ?? null) : null

        // Get dimensions for this line
        const dims: GLEntryDimension[] = this.lineDimensions
          .filter((ld) => ld.transaction_line_id === entry.id)
          .map((ld) => {
            const dim = this.dimensions.find((d) => d.id === ld.dimension_id)
            return dim ? { type: dim.type, name: dim.name } : null
          })
          .filter((d): d is GLEntryDimension => d !== null)

        glEntries.push({
          transaction_id: tx.id,
          transaction_line_id: entry.id,
          date: tx.date,
          reference: tx.reference,
          description: entry.memo || tx.description,
          debit: entry.debit,
          credit: entry.credit,
          running_balance: running,
          contact_name: contactName,
          dimensions: dims,
          is_void: tx.is_void === 1,
          journal_type: tx.journal_type,
        })
      }

      // Only include account if it has entries or a non-zero opening balance
      if (glEntries.length > 0 || openingBalance !== 0) {
        result.push({
          account: {
            id: acct.id,
            code: acct.code,
            name: acct.name,
            type: acct.type,
            normal_balance: acct.normal_balance,
          },
          opening_balance: openingBalance,
          entries: glEntries,
          closing_balance: running,
          total_debits: totalDebits,
          total_credits: totalCredits,
        })
      }
    }

    return result
  }

  // ── Phase 35: Document Attachments ─────────────────────

  private validateEntity(entityType: string, entityId: string): void {
    if (entityType === 'TRANSACTION') {
      if (!this.transactions.find((t) => t.id === entityId)) {
        throw new Error(`Transaction not found: ${entityId}`)
      }
    } else if (entityType === 'CONTACT') {
      if (!this.contacts.find((c) => c.id === entityId)) {
        throw new Error(`Contact not found: ${entityId}`)
      }
    } else if (entityType === 'ACCOUNT') {
      if (!this.accounts.find((a) => a.id === entityId)) {
        throw new Error(`Account not found: ${entityId}`)
      }
    } else {
      throw new Error(`Invalid entity_type: ${entityType}`)
    }
  }

  private guessMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      csv: 'text/csv',
      txt: 'text/plain',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
    return mimeMap[ext] ?? 'application/octet-stream'
  }

  attachDocument(entityType: string, entityId: string, _filePath: string, filename: string, description?: string, fileSize?: number): string {
    this.guardFileOpen()
    this.validateEntity(entityType, entityId)

    const id = this.genId()
    const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
    const storedFilename = `${id.replace('mock-', '')}${ext}`

    this.documents.push({
      id,
      entity_type: entityType,
      entity_id: entityId,
      filename,
      stored_filename: storedFilename,
      mime_type: this.guessMimeType(filename),
      file_size_bytes: fileSize ?? 1024,
      description: description ?? null,
      uploaded_at: new Date().toISOString(),
      uploaded_by: 'user',
    })

    return id
  }

  listDocuments(entityType: string, entityId: string): DocumentMeta[] {
    this.guardFileOpen()
    return this.documents
      .filter((d) => d.entity_type === entityType && d.entity_id === entityId)
      .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))
  }

  getDocumentPath(documentId: string): string {
    this.guardFileOpen()
    const doc = this.documents.find((d) => d.id === documentId)
    if (!doc) throw new Error(`Document not found: ${documentId}`)
    return `/fake/documents/2025/01/${doc.stored_filename}`
  }

  deleteDocument(documentId: string): void {
    this.guardFileOpen()
    const idx = this.documents.findIndex((d) => d.id === documentId)
    if (idx === -1) throw new Error(`Document not found: ${documentId}`)
    this.documents.splice(idx, 1)
  }

  getDocumentCount(entityType: string, entityId: string): number {
    this.guardFileOpen()
    return this.documents.filter((d) => d.entity_type === entityType && d.entity_id === entityId).length
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
  { code: '3500', name: 'Opening Balance Equity', type: 'EQUITY' },
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
