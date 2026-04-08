import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 35 — Document Attachments', () => {
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

  it('attach document to transaction, list shows it', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const txId = mock.createTransaction({
      date: '2025-01-10',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    const docId = mock.attachDocument('TRANSACTION', txId, '/tmp/receipt.pdf', 'receipt.pdf', 'January receipt')
    expect(docId).toBeTruthy()

    const docs = mock.listDocuments('TRANSACTION', txId)
    expect(docs).toHaveLength(1)
    expect(docs[0].filename).toBe('receipt.pdf')
    expect(docs[0].description).toBe('January receipt')
    expect(docs[0].entity_type).toBe('TRANSACTION')
    expect(docs[0].entity_id).toBe(txId)
  })

  it('attach document to contact, list shows it', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Acme Corp' })

    const docId = mock.attachDocument('CONTACT', contactId, '/tmp/w9.pdf', 'w9-acme.pdf', 'W-9 form')
    expect(docId).toBeTruthy()

    const docs = mock.listDocuments('CONTACT', contactId)
    expect(docs).toHaveLength(1)
    expect(docs[0].filename).toBe('w9-acme.pdf')
  })

  it('attach multiple documents to same entity', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const txId = mock.createTransaction({
      date: '2025-01-10',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    mock.attachDocument('TRANSACTION', txId, '/tmp/receipt.pdf', 'receipt.pdf')
    mock.attachDocument('TRANSACTION', txId, '/tmp/invoice.pdf', 'invoice.pdf')
    mock.attachDocument('TRANSACTION', txId, '/tmp/photo.jpg', 'photo.jpg')

    const docs = mock.listDocuments('TRANSACTION', txId)
    expect(docs).toHaveLength(3)
  })

  it('delete document removes from list', () => {
    const contactId = mock.createContact({ contactType: 'CUSTOMER', name: 'Client X' })

    const docId1 = mock.attachDocument('CONTACT', contactId, '/tmp/a.pdf', 'a.pdf')
    const docId2 = mock.attachDocument('CONTACT', contactId, '/tmp/b.pdf', 'b.pdf')

    expect(mock.listDocuments('CONTACT', contactId)).toHaveLength(2)

    mock.deleteDocument(docId1)
    const remaining = mock.listDocuments('CONTACT', contactId)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(docId2)
  })

  it('get_document_count returns correct count', () => {
    const cash = findAccount('1000')
    const revenue = findAccount('4000')

    const txId = mock.createTransaction({
      date: '2025-01-10',
      description: 'Sale',
      entries: [
        { account_id: cash.id, debit: 100000, credit: 0 },
        { account_id: revenue.id, debit: 0, credit: 100000 },
      ],
    })

    expect(mock.getDocumentCount('TRANSACTION', txId)).toBe(0)

    mock.attachDocument('TRANSACTION', txId, '/tmp/a.pdf', 'a.pdf')
    mock.attachDocument('TRANSACTION', txId, '/tmp/b.pdf', 'b.pdf')

    expect(mock.getDocumentCount('TRANSACTION', txId)).toBe(2)
  })

  it('cannot attach to nonexistent entity', () => {
    expect(() => mock.attachDocument('TRANSACTION', 'nonexistent-id', '/tmp/a.pdf', 'a.pdf'))
      .toThrow('Transaction not found')

    expect(() => mock.attachDocument('CONTACT', 'nonexistent-id', '/tmp/a.pdf', 'a.pdf'))
      .toThrow('Contact not found')

    expect(() => mock.attachDocument('ACCOUNT', 'nonexistent-id', '/tmp/a.pdf', 'a.pdf'))
      .toThrow('Account not found')
  })

  it('stored_filename is UUID-based, not original filename', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Test' })
    mock.attachDocument('CONTACT', contactId, '/tmp/receipt.pdf', 'receipt.pdf')

    const docs = mock.listDocuments('CONTACT', contactId)
    expect(docs[0].stored_filename).not.toBe('receipt.pdf')
    expect(docs[0].stored_filename).toMatch(/\.pdf$/)
    expect(docs[0].filename).toBe('receipt.pdf')
  })

  it('document metadata includes correct mime_type and file_size', () => {
    const contactId = mock.createContact({ contactType: 'VENDOR', name: 'Test' })

    mock.attachDocument('CONTACT', contactId, '/tmp/photo.jpg', 'photo.jpg', undefined, 2048)
    mock.attachDocument('CONTACT', contactId, '/tmp/doc.pdf', 'invoice.pdf', undefined, 5120)
    mock.attachDocument('CONTACT', contactId, '/tmp/data.csv', 'data.csv')

    const docs = mock.listDocuments('CONTACT', contactId)
    const jpg = docs.find((d) => d.filename === 'photo.jpg')!
    const pdf = docs.find((d) => d.filename === 'invoice.pdf')!
    const csv = docs.find((d) => d.filename === 'data.csv')!

    expect(jpg.mime_type).toBe('image/jpeg')
    expect(jpg.file_size_bytes).toBe(2048)

    expect(pdf.mime_type).toBe('application/pdf')
    expect(pdf.file_size_bytes).toBe(5120)

    expect(csv.mime_type).toBe('text/csv')
  })
})
