import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 23 — Module Foundation', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('modules table exists (list_modules returns empty list on fresh database)', () => {
    const modules = mock.listModules()
    expect(modules).toEqual([])
  })

  it('list_modules returns empty list on fresh database', () => {
    const modules = mock.listModules()
    expect(Array.isArray(modules)).toBe(true)
    expect(modules.length).toBe(0)
  })
})
