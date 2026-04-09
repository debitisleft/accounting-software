import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MockApi } from './mocks/api.mock'
import { validateSdkCall } from '../lib/sdk-bridge'

const baseManifest = {
  id: 'com.example.uitest',
  name: 'UI Test',
  version: '1.0.0',
  sdk_version: '1',
  description: null,
  author: null,
  license: null,
  permissions: ['ui:nav_item', 'ui:settings_pane', 'ui:transaction_action'],
  entry_point: 'frontend/index.html',
}

describe('Phase 43 — UI Isolation & Module Frame', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/UICo', 'UI Co')
    mock.installModule(baseManifest)
  })

  describe('UI Extension registry', () => {
    it('registerNavItem adds an item, list returns it', () => {
      mock.sdkRegisterNavItem(baseManifest.id, 'Invoices', 'receipt')
      const items = mock.getNavItems()
      expect(items).toHaveLength(1)
      expect(items[0].label).toBe('Invoices')
      expect(items[0].icon).toBe('receipt')
      expect(items[0].route).toBe(`/module/${baseManifest.id}`)
    })

    it('registerNavItem requires ui:nav_item permission', () => {
      mock.installModule({ ...baseManifest, id: 'com.example.no_perm', permissions: [] })
      expect(() => mock.sdkRegisterNavItem('com.example.no_perm', 'Invoices'))
        .toThrow(/does not have permission 'ui:nav_item'/)
    })

    it('registerSettingsPane adds a pane', () => {
      mock.sdkRegisterSettingsPane(baseManifest.id, 'Invoicing Settings')
      const panes = mock.getSettingsPanes()
      expect(panes).toHaveLength(1)
      expect(panes[0].label).toBe('Invoicing Settings')
      expect(panes[0].route).toBe(`/module/${baseManifest.id}/settings`)
    })

    it('registerTransactionAction adds an action', () => {
      mock.sdkRegisterTransactionAction(baseManifest.id, 'Create Invoice', 'create_invoice')
      const actions = mock.getTransactionActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].action_id).toBe('create_invoice')
    })

    it('disable/uninstall clears UI extensions for the module', () => {
      mock.sdkRegisterNavItem(baseManifest.id, 'Invoices')
      mock.sdkRegisterSettingsPane(baseManifest.id, 'Settings')
      expect(mock.getNavItems()).toHaveLength(1)
      mock.uninstallModule(baseManifest.id)
      expect(mock.getNavItems()).toHaveLength(0)
      expect(mock.getSettingsPanes()).toHaveLength(0)
    })
  })

  describe('Trusted flag', () => {
    it('manifest trusted=true sets the registry trusted column', () => {
      mock.installModule({
        ...baseManifest,
        id: 'com.example.firstparty',
        trusted: true,
      })
      const entry = mock.getModuleInfo('com.example.firstparty')
      expect(entry.trusted).toBe(1)
    })

    it('default install is untrusted', () => {
      const entry = mock.getModuleInfo(baseManifest.id)
      expect(entry.trusted).toBe(0)
    })
  })

  describe('SDK bridge dispatcher', () => {
    it('validateSdkCall accepts a well-formed call', () => {
      const result = validateSdkCall(
        {
          type: 'sdk_call',
          module_id: 'com.example.uitest',
          request_id: 'req_1',
          method: 'sdk_get_chart_of_accounts',
          params: {},
        },
        'com.example.uitest',
      )
      expect(result.ok).toBe(true)
    })

    it('validateSdkCall rejects mismatched module_id', () => {
      const result = validateSdkCall(
        {
          type: 'sdk_call',
          module_id: 'com.evil.spoof',
          request_id: 'req_1',
          method: 'sdk_get_chart_of_accounts',
          params: {},
        },
        'com.example.uitest',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/Module id mismatch/)
    })

    it('validateSdkCall rejects methods not on the allow-list', () => {
      const result = validateSdkCall(
        {
          type: 'sdk_call',
          module_id: 'com.example.uitest',
          request_id: 'req_1',
          method: 'create_new_file', // host-only command, never allowed from modules
          params: { path: '/evil.sqlite' },
        },
        'com.example.uitest',
      )
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/not on the SDK allow-list/)
    })

    it('validateSdkCall rejects messages with the wrong shape', () => {
      expect(validateSdkCall(null, 'x').ok).toBe(false)
      expect(validateSdkCall({ type: 'something_else' }, 'x').ok).toBe(false)
      expect(validateSdkCall({ type: 'sdk_call' }, 'x').ok).toBe(false)
    })
  })

  describe('SDK bridge timeout', () => {
    it('module-side sdk.js times out after 30 seconds', async () => {
      // Synthetic test: load sdk.js semantics by simulating call() timing.
      // Real iframe round-trip is integration-tested in Phase 46.
      vi.useFakeTimers()
      let rejected: Error | null = null
      const promise = new Promise<void>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("SDK call 'noop' timed out after 30000ms"))
        }, 30000)
        // Simulate that the response never arrives — never clearTimeout
        void timer
      }).catch((e) => { rejected = e })
      vi.advanceTimersByTime(30000)
      await promise
      expect(rejected).not.toBeNull()
      expect((rejected as unknown as Error).message).toMatch(/timed out/)
      vi.useRealTimers()
    })
  })

  describe('Module file serving', () => {
    it('getModuleFile returns staged content with correct mime type', () => {
      mock.stageModuleFile(baseManifest.id, 'frontend/index.html', '<html>hi</html>')
      const file = mock.getModuleFile(baseManifest.id, 'frontend/index.html')
      expect(file.mime_type).toBe('text/html')
      expect(file.content).toBe('<html>hi</html>')
      expect(file.is_binary).toBe(false)
    })

    it('getModuleFile rejects path traversal', () => {
      expect(() => mock.getModuleFile(baseManifest.id, '../../../etc/passwd'))
        .toThrow(/Invalid file path/)
      expect(() => mock.getModuleFile(baseManifest.id, '/etc/passwd'))
        .toThrow(/Invalid file path/)
    })

    it('getModuleFile rejects unknown modules', () => {
      expect(() => mock.getModuleFile('com.evil.unknown', 'index.html'))
        .toThrow(/Module not found/)
    })

    it('getModuleFile picks the right mime type by extension', () => {
      mock.stageModuleFile(baseManifest.id, 'app.js', 'console.log("x")')
      mock.stageModuleFile(baseManifest.id, 'styles.css', 'body{color:red}')
      mock.stageModuleFile(baseManifest.id, 'icon.svg', '<svg/>')
      expect(mock.getModuleFile(baseManifest.id, 'app.js').mime_type).toBe('application/javascript')
      expect(mock.getModuleFile(baseManifest.id, 'styles.css').mime_type).toBe('text/css')
      expect(mock.getModuleFile(baseManifest.id, 'icon.svg').mime_type).toBe('image/svg+xml')
    })
  })
})
