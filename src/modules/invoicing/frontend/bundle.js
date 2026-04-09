// Invoicing module entry point.
//
// Runs INSIDE the iframe sandbox. Imports the SDK shim provided by the host
// and uses ONLY sdk.* methods to read/write data — no direct fetch, no
// access to the host DOM.

import { sdk } from '../../module-sdk/sdk.js'

const MODULE_ID = 'com.bookkeeping.invoicing'

async function bootstrap() {
  // Register UI extensions on first load
  await sdk.ui.registerNavItem('Invoices', 'receipt')
  await sdk.ui.registerSettingsPane('Invoicing Settings')
  await sdk.ui.registerTransactionAction('Create Invoice from Transaction', 'create_invoice_from_tx')

  // Subscribe to events that should refresh the invoice list
  await sdk.events.subscribe('contact.updated')
  await sdk.events.subscribe('period.locked')

  // Register a hook so voiding a transaction with a linked invoice warns
  await sdk.hooks.register('before_transaction_void', 50)

  await refreshInvoiceList()
}

function fmtMoney(cents) {
  const sign = cents < 0 ? '-' : ''
  const n = Math.abs(cents)
  return `${sign}$${(n / 100).toFixed(2)}`
}

async function refreshInvoiceList() {
  const root = document.getElementById('invoice-list')
  if (!root) return
  try {
    const rows = await sdk.storage.query('invoices')
    const customers = await sdk.contacts.list({ contact_type: 'CUSTOMER' })
    const customerById = Object.fromEntries(customers.map((c) => [c.id, c.name]))
    if (rows.length === 0) {
      root.innerHTML = '<p>No invoices yet. Click "+ New Invoice" to create one.</p>'
      return
    }
    root.innerHTML = `
      <table>
        <thead>
          <tr><th>#</th><th>Customer</th><th>Status</th><th>Issue Date</th><th>Due</th><th>Total</th><th>Balance</th></tr>
        </thead>
        <tbody>
          ${rows
            .sort((a, b) => b.invoice_number.localeCompare(a.invoice_number))
            .map(
              (r) => `
            <tr>
              <td>${r.invoice_number}</td>
              <td>${customerById[r.customer_contact_id] ?? 'Unknown'}</td>
              <td><span class="status-badge status-${r.status}">${r.status}</span></td>
              <td>${r.issue_date}</td>
              <td>${r.due_date}</td>
              <td>${fmtMoney(r.total)}</td>
              <td>${fmtMoney(r.balance_due)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    `
  } catch (e) {
    root.innerHTML = `<p style="color: var(--color-danger)">Failed to load: ${e.message}</p>`
  }
}

document.getElementById('new-invoice')?.addEventListener('click', async () => {
  // Real implementation opens a form. For Phase 46 we keep the iframe-side
  // UI minimal — the test surface is the InvoicingModule TS class.
  console.log('New invoice clicked — open form (host implementation)')
})

bootstrap().catch((e) => {
  console.error('Invoicing init failed', e)
  const root = document.getElementById('root')
  if (root) root.textContent = `Failed to load Invoicing: ${e.message}`
})

export { MODULE_ID }
