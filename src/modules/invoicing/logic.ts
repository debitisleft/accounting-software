// Invoicing module business logic.
//
// This file implements the invoicing operations as a pure TypeScript class
// that depends on a `ModuleSdk` interface. The interface mirrors what the
// browser-side sdk.js shim exposes, so the same code can run inside the
// iframe (when wired through postMessage) AND in node tests (when wired
// through MockApi). Importantly, this class has NO direct access to the
// kernel — every read/write goes through `sdk.*`.

export interface ModuleSdkContact {
  id: string
  name: string
  type: string
}

export interface ModuleSdkAccount {
  id: string
  code: string
  name: string
  type: string
}

export interface ModuleJournalEntry {
  account_id: string
  debit: number
  credit: number
  memo?: string
}

/// The minimum SDK surface the invoicing module needs. Tests construct a
/// concrete implementation backed by MockApi; the real iframe wires it up
/// through window.parent.postMessage.
export interface ModuleSdk {
  ledger: {
    createTransaction(input: {
      date: string
      description: string
      reference?: string
      entries: ModuleJournalEntry[]
    }): Promise<string> | string
    voidTransaction(txId: string): Promise<string> | string
  }
  accounts: {
    getChartOfAccounts(): Promise<ModuleSdkAccount[]> | ModuleSdkAccount[]
    create(data: { code: string; name: string; acctType: string }): Promise<string> | string
  }
  contacts: {
    list(filters?: { contact_type?: string }): Promise<ModuleSdkContact[]> | ModuleSdkContact[]
  }
  storage: {
    createTable(name: string, columnsSql: string): Promise<void> | void
    insert(table: string, row: Record<string, unknown>): Promise<number> | number
    query(table: string, filters?: { column: string; op: string; value: unknown }[]):
      Promise<Record<string, unknown>[]> | Record<string, unknown>[]
    update(table: string, id: unknown, fields: Record<string, unknown>): Promise<number> | number
    delete(table: string, id: unknown): Promise<number> | number
  }
  ui: {
    registerNavItem(label: string, icon?: string): Promise<void> | void
    registerSettingsPane(label: string): Promise<void> | void
    registerTransactionAction(label: string, actionId: string): Promise<void> | void
  }
}

export interface InvoiceLineInput {
  description: string
  quantity: number
  unit_price: number // cents
  account_id: string // revenue account
}

export interface CreateInvoiceInput {
  customer_contact_id: string
  issue_date: string
  due_date: string
  terms?: string
  notes?: string
  lines: InvoiceLineInput[]
  tax_amount?: number
}

export interface InvoiceRow {
  id: string
  invoice_number: string
  customer_contact_id: string
  status: string
  issue_date: string
  due_date: string
  terms: string
  subtotal: number
  tax_amount: number
  total: number
  amount_paid: number
  balance_due: number
  notes: string | null
  transaction_id: string | null
  payment_transaction_ids: string
  created_at: string
  updated_at: string
}

export interface AgingBucketsForCustomer {
  customer_contact_id: string
  current: number
  d_1_30: number
  d_31_60: number
  d_61_90: number
  d_90_plus: number
  total: number
}

export interface AgingReport {
  as_of: string
  buckets: AgingBucketsForCustomer[]
  totals: { current: number; d_1_30: number; d_31_60: number; d_61_90: number; d_90_plus: number; total: number }
}

const MIGRATION_001_INIT = `
CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_number TEXT UNIQUE NOT NULL,
    customer_contact_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    issue_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    terms TEXT NOT NULL DEFAULT 'Net 30',
    subtotal INTEGER NOT NULL DEFAULT 0,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    amount_paid INTEGER NOT NULL DEFAULT 0,
    balance_due INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    transaction_id TEXT,
    payment_transaction_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
)
`

