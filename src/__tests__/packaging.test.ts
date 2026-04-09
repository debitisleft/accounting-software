import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

const validManifest = {
  id: 'com.example.dist',
  name: 'Distribution Test',
  version: '1.0.0',
  sdk_version: '1',
  author: 'Example Corp',
  permissions: ['ledger:read', 'storage:own'],
}

const validFiles = {
  'module.json': JSON.stringify(validManifest),
  'frontend/index.html': '<html>hi</html>',
  'frontend/bundle.js': 'console.log("loaded")',
  'migrations/001_init.sql': 'CREATE TABLE invoices(id INTEGER)',
}

describe('Phase 45 — Distribution & Install Flow', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/DistCo', 'Dist Co')
  })

  it('install from valid .zip succeeds through all 10 steps', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    const r = mock.installModuleFromZip('/pkg/v1.zip')
    expect(r.success).toBe(true)
    expect(r.module_id).toBe(validManifest.id)
    expect(r.steps_completed).toEqual([
      'extract', 'validate', 'compat', 'conflicts', 'consent',
      'copy', 'register', 'migrate', 'init',
    ])
    expect(r.warnings).toContain('Module is unsigned — install at your own risk')
  })

  it('invalid manifest fails at validate', () => {
    mock.stagePackage('/pkg/bad.zip', { name: 'no id' }, {})
    const r = mock.installModuleFromZip('/pkg/bad.zip')
    expect(r.success).toBe(false)
    expect(r.steps_completed).toEqual(['extract'])
    expect(r.errors[0]).toMatch(/id cannot be empty/)
  })

  it('incompatible sdk_version fails at compat', () => {
    mock.stagePackage('/pkg/v99.zip', { ...validManifest, sdk_version: '99' }, validFiles)
    const r = mock.installModuleFromZip('/pkg/v99.zip')
    expect(r.success).toBe(false)
    expect(r.errors[0]).toMatch(/Unsupported sdk_version '99'/)
    expect(r.steps_completed).toContain('validate')
    expect(r.steps_completed).not.toContain('compat')
  })

  it('duplicate id fails at conflicts', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    mock.stagePackage('/pkg/v1-again.zip', validManifest, validFiles)
    const r = mock.installModuleFromZip('/pkg/v1-again.zip')
    expect(r.success).toBe(false)
    expect(r.errors[0]).toMatch(/already installed/)
    expect(r.steps_completed).toContain('compat')
    expect(r.steps_completed).not.toContain('conflicts')
  })

  it('install creates module file structure and registers in registry', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    // Files were copied to the module fs
    const html = mock.getModuleFile(validManifest.id, 'frontend/index.html')
    expect(html.content).toBe('<html>hi</html>')
    expect(html.mime_type).toBe('text/html')
    // Registry has the entry
    const reg = mock.getModuleInfo(validManifest.id)
    expect(reg.status).toBe('active')
    expect(reg.permissions).toEqual(['ledger:read', 'storage:own'])
  })

  it('uninstall removes the module from the registry', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    mock.uninstallModule(validManifest.id)
    expect(() => mock.getModuleInfo(validManifest.id)).toThrow(/not found/)
  })

  it('uninstall with keep_data preserves the .sqlite slot', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    mock.uninstallModule(validManifest.id, true)
    const alias = 'com_example_dist'
    expect(mock.moduleSqliteFiles.has(alias)).toBe(true)
  })

  it('update upgrades version and preserves the module store data', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    // Stash some module data
    const alias = 'com_example_dist'
    mock.attachModuleDb(alias)
    mock.moduleCreateTable(alias, 'invoices', 'amount INTEGER')
    mock.moduleInsert(alias, 'invoices', { amount: 9999 })
    expect(mock.moduleQuery(alias, 'invoices')).toHaveLength(1)

    // Now update to v1.1.0
    const v2Manifest = { ...validManifest, version: '1.1.0' }
    mock.stagePackage('/pkg/v1.1.zip', v2Manifest, {
      ...validFiles,
      'frontend/bundle.js': 'console.log("v1.1")',
    })
    const updated = mock.updateModule(validManifest.id, '/pkg/v1.1.zip')
    expect(updated.version).toBe('1.1.0')
    // Data preserved
    expect(mock.moduleQuery(alias, 'invoices')).toHaveLength(1)
    // New frontend file is in place
    const js = mock.getModuleFile(validManifest.id, 'frontend/bundle.js')
    expect(js.content).toBe('console.log("v1.1")')
  })

  it('check_module_updates compares semver correctly', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    mock.stagePackage('/pkg/v1.0.1.zip', { ...validManifest, version: '1.0.1' }, validFiles)
    const cmp = mock.checkModuleUpdates(validManifest.id, '/pkg/v1.0.1.zip')
    expect(cmp.installed_version).toBe('1.0.0')
    expect(cmp.new_version).toBe('1.0.1')
    expect(cmp.is_newer).toBe(true)

    mock.stagePackage('/pkg/older.zip', { ...validManifest, version: '0.9.0' }, validFiles)
    const cmp2 = mock.checkModuleUpdates(validManifest.id, '/pkg/older.zip')
    expect(cmp2.is_newer).toBe(false)
  })

  it('validate_module_package returns a report without installing', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    const r = mock.validateModulePackage('/pkg/v1.zip')
    expect(r.valid).toBe(true)
    expect(r.warnings).toContain('Module is unsigned')
    // Not installed
    expect(() => mock.getModuleInfo(validManifest.id)).toThrow(/not found/)
  })

  it('validate_module_package surfaces a conflict warning when already installed', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    mock.stagePackage('/pkg/v1-again.zip', validManifest, validFiles)
    const r = mock.validateModulePackage('/pkg/v1-again.zip')
    expect(r.valid).toBe(true) // structural validity unchanged
    expect(r.warnings.some((w) => /already installed/.test(w))).toBe(true)
  })

  it('export_module_package re-packages the installed module', () => {
    mock.stagePackage('/pkg/v1.zip', validManifest, validFiles)
    mock.installModuleFromZip('/pkg/v1.zip')
    const out = mock.exportModulePackage(validManifest.id, '/exports/dist.zip')
    expect(out).toBe('/exports/dist.zip')
    const repkg = mock.packageStore.get('/exports/dist.zip')
    expect(repkg).toBeTruthy()
    expect((repkg!.manifest as { id: string }).id).toBe(validManifest.id)
  })

  it('signed module with trusted key verifies successfully', () => {
    mock.addTrustedKey('Example Corp', 'sig-good')
    mock.stagePackage('/pkg/signed.zip', validManifest, validFiles, 'sig-good')
    const r = mock.installModuleFromZip('/pkg/signed.zip')
    expect(r.success).toBe(true)
    expect(r.steps_completed).toContain('verify')
    expect(r.warnings).not.toContain('Module is unsigned — install at your own risk')
  })

  it('signed module with mismatched signature is rejected', () => {
    mock.addTrustedKey('Example Corp', 'sig-good')
    mock.stagePackage('/pkg/bad-sig.zip', validManifest, validFiles, 'sig-bad')
    const r = mock.installModuleFromZip('/pkg/bad-sig.zip')
    expect(r.success).toBe(false)
    expect(r.errors[0]).toMatch(/Signature verification failed/)
  })

  it('unsigned module shows a warning but still installs', () => {
    mock.stagePackage('/pkg/unsigned.zip', validManifest, validFiles)
    const r = mock.installModuleFromZip('/pkg/unsigned.zip')
    expect(r.success).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/unsigned/)
  })
})
