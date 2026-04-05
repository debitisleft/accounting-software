import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 18 — File-Based Architecture', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
  })

  it('create_new_file creates valid file with expected accounts', () => {
    const info = mock.createNewFile('/tmp/test.sqlite', 'Test Corp')
    expect(info.path).toBe('/tmp/test.sqlite')
    expect(info.company_name).toBe('Test Corp')
    expect(mock.isFileOpen()).toBe(true)
    expect(mock.getAccounts().length).toBeGreaterThanOrEqual(20)
  })

  it('create_new_file seeds default chart of accounts', () => {
    mock.createNewFile('/tmp/test.sqlite', 'Test Corp')
    const accounts = mock.getAccounts()
    const types = new Set(accounts.map((a) => a.type))
    expect(types).toContain('ASSET')
    expect(types).toContain('LIABILITY')
    expect(types).toContain('EQUITY')
    expect(types).toContain('REVENUE')
    expect(types).toContain('EXPENSE')
  })

  it('create_new_file stores company_name in settings', () => {
    mock.createNewFile('/tmp/test.sqlite', 'Acme Inc')
    expect(mock.getSetting('company_name')).toBe('Acme Inc')
  })

  it('open_file succeeds on valid file', () => {
    mock.createNewFile('/tmp/test.sqlite', 'Test Corp')
    mock.closeFile()
    expect(mock.isFileOpen()).toBe(false)
    const info = mock.openFile('/tmp/test.sqlite')
    expect(info.path).toBe('/tmp/test.sqlite')
    expect(mock.isFileOpen()).toBe(true)
  })

  it('open_file rejects files that are missing', () => {
    expect(() => mock.openFile('/tmp/missing-file.sqlite')).toThrow('File not found')
  })

  it('all existing commands return error when no file is open', () => {
    expect(mock.isFileOpen()).toBe(false)
    expect(() => mock.getAccounts()).toThrow('No file is open')
  })

  it('close_file + open_file switches between files correctly', () => {
    // Create and use file 1
    mock.createNewFile('/tmp/company1.sqlite', 'Company One')
    mock.createTransaction({ date: '2026-01-01', description: 'Tx in company 1', entries: [
      { account_id: mock.getAccounts().find((a) => a.code === '1000')!.id, debit: 100000, credit: 0 },
      { account_id: mock.getAccounts().find((a) => a.code === '3000')!.id, debit: 0, credit: 100000 },
    ]})
    expect(mock.transactions.length).toBe(1)

    // Close file
    mock.closeFile()
    expect(mock.isFileOpen()).toBe(false)

    // Create file 2 — fresh data
    mock.createNewFile('/tmp/company2.sqlite', 'Company Two')
    expect(mock.transactions.length).toBe(0) // no transactions in new file
    expect(mock.getSetting('company_name')).toBe('Company Two')
  })

  it('recent files list updates on open and persists', () => {
    mock.createNewFile('/tmp/file1.sqlite', 'File One')
    mock.closeFile()
    mock.createNewFile('/tmp/file2.sqlite', 'File Two')

    const recent = mock.getRecentFiles()
    expect(recent.length).toBe(2)
    expect(recent[0].path).toBe('/tmp/file2.sqlite') // most recent first
    expect(recent[1].path).toBe('/tmp/file1.sqlite')
  })

  it('remove_recent_file removes entry from list', () => {
    mock.createNewFile('/tmp/file1.sqlite', 'File One')
    mock.closeFile()
    mock.createNewFile('/tmp/file2.sqlite', 'File Two')

    mock.removeRecentFile('/tmp/file1.sqlite')
    const recent = mock.getRecentFiles()
    expect(recent.length).toBe(1)
    expect(recent[0].path).toBe('/tmp/file2.sqlite')
  })
})
