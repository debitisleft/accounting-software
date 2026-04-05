import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi, defaultSeedAccounts } from './mocks/api.mock'

describe('Phase 13 — Backup & Restore', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.seedAccounts(defaultSeedAccounts)
  })

  it('export creates valid result with path and size', () => {
    const result = mock.exportDatabase('/tmp/backup.db')
    expect(result.path).toBe('/tmp/backup.db')
    expect(result.size).toBeGreaterThan(0)
  })

  it('import returns correct counts', () => {
    const cash = mock.getAccounts().find((a) => a.code === '1000')!
    const equity = mock.getAccounts().find((a) => a.code === '3000')!
    mock.createTransaction({ date: '2026-01-01', description: 'Test', entries: [
      { account_id: cash.id, debit: 100000, credit: 0 },
      { account_id: equity.id, debit: 0, credit: 100000 },
    ]})

    const result = mock.importDatabase('/tmp/valid.db')
    expect(result.account_count).toBe(26)
    expect(result.transaction_count).toBe(1)
  })

  it('import rejects corrupt files', () => {
    expect(() => mock.importDatabase('/tmp/corrupt-file.db')).toThrow('Invalid database')
  })

  it('auto_backup creates file in backups dir', () => {
    const result = mock.autoBackup()
    expect(result.path).toContain('bookkeeping-')
    expect(result.backup_count).toBe(1)

    const backups = mock.listBackups()
    expect(backups.length).toBe(1)
  })

  it('auto_backup keeps only 5 most recent', () => {
    for (let i = 0; i < 8; i++) {
      mock.autoBackup()
    }
    const backups = mock.listBackups()
    expect(backups.length).toBe(5)
  })
})
