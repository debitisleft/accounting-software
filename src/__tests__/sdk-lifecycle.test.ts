import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

const validManifest = {
  id: 'com.example.invoicing',
  name: 'Invoicing & AR',
  version: '1.0.0',
  sdk_version: '1',
  description: 'Create and manage invoices',
  author: 'Example Corp',
  license: 'MIT',
  permissions: [
    'ledger:read',
    'ledger:write',
    'accounts:read',
    'storage:own',
    'services:register',
    'services:call',
  ],
  entry_point: 'frontend/index.html',
}

describe('Phase 40 — SDK v1 Core & Module Lifecycle', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/PluginCo', 'Plugin Co')
  })

  describe('install_module', () => {
    it('install with valid manifest succeeds and is recorded in registry', () => {
      const entry = mock.installModule(validManifest, '/path/to/install')
      expect(entry.id).toBe(validManifest.id)
      expect(entry.status).toBe('active')
      expect(entry.permissions).toContain('ledger:write')
      expect(entry.install_path).toBe('/path/to/install')

      const list = mock.listInstalledModules()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe(validManifest.id)
    })

    it('install with incompatible sdk_version is rejected', () => {
      const bad = { ...validManifest, sdk_version: '99' }
      expect(() => mock.installModule(bad)).toThrow(/Unsupported sdk_version/)
    })

    it('install with duplicate id is rejected', () => {
      mock.installModule(validManifest)
      expect(() => mock.installModule(validManifest)).toThrow(/already installed/)
    })

    it('install with invalid id chars is rejected', () => {
      expect(() => mock.installModule({ ...validManifest, id: 'has space' })).toThrow(/Invalid module id/)
      expect(() => mock.installModule({ ...validManifest, id: "evil';" })).toThrow(/Invalid module id/)
    })
  })

  describe('uninstall_module', () => {
    it('uninstall removes the module from registry', () => {
      mock.installModule(validManifest)
      mock.uninstallModule(validManifest.id)
      expect(mock.listInstalledModules()).toHaveLength(0)
    })

    it('uninstall with keep_data=true preserves the .sqlite slot', () => {
      mock.installModule(validManifest)
      mock.uninstallModule(validManifest.id, true)
      const alias = 'com_example_invoicing'
      expect(mock.moduleSqliteFiles.has(alias)).toBe(true)
    })

    it('uninstall without keep_data removes the .sqlite slot', () => {
      mock.installModule(validManifest)
      mock.uninstallModule(validManifest.id, false)
      const alias = 'com_example_invoicing'
      expect(mock.moduleSqliteFiles.has(alias)).toBe(false)
    })

    it('uninstall clears registered services', () => {
      mock.installModule(validManifest)
      mock.sdkRegisterService(validManifest.id, 'get_invoice', { description: 'Fetch an invoice' })
      expect(mock.sdkListServices()).toHaveLength(1)
      mock.uninstallModule(validManifest.id)
      expect(mock.sdkListServices()).toHaveLength(0)
    })
  })

  describe('enable / disable', () => {
    it('disable_module sets status to disabled', () => {
      mock.installModule(validManifest)
      mock.disableModule(validManifest.id)
      expect(mock.getModuleInfo(validManifest.id).status).toBe('disabled')
    })

    it('enable_module sets status back to active', () => {
      mock.installModule(validManifest)
      mock.disableModule(validManifest.id)
      mock.enableModule(validManifest.id)
      expect(mock.getModuleInfo(validManifest.id).status).toBe('active')
    })

    it('disable clears registered services', () => {
      mock.installModule(validManifest)
      mock.sdkRegisterService(validManifest.id, 'svc', {})
      mock.disableModule(validManifest.id)
      expect(mock.sdkListServices()).toHaveLength(0)
    })
  })

  describe('SDK v1 contract', () => {
    beforeEach(() => {
      mock.installModule(validManifest)
    })

    it('get_sdk_version returns "1"', () => {
      expect(mock.getSdkVersion()).toBe('1')
    })

    it('SDK ledger methods call through to engine', () => {
      const cash = mock.getAccounts().find((a) => a.code === '1000')!
      const sales = mock.getAccounts().find((a) => a.code === '4000')!
      const txId = mock.sdkCreateTransaction(validManifest.id, {
        date: '2026-02-01',
        description: 'SDK-routed sale',
        entries: [
          { account_id: cash.id, debit: 50000, credit: 0 },
          { account_id: sales.id, debit: 0, credit: 50000 },
        ],
      })
      expect(txId).toBeTruthy()
      const accounts = mock.sdkGetChartOfAccounts(validManifest.id)
      expect(accounts.length).toBeGreaterThan(0)
    })

    it('SDK storage methods call through to module storage', () => {
      const alias = 'com_example_invoicing'
      mock.attachModuleDb(alias)
      mock.sdkStorageCreateTable(alias, 'invoices', 'amount INTEGER, status TEXT')
      const id = mock.sdkStorageInsert(alias, 'invoices', { amount: 1234, status: 'sent' })
      expect(id).toBeGreaterThan(0)
      const rows = mock.sdkStorageQuery(alias, 'invoices')
      expect(rows).toHaveLength(1)
      expect(rows[0].amount).toBe(1234)
    })
  })

  describe('Service registry', () => {
    it('register_service + call_service round-trips', () => {
      mock.installModule(validManifest)
      mock.installModule({ ...validManifest, id: 'com.example.reports', name: 'Reports' })
      mock.sdkRegisterService(validManifest.id, 'get_invoice', {
        description: 'Fetch invoice by id',
      })
      const result = mock.sdkCallService(
        'com.example.reports',
        validManifest.id,
        'get_invoice',
        { id: 42 },
      )
      expect(result.ok).toBe(true)
      expect(result.module_id).toBe(validManifest.id)
      expect(result.service_name).toBe('get_invoice')
      expect(result.params).toEqual({ id: 42 })
    })

    it('call to unregistered service returns error', () => {
      mock.installModule(validManifest)
      expect(() =>
        mock.sdkCallService(validManifest.id, 'com.example.missing', 'no_such_thing', {}),
      ).toThrow(/Service not found/)
    })

    it('list_services returns all registered services', () => {
      mock.installModule(validManifest)
      mock.sdkRegisterService(validManifest.id, 'a', {})
      mock.sdkRegisterService(validManifest.id, 'b', {})
      expect(mock.sdkListServices()).toHaveLength(2)
    })
  })

  describe('list_installed_modules', () => {
    it('returns all modules with correct statuses', () => {
      mock.installModule({ ...validManifest, id: 'com.example.alpha', name: 'Alpha' })
      mock.installModule({ ...validManifest, id: 'com.example.beta', name: 'Beta' })
      mock.installModule({ ...validManifest, id: 'com.example.gamma', name: 'Gamma' })
      mock.disableModule('com.example.beta')

      const list = mock.listInstalledModules()
      expect(list).toHaveLength(3)
      expect(list.map((m) => m.name)).toEqual(['Alpha', 'Beta', 'Gamma'])
      expect(list.find((m) => m.id === 'com.example.beta')!.status).toBe('disabled')
      expect(list.find((m) => m.id === 'com.example.alpha')!.status).toBe('active')
    })
  })

  describe('Startup with mixed states', () => {
    it('active and disabled modules coexist after install', () => {
      mock.installModule({ ...validManifest, id: 'mod.a' })
      mock.installModule({ ...validManifest, id: 'mod.b' })
      mock.disableModule('mod.b')
      const all = mock.listInstalledModules()
      expect(all.filter((m) => m.status === 'active')).toHaveLength(1)
      expect(all.filter((m) => m.status === 'disabled')).toHaveLength(1)
    })
  })
})