export class InvoicingModule {
  /// Stable column lists used to create the storage tables on init.
  static readonly TABLE_INVOICES_COLUMNS =
    "id TEXT, invoice_number TEXT, customer_contact_id TEXT, status TEXT, " +
    "issue_date TEXT, due_date TEXT, terms TEXT, subtotal INTEGER, tax_amount INTEGER, " +
    "total INTEGER, amount_paid INTEGER, balance_due INTEGER, notes TEXT, " +
    "transaction_id TEXT, payment_transaction_ids TEXT, created_at TEXT, updated_at TEXT"

  static readonly TABLE_LINES_COLUMNS =
    "id TEXT, invoice_id TEXT, description TEXT, quantity REAL, " +
    "unit_price INTEGER, amount INTEGER, account_id TEXT, sort_order INTEGER"

  static readonly TABLE_SETTINGS_COLUMNS = "key TEXT, value TEXT"

  constructor(public readonly sdk: ModuleSdk) {}

  /// Phase 9 in the install flow: register tables and UI extensions, set up
  /// the default AR account if missing.
  async init(): Promise<void> {
    await this.sdk.storage.createTable('invoices', InvoicingModule.TABLE_INVOICES_COLUMNS)
    await this.sdk.storage.createTable('invoice_lines', InvoicingModule.TABLE_LINES_COLUMNS)
    await this.sdk.storage.createTable('invoice_settings', InvoicingModule.TABLE_SETTINGS_COLUMNS)

    // Seed defaults if not already there
    const existing = await this.sdk.storage.query('invoice_settings')
    const seenKeys = new Set(existing.map((r) => r.key as string))
    const defaults: Record<string, string> = {
      next_invoice_number: '1',
      default_terms: 'Net 30',
      default_ar_account_id: '',
      company_name: '',
      company_address: '',
      payment_instructions: '',
    }
    for (const [k, v] of Object.entries(defaults)) {
      if (!seenKeys.has(k)) {
        await this.sdk.storage.insert('invoice_settings', { key: k, value: v })
      }
    }

    // Make sure an AR account exists; create code 1100 if missing
    const accounts = await this.sdk.accounts.getChartOfAccounts()
    let ar = accounts.find((a) => a.code === '1100')
    if (!ar) {
      const id = await this.sdk.accounts.create({
        code: '1100',
        name: 'Accounts Receivable',
        acctType: 'ASSET',
      })
      ar = { id, code: '1100', name: 'Accounts Receivable', type: 'ASSET' }
    }
    // Persist the AR account id in invoice_settings
    const settingRow = (await this.sdk.storage.query('invoice_settings', [
      { column: 'key', op: '=', value: 'default_ar_account_id' },
    ]))[0]
    if (settingRow && settingRow.value !== ar.id) {
      await this.sdk.storage.update('invoice_settings', settingRow.id, { value: ar.id })
    }

    // UI extensions
    await this.sdk.ui.registerNavItem('Invoices', 'receipt')
    await this.sdk.ui.registerSettingsPane('Invoicing Settings')
    await this.sdk.ui.registerTransactionAction('Create Invoice from Transaction', 'create_invoice_from_tx')
  }

  private async getSetting(key: string): Promise<string | null> {
    const row = (await this.sdk.storage.query('invoice_settings', [
      { column: 'key', op: '=', value: key },
    ]))[0]
    return row ? (row.value as string) : null
  }

  private async setSetting(key: string, value: string): Promise<void> {
    const row = (await this.sdk.storage.query('invoice_settings', [
      { column: 'key', op: '=', value: key },
    ]))[0]
    if (row) {
      await this.sdk.storage.update('invoice_settings', row.id, { value })
    } else {
      await this.sdk.storage.insert('invoice_settings', { key, value })
    }
  }

  private async nextInvoiceNumber(): Promise<string> {
    const current = parseInt((await this.getSetting('next_invoice_number')) ?? '1', 10)
    const next = `INV-${String(current).padStart(4, '0')}`
    await this.setSetting('next_invoice_number', String(current + 1))
    return next
  }

