import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

const baseManifest = {
  id: 'com.example.health',
  name: 'Health Test',
  version: '1.0.0',
  sdk_version: '1',
  description: null,
  author: null,
  license: null,
  permissions: [
    'hooks:before_write', 'events:subscribe', 'ui:nav_item',
    'services:register', 'storage:own',
  ],
  entry_point: null,
}

describe('Phase 44 — Health Monitor & Error Boundaries', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/HealthCo', 'Health Co')
    mock.installModule(baseManifest)
  })

  it('record_error increments the count and marks DEGRADED', () => {
    mock.recordError(baseManifest.id, 'something went wrong')
    const status = mock.getHealthStatus(baseManifest.id)
    expect(status.status).toBe('DEGRADED')
    expect(status.error_count).toBe(1)
    expect(status.last_error).toBe('something went wrong')
  })

  it('11 errors in the same window triggers auto-disable to FAILED', () => {
    let auto = false
    for (let i = 0; i < 11; i++) {
      auto = mock.recordError(baseManifest.id, `err ${i + 1}`)
    }
    expect(auto).toBe(true)
    const status = mock.getHealthStatus(baseManifest.id)
    expect(status.status).toBe('FAILED')
    expect(status.error_count).toBe(11)
  })

  it('errors in different windows do not accumulate', () => {
    let now = 1_000_000
    mock.healthClock = () => now
    for (let i = 0; i < 5; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.getHealthStatus(baseManifest.id).error_count).toBe(5)
    // Advance past the 5-minute window
    now += 6 * 60
    mock.recordError(baseManifest.id, 'next window')
    // Counter resets to 1 in the new window
    const status = mock.getHealthStatus(baseManifest.id)
    expect(status.error_count).toBe(1)
    expect(status.status).toBe('DEGRADED')
  })

  it('auto-disabled module has hooks unregistered', () => {
    mock.registerHook(baseManifest.id, 'before_transaction_create', () => ({ allow: true }))
    expect(mock.hookHandlers.get('before_transaction_create')?.length).toBe(1)
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.hookHandlers.get('before_transaction_create')?.length).toBe(0)
  })

  it('auto-disabled module has event subscriptions cleared', () => {
    mock.subscribeEvent(baseManifest.id, 'transaction.created', () => {})
    expect(mock.eventSubscribers.get('transaction.created')?.length).toBe(1)
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.eventSubscribers.get('transaction.created')?.length).toBe(0)
  })

  it('auto-disabled module has UI extensions hidden', () => {
    mock.sdkRegisterNavItem(baseManifest.id, 'Invoices')
    expect(mock.getNavItems()).toHaveLength(1)
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.getNavItems()).toHaveLength(0)
  })

  it('auto-disabled module is detached from kernel attached list', () => {
    const alias = 'com_example_health'
    mock.attachModuleDb(alias)
    expect(mock.attachedModules).toContain(alias)
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.attachedModules).not.toContain(alias)
  })

  it('auto-disabled module updates registry status to failed', () => {
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    const reg = mock.getModuleInfo(baseManifest.id)
    expect(reg.status).toBe('failed')
    expect(reg.error_message).toMatch(/auto-disabled/)
  })

  it('record_success resets DEGRADED back to HEALTHY', () => {
    mock.recordError(baseManifest.id, 'oops')
    expect(mock.getHealthStatus(baseManifest.id).status).toBe('DEGRADED')
    mock.recordSuccess(baseManifest.id)
    const status = mock.getHealthStatus(baseManifest.id)
    expect(status.status).toBe('HEALTHY')
    expect(status.error_count).toBe(0)
    expect(status.last_success_at).not.toBeNull()
  })

  it('record_success does not unfail a FAILED module', () => {
    for (let i = 0; i < 11; i++) mock.recordError(baseManifest.id, `e${i}`)
    expect(mock.getHealthStatus(baseManifest.id).status).toBe('FAILED')
    mock.recordSuccess(baseManifest.id)
    expect(mock.getHealthStatus(baseManifest.id).status).toBe('FAILED')
  })

  it('record_init_failure marks the module FAILED without crashing the app', () => {
    mock.recordInitFailure(baseManifest.id, 'init threw: bad migration')
    const reg = mock.getModuleInfo(baseManifest.id)
    expect(reg.status).toBe('failed')
    expect(reg.error_message).toBe('init threw: bad migration')
    // App still works
    expect(mock.getAccounts().length).toBeGreaterThan(0)
  })

  it('get_health_history returns entries newest-first', () => {
    mock.recordError(baseManifest.id, 'first')
    mock.recordError(baseManifest.id, 'second')
    mock.recordError(baseManifest.id, 'third')
    const history = mock.getHealthHistory(baseManifest.id)
    expect(history).toHaveLength(3)
    expect(history[0].message).toBe('third')
    expect(history[2].message).toBe('first')
  })

  it('get_all_health_statuses returns entries for every monitored module', () => {
    mock.installModule({ ...baseManifest, id: 'com.example.b', name: 'Bee' })
    mock.recordError(baseManifest.id, 'a-err')
    mock.recordError('com.example.b', 'b-err')
    const all = mock.getAllHealthStatuses()
    expect(all.map((s) => s.module_id)).toEqual(['com.example.b', baseManifest.id].sort())
  })

  it('manual disable + enable_module is reflected in registry', () => {
    mock.disableModule(baseManifest.id)
    expect(mock.getModuleInfo(baseManifest.id).status).toBe('disabled')
    mock.enableModule(baseManifest.id)
    expect(mock.getModuleInfo(baseManifest.id).status).toBe('active')
  })

  it('threshold and window are configurable via settings', () => {
    mock.setSetting('module_error_threshold', '3')
    mock.setSetting('module_error_window_minutes', '1')
    let auto = false
    for (let i = 0; i < 4; i++) {
      auto = mock.recordError(baseManifest.id, `e${i}`)
    }
    expect(auto).toBe(true)
    expect(mock.getHealthStatus(baseManifest.id).status).toBe('FAILED')
  })
})
