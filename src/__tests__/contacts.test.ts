import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 33 — Contact Registry', () => {
  let mock: MockApi

  function findAccount(code: string) {
    const acct = mock.getAccounts().find((a) => a.code === code)
    if (!acct) throw new Error(`Account ${code} not found`)
    return acct
  }

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  // ── Contact CRUD ──────────────────────────────────────

  it('create, read, update, list, deactivate, reactivate contacts', () => {
    const id = mock.createContact({
      contactType: 'VENDOR',
      name: 'Acme Corp',
      companyName: 'Acme Corporation',
      email: 'billing@acme.com',
      phone: '555-1234',
    })
    expect(id).toBeTruthy()

    // Read
    const contact = mock.getContact(id)
    expect(contact.name).toBe('Acme Corp')
    expect(contact.type).toBe('VENDOR')
    expect(contact.company_name).toBe('Acme Corporation')
    expect(contact.email).toBe('billing@acme.com')
    expect(contact.is_active).toBe(1)
    expect(contact.country).toBe('US')

    // Update
    mock.updateContact(id, { name: 'Acme Inc', email: 'ap@acme.com' })
    const updated = mock.getContact(id)
    expect(updated.name).toBe('Acme Inc')
    expect(updated.email).toBe('ap@acme.com')
    expect(updated.phone).toBe('555-1234') // unchanged

    // List
    const id2 = mock.createContact({ contactType: 'CUSTOMER', name: 'Beta LLC' })
    const all = mock.listContacts()
    expect(all).toHaveLength(2)

    // Deactivate
    mock.deactivateContact(id)
    expect(mock.getContact(id).is_active).toBe(0)

    // List active only
    const active = mock.listContacts(undefined, undefined, 1)
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(id2)

    // Reactivate
    mock.reactivateContact(id)
    expect(mock.getContact(id).is_active).toBe(1)
  })

  it('search contacts by name substring', () => {
    mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    mock.createContact({ contactType: 'CUSTOMER', name: 'Beta LLC' })
    mock.createContact({ contactType: 'VENDOR', name: 'Acme Supplies' })

    const results = mock.listContacts(undefined, 'acme')
    expect(results).toHaveLength(2)
    expect(results.every((c) => c.name.includes('Acme'))).toBe(true)
  })

  it('filter contacts by type', () => {
    mock.createContact({ contactType: 'VENDOR', name: 'Vendor A' })
    mock.createContact({ contactType: 'CUSTOMER', name: 'Customer A' })
    mock.createContact({ contactType: 'VENDOR', name: 'Vendor B' })

    const vendors = mock.listContacts('VENDOR')
    expect(vendors).toHaveLength(2)
    expect(vendors.every((c) => c.type === 'VENDOR')).toBe(true)

    const customers = mock.listContacts('CUSTOMER')
    expect(customers).toHaveLength(1)
  })

  it('create transaction with contact, verify junction row', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')

    const txId = mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Rent payment to Acme',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
    })

    expect(txId).toBeTruthy()
    const tc = mock.transactionContacts.find(
      (tc) => tc.transaction_id === txId && tc.contact_id === contactId,
    )
    expect(tc).toBeDefined()
    expect(tc!.role).toBe('PRIMARY')
  })

  it('contact ledger returns correct transactions and running balance', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const supplies = findAccount('5400')

    // Two transactions linked to contact
    mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Rent payment',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
    })

    mock.createTransactionWithContact({
      date: '2025-02-15',
      description: 'Supply purchase',
      entries: [
        { account_id: supplies.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
      contact_id: contactId,
    })

    // One transaction NOT linked to contact
    mock.createTransaction({
      date: '2025-01-20',
      description: 'Unrelated',
      entries: [
        { account_id: supplies.id, debit: 10000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 10000 },
      ],
    })

    const ledger = mock.getContactLedger(contactId)
    expect(ledger.entries).toHaveLength(2)
    expect(ledger.entries[0].description).toBe('Rent payment')
    expect(ledger.entries[0].running_balance).toBe(0) // 100000 debit - 100000 credit = 0
    expect(ledger.entries[1].description).toBe('Supply purchase')
    expect(ledger.entries[1].running_balance).toBe(0) // balanced transactions net to 0
    expect(ledger.total_debits).toBe(150000)
    expect(ledger.total_credits).toBe(150000)
    expect(ledger.net_balance).toBe(0)
  })

  it('contact balance calculation correct', () => {
    const contactId = mock.createContact({ contactType: 'CUSTOMER', name: 'Client X' })
    const ar = findAccount('1100') // Accounts Receivable
    const revenue = findAccount('4000') // Sales Revenue

    // Invoice: debit AR, credit Revenue
    mock.createTransactionWithContact({
      date: '2025-01-10',
      description: 'Invoice #1',
      entries: [
        { account_id: ar.id, debit: 200000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 200000 },
      ],
      contact_id: contactId,
    })

    // Balance = sum(debit) - sum(credit) = 200000 - 200000 = 0 (balanced tx)
    const balance = mock.getContactBalance(contactId)
    expect(balance).toBe(0)

    // As of date filter
    const balanceBefore = mock.getContactBalance(contactId, '2025-01-01')
    expect(balanceBefore).toBe(0)
  })

  it('cannot delete contact with transaction references', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')

    mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Rent',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
    })

    expect(() => mock.deleteContact(contactId)).toThrow('Deactivate instead')
  })

  it('deactivated contact excluded from active list but existing ledger preserved', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Old Vendor' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')

    mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Payment',
      entries: [
        { account_id: rent.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
      contact_id: contactId,
    })

    mock.deactivateContact(contactId)

    // Not in active list
    const activeContacts = mock.listContacts(undefined, undefined, 1)
    expect(activeContacts.find((c) => c.id === contactId)).toBeUndefined()

    // But ledger still works
    const ledger = mock.getContactLedger(contactId)
    expect(ledger.entries).toHaveLength(1)
  })

  it('trial balance filtered by contact returns correct subset', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const supplies = findAccount('5400')

    // Transaction WITH contact
    mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Rent to Acme',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
    })

    // Transaction WITHOUT contact
    mock.createTransaction({
      date: '2025-01-20',
      description: 'Office supplies',
      entries: [
        { account_id: supplies.id, debit: 30000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 30000 },
      ],
    })

    // Unfiltered TB includes both
    const tbAll = mock.getTrialBalanceWithContact()
    const cashRowAll = tbAll.rows.find((r) => r.code === '1000')!
    expect(cashRowAll.credit).toBe(130000)

    // Filtered by contact — only Acme transaction
    const tbFiltered = mock.getTrialBalanceWithContact(undefined, undefined, contactId)
    const cashRow = tbFiltered.rows.find((r) => r.code === '1000')!
    expect(cashRow.credit).toBe(100000)
    const rentRow = tbFiltered.rows.find((r) => r.code === '5100')!
    expect(rentRow.debit).toBe(100000)
    // Supplies should NOT appear
    expect(tbFiltered.rows.find((r) => r.code === '5400')).toBeUndefined()
  })

  it('contact filter composes with dimension filter (AND)', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })
    const dimId = mock.createDimension({ dimType: 'CLASS', name: 'Retail' })
    const dimId2 = mock.createDimension({ dimType: 'CLASS', name: 'Wholesale' })
    const cash = findAccount('1000')
    const rent = findAccount('5100')
    const supplies = findAccount('5400')

    // Transaction with contact AND 'Retail' dimension
    mock.createTransactionWithContact({
      date: '2025-01-15',
      description: 'Rent Retail',
      entries: [
        { account_id: rent.id, debit: 100000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 100000 },
      ],
      contact_id: contactId,
      dimensions: [{ line_index: 0, dimension_id: dimId }],
    })

    // Transaction with contact AND 'Wholesale' dimension
    mock.createTransactionWithContact({
      date: '2025-01-20',
      description: 'Supplies Wholesale',
      entries: [
        { account_id: supplies.id, debit: 50000, credit: 0 },
        { account_id: cash.id, debit: 0, credit: 50000 },
      ],
      contact_id: contactId,
      dimensions: [{ line_index: 0, dimension_id: dimId2 }],
    })

    // Filter by contact only — both transactions
    const tbContact = mock.getTrialBalanceWithContact(undefined, undefined, contactId)
    expect(tbContact.rows.find((r) => r.code === '5100')).toBeDefined()
    expect(tbContact.rows.find((r) => r.code === '5400')).toBeDefined()

    // Filter by contact AND Retail dimension — only rent transaction's rent line
    const tbBoth = mock.getTrialBalanceWithContact(
      undefined, undefined, contactId, [{ type: 'CLASS', dimension_id: dimId }]
    )
    const rentRow = tbBoth.rows.find((r) => r.code === '5100')
    expect(rentRow).toBeDefined()
    expect(rentRow!.debit).toBe(100000)
    // Supplies should NOT appear (it has Wholesale dimension)
    expect(tbBoth.rows.find((r) => r.code === '5400')).toBeUndefined()
  })
})