  /// Create a draft invoice. Calculates totals from lines.
  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceRow> {
    if (input.lines.length === 0) throw new Error('Invoice must have at least one line')
    for (const line of input.lines) {
      if (line.quantity <= 0) throw new Error('Line quantity must be positive')
      if (line.unit_price < 0) throw new Error('Line unit_price cannot be negative')
    }

    const subtotal = input.lines.reduce(
      (sum, l) => sum + Math.round(l.quantity * l.unit_price),
      0,
    )
    const taxAmount = input.tax_amount ?? 0
    const total = subtotal + taxAmount
    const id = `inv-${Math.random().toString(36).slice(2, 10)}`
    const now = new Date().toISOString()
    const invoiceNumber = await this.nextInvoiceNumber()

    const row: InvoiceRow = {
      id,
      invoice_number: invoiceNumber,
      customer_contact_id: input.customer_contact_id,
      status: 'draft',
      issue_date: input.issue_date,
      due_date: input.due_date,
      terms: input.terms ?? 'Net 30',
      subtotal,
      tax_amount: taxAmount,
      total,
      amount_paid: 0,
      balance_due: total,
      notes: input.notes ?? null,
      transaction_id: null,
      payment_transaction_ids: '[]',
      created_at: now,
      updated_at: now,
    }
    await this.sdk.storage.insert('invoices', row as unknown as Record<string, unknown>)

    let sortOrder = 0
    for (const line of input.lines) {
      await this.sdk.storage.insert('invoice_lines', {
        id: `line-${Math.random().toString(36).slice(2, 10)}`,
        invoice_id: id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: Math.round(line.quantity * line.unit_price),
        account_id: line.account_id,
        sort_order: sortOrder++,
      })
    }
    return row
  }

  async getInvoice(id: string): Promise<InvoiceRow | null> {
    const rows = await this.sdk.storage.query('invoices', [
      { column: 'id', op: '=', value: id },
    ])
    return (rows[0] as unknown as InvoiceRow) ?? null
  }

  async listInvoices(): Promise<InvoiceRow[]> {
    const rows = await this.sdk.storage.query('invoices')
    return rows as unknown as InvoiceRow[]
  }

  async listInvoiceLines(invoiceId: string): Promise<Record<string, unknown>[]> {
    return this.sdk.storage.query('invoice_lines', [
      { column: 'invoice_id', op: '=', value: invoiceId },
    ])
  }

  /// Move an invoice from draft to sent and post the AR transaction.
  /// Debits AR, credits each line's revenue account.
  async finalizeInvoice(id: string): Promise<InvoiceRow> {
    const inv = await this.getInvoice(id)
    if (!inv) throw new Error(`Invoice not found: ${id}`)
    if (inv.status !== 'draft') throw new Error(`Invoice is already ${inv.status}, cannot finalize`)

    const arAccountId = await this.getSetting('default_ar_account_id')
    if (!arAccountId) throw new Error('No AR account configured')
    const lines = await this.listInvoiceLines(id)

    const entries: ModuleJournalEntry[] = [
      { account_id: arAccountId, debit: inv.total, credit: 0, memo: inv.invoice_number },
    ]
    for (const line of lines) {
      entries.push({
        account_id: line.account_id as string,
        debit: 0,
        credit: line.amount as number,
        memo: line.description as string,
      })
    }
    const txId = await this.sdk.ledger.createTransaction({
      date: inv.issue_date,
      description: `Invoice ${inv.invoice_number}`,
      reference: inv.invoice_number,
      entries,
    })

    await this.sdk.storage.update('invoices', id, {
      status: 'sent',
      transaction_id: txId,
      updated_at: new Date().toISOString(),
    })
    return (await this.getInvoice(id))!
  }

