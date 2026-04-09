import { describe, it, expect, beforeEach } from 'vitest'
import { MockApi } from './mocks/api.mock'

describe('Phase 39 — Migration Coordinator', () => {
  let mock: MockApi

  beforeEach(() => {
    mock = new MockApi()
    mock.createNewFile('/tmp/MigrationCo', 'Migration Co')
  })

  it('register + run migrations records all in migration_log', () => {
    const result = mock.runModuleMigrations('invoicing') // no pending
    expect(result.applied).toEqual([])

    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'init', sql: 'CREATE TABLE invoices(id INT)', checksum: 'abc' },
      { version: 2, description: 'add status', sql: 'ALTER TABLE invoices ADD status TEXT', checksum: 'def' },
    ])

    const run = mock.runModuleMigrations('invoicing')
    expect(run.applied).toEqual([1, 2])
    expect(run.failed).toBeNull()

    const status = mock.getMigrationStatus('invoicing')
    expect(status[0].latest_version).toBe(2)
    expect(status[0].applied_count).toBe(2)
    expect(status[0].pending_count).toBe(0)
    expect(status[0].failed_count).toBe(0)
  })

  it('checksum mismatch detected when re-registering an applied migration', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'init', sql: 'CREATE TABLE x(id INT)', checksum: 'abc' },
    ])
    mock.runModuleMigrations('invoicing')

    expect(() =>
      mock.registerModuleMigrations('invoicing', [
        { version: 1, description: 'init', sql: 'CREATE TABLE x(id INT)', checksum: 'TAMPERED' },
      ]),
    ).toThrow(/Checksum mismatch/)
  })

  it('migrations run in version order even when registered out-of-order', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 3, description: 'v3', sql: 'CREATE TABLE c(id INT)', checksum: 'c' },
      { version: 1, description: 'v1', sql: 'CREATE TABLE a(id INT)', checksum: 'a' },
      { version: 2, description: 'v2', sql: 'CREATE TABLE b(id INT)', checksum: 'b' },
    ])
    const run = mock.runModuleMigrations('invoicing')
    expect(run.applied).toEqual([1, 2, 3])
  })

  it('failed migration stops execution and records error', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'good', sql: 'CREATE TABLE a(id INT)', checksum: 'a' },
      { version: 2, description: 'bad', sql: 'FAIL_MIGRATION', checksum: 'b' },
      { version: 3, description: 'never runs', sql: 'CREATE TABLE c(id INT)', checksum: 'c' },
    ])
    const run = mock.runModuleMigrations('invoicing')
    expect(run.applied).toEqual([1])
    expect(run.failed).toBe(2)
    expect(run.error).toMatch(/simulated failure/)

    const status = mock.getMigrationStatus('invoicing')
    expect(status[0].latest_version).toBe(1)
    expect(status[0].failed_count).toBe(1)
    expect(status[0].pending_count).toBe(2) // v2 and v3 still pending
    expect(status[0].last_error).toMatch(/simulated failure/)
  })

  it('dependency enforcement — module B waits for A', () => {
    mock.registerModuleDependency('payroll', 'invoicing', 1)
    mock.registerModuleMigrations('payroll', [
      { version: 1, description: 'init', sql: 'CREATE TABLE p(id INT)', checksum: 'p1' },
    ])

    expect(() => mock.runModuleMigrations('payroll')).toThrow(/Dependency not satisfied/)

    // Now satisfy the dependency
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'init', sql: 'CREATE TABLE i(id INT)', checksum: 'i1' },
    ])
    mock.runModuleMigrations('invoicing')
    const result = mock.runModuleMigrations('payroll')
    expect(result.applied).toEqual([1])
  })

  it('circular dependency detected and rejected', () => {
    mock.registerModuleDependency('a', 'b')
    mock.registerModuleDependency('b', 'c')
    expect(() => mock.registerModuleDependency('c', 'a')).toThrow(/Circular dependency/)
    // Verify the bad insert was rolled back
    expect(mock.moduleDependencies.find((d) => d.module_id === 'c')).toBeUndefined()
  })

  it('check_dependency_graph returns topological order', () => {
    mock.registerModuleDependency('payroll', 'invoicing')
    mock.registerModuleDependency('reports', 'payroll')
    const order = mock.checkDependencyGraph()
    // invoicing must come before payroll, payroll before reports
    expect(order.indexOf('invoicing')).toBeLessThan(order.indexOf('payroll'))
    expect(order.indexOf('payroll')).toBeLessThan(order.indexOf('reports'))
  })

  it('get_migration_status returns correct pending/applied counts', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'v1', sql: 'CREATE TABLE a(id INT)', checksum: 'a' },
      { version: 2, description: 'v2', sql: 'CREATE TABLE b(id INT)', checksum: 'b' },
      { version: 3, description: 'v3', sql: 'CREATE TABLE c(id INT)', checksum: 'c' },
    ])
    let status = mock.getMigrationStatus('invoicing')
    expect(status[0].pending_count).toBe(3)
    expect(status[0].applied_count).toBe(0)

    mock.runModuleMigrations('invoicing')
    status = mock.getMigrationStatus('invoicing')
    expect(status[0].pending_count).toBe(0)
    expect(status[0].applied_count).toBe(3)
  })

  it('kernel migrations recorded retroactively in migration_log', () => {
    const status = mock.getMigrationStatus('kernel')
    expect(status).toHaveLength(1)
    expect(status[0].module_id).toBe('kernel')
    expect(status[0].applied_count).toBeGreaterThanOrEqual(8)
    expect(status[0].latest_version).toBeGreaterThanOrEqual(8)
  })

  it('get_migration_status with no module returns all modules', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'init', sql: 'CREATE TABLE a(id INT)', checksum: 'a' },
    ])
    mock.runModuleMigrations('invoicing')
    const all = mock.getMigrationStatus()
    const ids = all.map((s) => s.module_id)
    expect(ids).toContain('kernel')
    expect(ids).toContain('invoicing')
  })

  it('re-running migrations is idempotent (skips already-applied)', () => {
    mock.registerModuleMigrations('invoicing', [
      { version: 1, description: 'v1', sql: 'CREATE TABLE a(id INT)', checksum: 'a' },
    ])
    mock.runModuleMigrations('invoicing')
    const second = mock.runModuleMigrations('invoicing')
    expect(second.applied).toEqual([]) // nothing left to do
    const status = mock.getMigrationStatus('invoicing')
    expect(status[0].applied_count).toBe(1)
  })

  it('failed migration on one module does not prevent another module from migrating', () => {
    // Module A fails
    mock.registerModuleMigrations('alpha', [
      { version: 1, description: 'bad', sql: 'FAIL_MIGRATION', checksum: 'a1' },
    ])
    const aResult = mock.runModuleMigrations('alpha')
    expect(aResult.failed).toBe(1)

    // Module B (independent) still works
    mock.registerModuleMigrations('beta', [
      { version: 1, description: 'good', sql: 'CREATE TABLE b(id INT)', checksum: 'b1' },
    ])
    const bResult = mock.runModuleMigrations('beta')
    expect(bResult.applied).toEqual([1])
    expect(bResult.failed).toBeNull()
  })

  it('module cannot depend on itself', () => {
    expect(() => mock.registerModuleDependency('invoicing', 'invoicing'))
      .toThrow(/cannot depend on itself/)
  })
})
