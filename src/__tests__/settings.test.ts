import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 15 — Settings & Preferences', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('get_setting returns default for seeded key', () => {
    expect(mock.getSetting('company_name')).toBe('My Company')
    expect(mock.getSetting('currency_symbol')).toBe('$')
    expect(mock.getSetting('fiscal_year_start_month')).toBe('1')
  })

  it('get_setting returns null for unset key', () => {
    expect(mock.getSetting('nonexistent_key')).toBeNull()
  })

  it('set + get roundtrips correctly', () => {
    mock.setSetting('company_name', 'Acme Corp')
    expect(mock.getSetting('company_name')).toBe('Acme Corp')

    mock.setSetting('currency_symbol', '€')
    expect(mock.getSetting('currency_symbol')).toBe('€')
  })

  it('get_all_settings returns complete map', () => {
    const settings = mock.getAllSettings()
    expect(settings.company_name).toBe('My Company')
    expect(settings.fiscal_year_start_month).toBe('1')
    expect(settings.currency_symbol).toBe('$')
    expect(settings.date_format).toBe('YYYY-MM-DD')
    expect(Object.keys(settings).length).toBeGreaterThanOrEqual(4)
  })

  it('set_setting overwrites existing value', () => {
    mock.setSetting('date_format', 'DD/MM/YYYY')
    expect(mock.getSetting('date_format')).toBe('DD/MM/YYYY')
    const all = mock.getAllSettings()
    expect(all.date_format).toBe('DD/MM/YYYY')
  })
})
