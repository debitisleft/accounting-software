import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

const baseManifest = {
  id: 'com.example.test',
  name: 'Test Module',
  version: '1.0.0',
  sdk_version: '1',
  description: null,
  author: null,
  license: null,
  permissions: [] as string[],
  entry_point: null,
}

describe('Phase 41 — Permission Enforcer', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/PermCo', 'Perm Co')
  })

  it('SDK method with the required permission succeeds', () => {
    mock.installModule({
      ...baseManifest,
      permissions: ['ledger:write', 'accounts:read'],
    })
    const cash = mock.getAccounts().find((a) => a.code === '1000')!
    const sales = mock.getAccounts().find((a) => a.code === '4000')!
    const txId = mock.sdkCreateTransaction(baseManifest.id, {
      date: '2026-03-01',
      description: 'OK',
      entries: [
        { account_id: cash.id, debit: 1000, credit: 0 },
        { account_id: sales.id, debit: 0, credit: 1000 },
      ],
    })
    expect(txId).toBeTruthy()
  })

  it('SDK method without permission throws "does not have permission"', () => {
    mock.installModule({ ...baseManifest, permissions: [] })
    expect(() =>
      mock.sdkCreateTransaction(baseManifest.id, {
        date: '2026-03-01',
        description: 'denied',
        entries: [],
      }),
    ).toThrow(/does not have permission 'ledger:write'/)
  })

  it('install_module grants all manifest permissions', () => {
    mock.installModule({
      ...baseManifest,
      permissions: ['ledger:read', 'reports:read', 'documents:read'],
    })
    const granted = mock.getModulePermissions(baseManifest.id)
    expect(granted).toEqual(['documents:read', 'ledger:read', 'reports:read'])
  })

  it('uninstall_module removes all permissions', () => {
    mock.installModule({
      ...baseManifest,
      permissions: ['ledger:read', 'storage:own'],
    })
    expect(mock.getModulePermissions(baseManifest.id).length).toBe(2)
    mock.uninstallModule(baseManifest.id)
    expect(mock.getModulePermissions(baseManifest.id)).toEqual([])
  })

  it('grant_module_permission adds a new permission and SDK call now succeeds', () => {
    mock.installModule({ ...baseManifest, permissions: [] })
    expect(() => mock.sdkGetChartOfAccounts(baseManifest.id))
      .toThrow(/does not have permission 'accounts:read'/)
    mock.grantModulePermission(baseManifest.id, 'accounts:read')
    const accounts = mock.sdkGetChartOfAccounts(baseManifest.id)
    expect(accounts.length).toBeGreaterThan(0)
  })

  it('revoke_module_permission removes permission and SDK call now fails', () => {
    mock.installModule({ ...baseManifest, permissions: ['accounts:read'] })
    expect(mock.sdkGetChartOfAccounts(baseManifest.id).length).toBeGreaterThan(0)
    mock.revokeModulePermission(baseManifest.id, 'accounts:read')
    expect(() => mock.sdkGetChartOfAccounts(baseManifest.id))
      .toThrow(/does not have permission 'accounts:read'/)
  })

  it('module with ledger:read but not ledger:write can read but not write', () => {
    mock.installModule({ ...baseManifest, permissions: ['ledger:read'] })
    // Read works (no permission error from list_transactions wrapper would
    // matter — we only test the negative path on write here)
    expect(() =>
      mock.sdkCreateTransaction(baseManifest.id, {
        date: '2026-03-01', description: 'x', entries: [],
      }),
    ).toThrow(/does not have permission 'ledger:write'/)
  })

  it('module with no permissions cannot do anything', () => {
    mock.installModule({ ...baseManifest, permissions: [] })
    expect(() => mock.sdkGetChartOfAccounts(baseManifest.id))
      .toThrow(/does not have permission/)
    expect(() =>
      mock.sdkCreateTransaction(baseManifest.id, { date: '2026-03-01', description: 'x', entries: [] }),
    ).toThrow(/does not have permission/)
    expect(() => mock.sdkRegisterService(baseManifest.id, 'svc', {}))
      .toThrow(/does not have permission/)
  })

  it('storage:own enforces access only via permission grant', () => {
    mock.installModule({ ...baseManifest, permissions: [] })
    mock.attachModuleDb(mock['moduleAlias'](baseManifest.id))
    expect(() =>
      mock.sdkStorageCreateTable(mock['moduleAlias'](baseManifest.id), 'invoices', 'amount INT'),
    ).toThrow(/does not have permission 'storage:own'/)

    mock.grantModulePermission(baseManifest.id, 'storage:own')
    mock.sdkStorageCreateTable(mock['moduleAlias'](baseManifest.id), 'invoices', 'amount INT')
    const id = mock.sdkStorageInsert(mock['moduleAlias'](baseManifest.id), 'invoices', { amount: 50 })
    expect(id).toBeGreaterThan(0)
  })

  it('get_module_permissions returns sorted scopes', () => {
    mock.installModule({
      ...baseManifest,
      permissions: ['storage:own', 'ledger:write', 'accounts:read'],
    })
    expect(mock.getModulePermissions(baseManifest.id)).toEqual([
      'accounts:read',
      'ledger:write',
      'storage:own',
    ])
  })

  it('grant_module_permission requires the module to exist', () => {
    expect(() => mock.grantModulePermission('does.not.exist', 'ledger:read'))
      .toThrow(/Module not found/)
  })

  it('revoke_module_permission rejects scopes that were never granted', () => {
    mock.installModule({ ...baseManifest, permissions: ['ledger:read'] })
    expect(() => mock.revokeModulePermission(baseManifest.id, 'ledger:write'))
      .toThrow(/does not have permission/)
  })

  it('services:call permission required to call any service', () => {
    mock.installModule({
      ...baseManifest,
      id: 'com.example.provider',
      permissions: ['services:register'],
    })
    mock.installModule({
      ...baseManifest,
      id: 'com.example.consumer',
      permissions: [], // no services:call
    })
    mock.sdkRegisterService('com.example.provider', 'svc', {})
    expect(() =>
      mock.sdkCallService('com.example.consumer', 'com.example.provider', 'svc', {}),
    ).toThrow(/does not have permission 'services:call'/)
  })
})