  /// Record a payment against an invoice. Posts a debit to cash, credit to AR.
  async recordPayment(input: {
    invoice_id: string
    amount: number
    payment_date: string
    cash_account_id: string
  }): Promise<InvoiceRow> {
    const inv = await this.getInvoice(input.invoice_id)
    if (!inv) throw new Error(`Invoice not found: ${input.invoice_id}`)
    if (inv.status === 'void') throw new Error('Cannot pay a voided invoice')
    if (inv.status === 'draft') throw new Error('Cannot pay a draft invoice — finalize first')
    if (input.amount <= 0) throw new Error('Payment amount must be positive')
    if (input.amount > inv.balance_due) throw new Error('Payment exceeds balance due')

    const arAccountId = await this.getSetting('default_ar_account_id')
    if (!arAccountId) throw new Error('No AR account configured')

    const txId = await this.sdk.ledger.createTransaction({
      date: input.payment_date,
      description: `Payment for ${inv.invoice_number}`,
      reference: inv.invoice_number,
      entries: [
        { account_id: input.cash_account_id, debit: input.amount, credit: 0 },
        { account_id: arAccountId, debit: 0, credit: input.amount },
      ],
    })

    const newPaid = inv.amount_paid + input.amount
    const newBalance = inv.total - newPaid
    const newStatus = newBalance === 0 ? 'paid' : 'partial'
    const paymentIds = JSON.parse(inv.payment_transaction_ids) as string[]
    paymentIds.push(txId)

    await this.sdk.storage.update('invoices', input.invoice_id, {
      amount_paid: newPaid,
      balance_due: newBalance,
      status: newStatus,
      payment_transaction_ids: JSON.stringify(paymentIds),
      updated_at: new Date().toISOString(),
    })
    return (await this.getInvoice(input.invoice_id))!
  }

  /// Void an invoice. Voids the AR transaction (if posted) and marks the
  /// invoice. Refuses to void if there are payments — those would have to
  /// be voided first by the user.
  async voidInvoice(id: string): Promise<InvoiceRow> {
    const inv = await this.getInvoice(id)
    if (!inv) throw new Error(`Invoice not found: ${id}`)
    if (inv.status === 'void') throw new Error('Invoice is already voided')
    const paymentIds = JSON.parse(inv.payment_transaction_ids) as string[]
    if (paymentIds.length > 0) {
      throw new Error('Cannot void an invoice with payments — void the payments first')
    }
    if (inv.transaction_id) {
      await this.sdk.ledger.voidTransaction(inv.transaction_id)
    }
    await this.sdk.storage.update('invoices', id, {
      status: 'void',
      updated_at: new Date().toISOString(),
    })
    return (await this.getInvoice(id))!
  }

  /// AR aging report. Buckets unpaid invoices by days-past-due relative to
  /// `as_of_date`.
  async getArAgingReport(as_of_date: string): Promise<AgingReport> {
    const invoices = await this.listInvoices()
    const unpaid = invoices.filter((i) => i.balance_due > 0 && i.status !== 'void' && i.status !== 'draft')
    const customerBuckets = new Map<string, AgingBucketsForCustomer>()

    for (const inv of unpaid) {
      const due = new Date(inv.due_date)
      const asOf = new Date(as_of_date)
      const daysPastDue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000)
      let bucket = customerBuckets.get(inv.customer_contact_id)
      if (!bucket) {
        bucket = {
          customer_contact_id: inv.customer_contact_id,
          current: 0, d_1_30: 0, d_31_60: 0, d_61_90: 0, d_90_plus: 0, total: 0,
        }
        customerBuckets.set(inv.customer_contact_id, bucket)
      }
      const amt = inv.balance_due
      if (daysPastDue <= 0) bucket.current += amt
      else if (daysPastDue <= 30) bucket.d_1_30 += amt
      else if (daysPastDue <= 60) bucket.d_31_60 += amt
      else if (daysPastDue <= 90) bucket.d_61_90 += amt
      else bucket.d_90_plus += amt
      bucket.total += amt
    }

    const totals = { current: 0, d_1_30: 0, d_31_60: 0, d_61_90: 0, d_90_plus: 0, total: 0 }
    const buckets = Array.from(customerBuckets.values())
    for (const b of buckets) {
      totals.current += b.current
      totals.d_1_30 += b.d_1_30
      totals.d_31_60 += b.d_31_60
      totals.d_61_90 += b.d_61_90
      totals.d_90_plus += b.d_90_plus
      totals.total += b.total
    }

    return { as_of: as_of_date, buckets, totals }
  }
}

export { MIGRATION_001_INIT }
