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

  getIncomeStatement(startDate: string, endDate: string, excludeJournalTypes?: string[]): IncomeStatementResult {
    const excludeTypes = new Set(excludeJournalTypes ?? [])
    const txIds = new Set(
      this.transactions
        .filter((t) => t.date >= startDate && t.date <= endDate && !excludeTypes.has(t.journal_type))
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

  updateTransactionLines(transactionId: string, newEntries: JournalEntryInput[]): void {
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

    const oldEntries = this.entries.filter((e) => e.transaction_id === transactionId)
    const oldStr = oldEntries.map((e) => `${e.account_id}:D${e.debit}C${e.credit}`).join(';')
    const newStr = newEntries.map((e) => `${e.account_id}:D${e.debit}C${e.credit}`).join(';')

    this.entries = this.entries.filter((e) => e.transaction_id !== transactionId)
    for (const entry of newEntries) {
      this.entries.push({
        id: this.genId(),
        transaction_id: transactionId,
        account_id: entry.account_id,
        debit: entry.debit,
        credit: entry.credit,
        memo: entry.memo ?? null,
      })
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

  updateAccount(accountId: string, data: { name?: string; code?: string }): void {
    const acct = this.accounts.find((a) => a.id === accountId)
    if (!acct) throw new Error(`Account not found: ${accountId}`)

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

    if (entries.length === 0) throw new Error('No revenue or expense balances to close')

    // Create CLOSING transaction directly (bypass system type restriction)
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
