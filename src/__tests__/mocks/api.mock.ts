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
  LockedPeriod,
} from '../../lib/api'

interface StoredTransaction {
  id: string
  date: string
  description: string
  reference: string | null
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
  private nextId = 1
  private auditSeq = 0

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

    const originalEntries = this.entries.filter((e) => e.transaction_id === transactionId)

    // Create reversing transaction
    const voidTxId = this.genId()
    this.transactions.push({
      id: voidTxId,
      date: tx.date,
      description: `VOID: ${tx.description}`,
      reference: 'VOID',
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
