import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'
import { InvoicingModule, type ModuleSdk } from '../modules/invoicing/logic'
import invoicingManifest from '../modules/invoicing/module.json'

const INVOICING_ID = 'com.bookkeeping.invoicing'

const stagedFiles: Record<string, string> = {
  'module.json': JSON.stringify(invoicingManifest),
  'frontend/index.html': '<html>invoicing</html>',
  'frontend/bundle.js': '// invoicing entry',
  'frontend/style.css': 'body{}',
  'migrations/001_init.sql': '-- migration',
}

describe('Phase 46 — Invoicing & AR Module', () => {
  let mock: MockApi
  let sdk: ModuleSdk
  let invoicing: InvoicingModule

  function findAccount(code: string) {
    const a = mock.getAccounts().find((x) => x.code === code)
    if (!a) throw new Error(`Account ${code} not found`)
    return a
  }

  function makeCustomer(name: string) {
    return mock.createContact({ contactType: 'CUSTOMER', name })
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/InvoicingCo', 'Invoicing Co')
    mock.stagePackage('/pkg/invoicing.zip', invoicingManifest as Record<string, unknown>, stagedFiles)
    const installResult = mock.installModuleFromZip('/pkg/invoicing.zip')
    if (!installResult.success) {
      throw new Error(`install failed: ${installResult.errors.join(', ')}`)
    }
    sdk = mock.makeSdkForModule(INVOICING_ID) as unknown as ModuleSdk
    invoicing = new InvoicingModule(sdk)
  })

  describe('Install + init', () => {
    it('installs through install_module_from_zip with all 10 steps', () => {
      // Already installed in beforeEach — re-attempt should now conflict
      mock.stagePackage('/pkg/invoicing-again.zip', invoicingManifest as Record<string, unknown>, stagedFiles)
      const r = mock.installModuleFromZip('/pkg/invoicing-again.zip')
      expect(r.success).toBe(false)
      expect(r.errors.join(' ')).toMatch(/already installed/)
    })

    it('init creates the storage tables and seeds default settings', async () => {
      await invoicing.init()
      // The 3 tables now exist; querying them returns rows (settings are seeded)
      const settings = await sdk.storage.query('invoice_settings')
      expect(settings.length).toBeGreaterThanOrEqual(6)
      const keys = settings.map((r) => r.key)
      expect(keys).toContain('next_invoice_number')
      expect(keys).toContain('default_terms')
      expect(keys).toContain('default_ar_account_id')
    })

    it('init sets default AR account from existing chart of accounts', async () => {
      await invoicing.init()
      const setting = (await sdk.storage.query('invoice_settings', [
        { column: 'key', op: '=', value: 'default_ar_account_id' },
      ]))[0]
      const ar = findAccount('1100')
      expect(setting.value).toBe(ar.id)
    })

    it('init registers the Invoices nav item via the UI extension API', async () => {
      await invoicing.init()
      const items = mock.getNavItems()
      const invoicesItem = items.find((i) => i.module_id === INVOICING_ID && i.label === 'Invoices')
      expect(invoicesItem).toBeTruthy()
    })
  })

  describe('Invoice CRUD via SDK storage', () => {
    beforeEach(async () => {
      await invoicing.init()
    })

    it('createInvoice stores the invoice + lines through the storage API', async () => {
      const customerId = makeCustomer('Acme Corp')
      const sales = findAccount('4000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId,
        issue_date: '2026-04-01',
        due_date: '2026-05-01',
        terms: 'Net 30',
        lines: [
          { description: 'Consulting', quantity: 10, unit_price: 15000, account_id: sales.id },
          { description: 'Setup fee', quantity: 1, unit_price: 50000, account_id: sales.id },
        ],
      })
      expect(inv.invoice_number).toBe('INV-0001')
      expect(inv.subtotal).toBe(200000) // 10 * 15000 + 1 * 50000
      expect(inv.total).toBe(200000)
      expect(inv.balance_due).toBe(200000)
      expect(inv.status).toBe('draft')

      const lines = await invoicing.listInvoiceLines(inv.id)
      expect(lines).toHaveLength(2)
    })

    it('invoice_number auto-increments per invoice', async () => {
      const customerId = makeCustomer('A')
      const sales = findAccount('4000')
      const a = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'x', quantity: 1, unit_price: 1000, account_id: sales.id }],
      })
      const b = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-02', due_date: '2026-05-02',
        lines: [{ description: 'y', quantity: 1, unit_price: 2000, account_id: sales.id }],
      })
      expect(a.invoice_number).toBe('INV-0001')
      expect(b.invoice_number).toBe('INV-0002')
    })

    it('multi-line invoice totals correctly with fractional quantity', async () => {
      const customerId = makeCustomer('A')
      const sales = findAccount('4000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [
          { description: '2.5 hrs', quantity: 2.5, unit_price: 12000, account_id: sales.id },
          { description: '0.75 hrs', quantity: 0.75, unit_price: 8000, account_id: sales.id },
        ],
      })
      // 2.5 * 12000 = 30000, 0.75 * 8000 = 6000, total = 36000
      expect(inv.subtotal).toBe(36000)
      expect(inv.total).toBe(36000)
    })
  })

  describe('Finalize → AR posting via SDK', () => {
    beforeEach(async () => {
      await invoicing.init()
    })

    it('finalize creates a balanced AR transaction (debit AR, credit revenue)', async () => {
      const customerId = makeCustomer('Acme')
      const sales = findAccount('4000')
      const ar = findAccount('1100')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'work', quantity: 1, unit_price: 100000, account_id: sales.id }],
      })
      const finalized = await invoicing.finalizeInvoice(inv.id)
      expect(finalized.status).toBe('sent')
      expect(finalized.transaction_id).toBeTruthy()

      // Verify the kernel transaction posted via SDK
      const txEntries = mock.entries.filter((e) => e.transaction_id === finalized.transaction_id)
      expect(txEntries).toHaveLength(2)
      const arEntry = txEntries.find((e) => e.account_id === ar.id)!
      const salesEntry = txEntries.find((e) => e.account_id === sales.id)!
      expect(arEntry.debit).toBe(100000)
      expect(arEntry.credit).toBe(0)
      expect(salesEntry.credit).toBe(100000)
      expect(salesEntry.debit).toBe(0)
    })

    it('finalize twice on the same invoice is rejected', async () => {
      const customerId = makeCustomer('A')
      const sales = findAccount('4000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'x', quantity: 1, unit_price: 1000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(inv.id)
      await expect(invoicing.finalizeInvoice(inv.id)).rejects.toThrow(/already sent/)
    })
  })

  describe('Payments via SDK', () => {
    let invoiceId: string

    beforeEach(async () => {
      await invoicing.init()
      const customerId = makeCustomer('Acme')
      const sales = findAccount('4000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'work', quantity: 1, unit_price: 100000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(inv.id)
      invoiceId = inv.id
    })

    it('full payment marks the invoice paid and posts a balanced cash/AR tx', async () => {
      const cash = findAccount('1000')
      const ar = findAccount('1100')
      const updated = await invoicing.recordPayment({
        invoice_id: invoiceId,
        amount: 100000,
        payment_date: '2026-04-15',
        cash_account_id: cash.id,
      })
      expect(updated.status).toBe('paid')
      expect(updated.amount_paid).toBe(100000)
      expect(updated.balance_due).toBe(0)

      const paymentIds = JSON.parse(updated.payment_transaction_ids) as string[]
      expect(paymentIds).toHaveLength(1)
      const payEntries = mock.entries.filter((e) => e.transaction_id === paymentIds[0])
      expect(payEntries).toHaveLength(2)
      expect(payEntries.find((e) => e.account_id === cash.id)!.debit).toBe(100000)
      expect(payEntries.find((e) => e.account_id === ar.id)!.credit).toBe(100000)
    })

    it('partial payment marks the invoice partial', async () => {
      const cash = findAccount('1000')
      const updated = await invoicing.recordPayment({
        invoice_id: invoiceId,
        amount: 30000,
        payment_date: '2026-04-15',
        cash_account_id: cash.id,
      })
      expect(updated.status).toBe('partial')
      expect(updated.amount_paid).toBe(30000)
      expect(updated.balance_due).toBe(70000)
    })

    it('payment exceeding balance is rejected', async () => {
      const cash = findAccount('1000')
      await expect(
        invoicing.recordPayment({
          invoice_id: invoiceId, amount: 200000, payment_date: '2026-04-15', cash_account_id: cash.id,
        }),
      ).rejects.toThrow(/exceeds balance/)
    })
  })

  describe('Void invoice', () => {
    beforeEach(async () => {
      await invoicing.init()
    })

    it('void on an unpaid finalized invoice voids the AR transaction via SDK', async () => {
      const customerId = makeCustomer('A')
      const sales = findAccount('4000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'x', quantity: 1, unit_price: 50000, account_id: sales.id }],
      })
      const finalized = await invoicing.finalizeInvoice(inv.id)
      const voided = await invoicing.voidInvoice(inv.id)
      expect(voided.status).toBe('void')
      // The original AR tx is now flagged voided in the kernel
      const tx = mock.transactions.find((t) => t.id === finalized.transaction_id)
      expect(tx?.is_void).toBe(1)
    })

    it('void with payments is rejected', async () => {
      const customerId = makeCustomer('A')
      const sales = findAccount('4000')
      const cash = findAccount('1000')
      const inv = await invoicing.createInvoice({
        customer_contact_id: customerId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: 'x', quantity: 1, unit_price: 50000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(inv.id)
      await invoicing.recordPayment({
        invoice_id: inv.id, amount: 10000, payment_date: '2026-04-10', cash_account_id: cash.id,
      })
      await expect(invoicing.voidInvoice(inv.id)).rejects.toThrow(/payments first/)
    })
  })

  describe('AR aging report', () => {
    beforeEach(async () => {
      await invoicing.init()
    })

    it('buckets unpaid invoices by days past due', async () => {
      const acmeId = makeCustomer('Acme')
      const sales = findAccount('4000')
      // Current (not yet due)
      const a = await invoicing.createInvoice({
        customer_contact_id: acmeId, issue_date: '2026-04-01', due_date: '2026-05-01',
        lines: [{ description: '', quantity: 1, unit_price: 10000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(a.id)
      // 1-30 (15 days past due as of 2026-04-30)
      const b = await invoicing.createInvoice({
        customer_contact_id: acmeId, issue_date: '2026-03-15', due_date: '2026-04-15',
        lines: [{ description: '', quantity: 1, unit_price: 20000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(b.id)
      // 90+ past due
      const c = await invoicing.createInvoice({
        customer_contact_id: acmeId, issue_date: '2025-12-01', due_date: '2025-12-31',
        lines: [{ description: '', quantity: 1, unit_price: 50000, account_id: sales.id }],
      })
      await invoicing.finalizeInvoice(c.id)

      const report = await invoicing.getArAgingReport('2026-04-30')
      expect(report.buckets).toHaveLength(1)
      const bucket = report.buckets[0]
      expect(bucket.current).toBe(10000) // due 2026-05-01, not yet due
      expect(bucket.d_1_30).toBe(20000)
      expect(bucket.d_90_plus).toBe(50000)
      expect(bucket.total).toBe(80000)
      expect(report.totals.total).toBe(80000)
    })
  })

  describe('SDK isolation guarantees', () => {
    it('module SDK does not expose any kernel-only commands', () => {
      // The ModuleSdk surface only includes ledger/accounts/contacts/storage/ui
      const sdkKeys = Object.keys(sdk).sort()
      expect(sdkKeys).toEqual(['accounts', 'contacts', 'ledger', 'storage', 'ui'])
      // No createNewFile / openFile / closeFile / autoBackup / etc.
      expect((sdk as Record<string, unknown>).createNewFile).toBeUndefined()
      expect((sdk as Record<string, unknown>).db).toBeUndefined()
      expect((sdk as Record<string, unknown>).conn).toBeUndefined()
    })

    it('SDK storage operations are sandboxed to the module alias', () => {
      // If the module tries to query a kernel table name it gets "Table not found"
      // because the storage layer keys on the module's own ATTACH alias.
      expect(() => sdk.storage.query('accounts')).toThrow(/Table not found/)
      expect(() => sdk.storage.query('transactions')).toThrow(/Table not found/)
    })

    it('SDK ledger calls are recorded against the module for permission checks', () => {
      // Removing ledger:write from the invoicing module disables the SDK call
      mock.revokeModulePermission(INVOICING_ID, 'ledger:write')
      expect(() =>
        sdk.ledger.createTransaction({
          date: '2026-04-01', description: 'x', entries: [],
        }),
      ).toThrow(/does not have permission 'ledger:write'/)
    })
  })
})
