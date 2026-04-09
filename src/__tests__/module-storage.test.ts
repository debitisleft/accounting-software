import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

describe('Phase 38 — Storage Sandbox & Directory Structure', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/MyCo', 'My Co')
  })

  describe('Directory-based company files', () => {
    it('createNewFile sets companyDir from a directory-style path', () => {
      mock.closeFile()
      mock.createNewFile('/tmp/AcmeInc', 'Acme Inc')
      expect(mock.companyDir).toBe('/tmp/AcmeInc')
      expect(mock.isFileOpen()).toBe(true)
    })

    it('openFile on a legacy .sqlite path auto-derives directory', () => {
      mock.closeFile()
      // Legacy single-file path → auto-migration strips the .sqlite extension
      const info = mock.openFile('/tmp/legacy-co.sqlite')
      expect(info.path).toBe('/tmp/legacy-co.sqlite')
      expect(mock.companyDir).toBe('/tmp/legacy-co')
    })

    it('closeFile clears companyDir and detaches all modules', () => {
      mock.attachModuleDb('invoicing')
      expect(mock.listAttachedModules()).toContain('invoicing')
      mock.closeFile()
      expect(mock.companyDir).toBeNull()
      expect(mock.listAttachedModules()).toHaveLength(0)
    })
  })

  describe('Module ATTACH / DETACH', () => {
    it('attachModuleDb adds the module to the attached list', () => {
      mock.attachModuleDb('invoicing')
      expect(mock.listAttachedModules()).toEqual(['invoicing'])
    })

    it('attachModuleDb is idempotent', () => {
      mock.attachModuleDb('invoicing')
      mock.attachModuleDb('invoicing')
      expect(mock.listAttachedModules()).toHaveLength(1)
    })

    it('detachModuleDb removes the module', () => {
      mock.attachModuleDb('invoicing')
      mock.detachModuleDb('invoicing')
      expect(mock.listAttachedModules()).toEqual([])
    })

    it('rejects invalid module ids', () => {
      expect(() => mock.attachModuleDb('has-dash')).toThrow(/Invalid module_id/)
      expect(() => mock.attachModuleDb('1starts')).toThrow(/Invalid module_id/)
      expect(() => mock.attachModuleDb("'; DROP TABLE")).toThrow(/Invalid module_id/)
    })

    it('module operations require the module to be attached first', () => {
      expect(() => mock.moduleCreateTable('invoicing', 'invoices', 'id INTEGER'))
        .toThrow(/Module not attached/)
    })
  })

  describe('Module CRUD', () => {
    beforeEach(() => {
      mock.attachModuleDb('invoicing')
      mock.moduleCreateTable(
        'invoicing',
        'invoices',
        'invoice_number TEXT, customer_id TEXT, amount INTEGER, status TEXT'
      )
    })

    it('moduleCreateTable creates a fresh table', () => {
      const rows = mock.moduleQuery('invoicing', 'invoices')
      expect(rows).toEqual([])
    })

    it('moduleInsert + moduleQuery round-trips a row', () => {
      const id = mock.moduleInsert('invoicing', 'invoices', {
        invoice_number: 'INV-001',
        customer_id: 'cust-1',
        amount: 25000,
        status: 'sent',
      })
      expect(id).toBeGreaterThan(0)

      const rows = mock.moduleQuery('invoicing', 'invoices')
      expect(rows).toHaveLength(1)
      expect(rows[0].invoice_number).toBe('INV-001')
      expect(rows[0].amount).toBe(25000)
      expect(rows[0].id).toBe(id)
    })

    it('moduleUpdate modifies the row by id', () => {
      const id = mock.moduleInsert('invoicing', 'invoices', {
        invoice_number: 'INV-002', customer_id: 'cust-2', amount: 5000, status: 'draft',
      })
      const n = mock.moduleUpdate('invoicing', 'invoices', id, { status: 'paid', amount: 5500 })
      expect(n).toBe(1)
      const rows = mock.moduleQuery('invoicing', 'invoices')
      expect(rows[0].status).toBe('paid')
      expect(rows[0].amount).toBe(5500)
    })

    it('moduleDelete removes the row by id', () => {
      const id = mock.moduleInsert('invoicing', 'invoices', {
        invoice_number: 'INV-003', customer_id: 'cust-3', amount: 1000, status: 'draft',
      })
      const n = mock.moduleDelete('invoicing', 'invoices', id)
      expect(n).toBe(1)
      expect(mock.moduleQuery('invoicing', 'invoices')).toEqual([])
    })

    it('moduleQuery filters with =, >, LIKE return correct subset', () => {
      mock.moduleInsert('invoicing', 'invoices', { invoice_number: 'INV-100', customer_id: 'A', amount: 1000, status: 'paid' })
      mock.moduleInsert('invoicing', 'invoices', { invoice_number: 'INV-101', customer_id: 'B', amount: 5000, status: 'sent' })
      mock.moduleInsert('invoicing', 'invoices', { invoice_number: 'INV-102', customer_id: 'A', amount: 9000, status: 'sent' })

      const paid = mock.moduleQuery('invoicing', 'invoices', [{ column: 'status', op: '=', value: 'paid' }])
      expect(paid).toHaveLength(1)
      expect(paid[0].invoice_number).toBe('INV-100')

      const big = mock.moduleQuery('invoicing', 'invoices', [{ column: 'amount', op: '>', value: 4000 }])
      expect(big).toHaveLength(2)

      const a = mock.moduleQuery('invoicing', 'invoices', [
        { column: 'customer_id', op: '=', value: 'A' },
        { column: 'amount', op: '>=', value: 5000 },
      ])
      expect(a).toHaveLength(1)
      expect(a[0].invoice_number).toBe('INV-102')

      const like = mock.moduleQuery('invoicing', 'invoices', [
        { column: 'invoice_number', op: 'LIKE', value: 'INV-10%' },
      ])
      expect(like).toHaveLength(3)
    })
  })

  describe('Module isolation', () => {
    it('one module cannot read another module tables', () => {
      mock.attachModuleDb('invoicing')
      mock.attachModuleDb('payroll')
      mock.moduleCreateTable('invoicing', 'invoices', 'amount INTEGER')
      mock.moduleInsert('invoicing', 'invoices', { amount: 1000 })

      // payroll asks for the same logical name — its own store has no such table
      expect(() => mock.moduleQuery('payroll', 'invoices')).toThrow(/Table not found/)
    })

    it('module storage cannot be used to access kernel tables', () => {
      mock.attachModuleDb('invoicing')
      // 'accounts' is a kernel table — module store has no such table
      expect(() => mock.moduleQuery('invoicing', 'accounts')).toThrow(/Table not found/)
      expect(() => mock.moduleInsert('invoicing', 'accounts', { code: '9999', name: 'evil' }))
        .toThrow(/Table not found/)
    })

    it('detached module cannot perform operations', () => {
      mock.attachModuleDb('invoicing')
      mock.moduleCreateTable('invoicing', 'invoices', 'amount INTEGER')
      mock.detachModuleDb('invoicing')
      expect(() => mock.moduleQuery('invoicing', 'invoices')).toThrow(/Module not attached/)
    })
  })

  describe('Module migrations', () => {
    it('moduleExecuteMigration is idempotent (records version)', () => {
      mock.attachModuleDb('invoicing')
      mock.moduleExecuteMigration('invoicing', '001_init', 'CREATE TABLE invoices(id INTEGER)')
      mock.moduleExecuteMigration('invoicing', '001_init', 'CREATE TABLE invoices(id INTEGER)')
      expect(mock.moduleMigrations['invoicing']).toEqual(['001_init'])
    })
  })

  describe('Document storage uses company directory', () => {
    it('document attach/list still works after directory format change', () => {
      const cash = mock.getAccounts().find((a) => a.code === '1000')!
      const txId = mock.createTransaction({
        date: '2026-01-15',
        description: 'Sale',
        entries: [
          { account_id: cash.id, debit: 10000, credit: 0 },
          { account_id: mock.getAccounts().find((a) => a.code === '4000')!.id, debit: 0, credit: 10000 },
        ],
      })
      const docId = mock.attachDocument('TRANSACTION', txId, '/tmp/r.pdf', 'r.pdf')
      expect(docId).toBeTruthy()
      expect(mock.listDocuments('TRANSACTION', txId)).toHaveLength(1)
    })
  })
})
