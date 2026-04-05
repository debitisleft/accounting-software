import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../db/schema'
import { migrateDatabase } from '../db/migrate'
import { seedDefaultAccounts } from '../db/seed'
import { accounts } from '../db/schema'

describe('database schema and seed', () => {
  let db: ReturnType<typeof drizzle>

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    migrateDatabase(sqlite)
    db = drizzle(sqlite, { schema })
  })

  it('creates all three tables', () => {
    const sqlite = (db as any)
    // If tables exist, selects will not throw
    db.select().from(accounts).all()
    db.select().from(schema.transactions).all()
    db.select().from(schema.journalEntries).all()
  })

  it('seeds at least 20 default accounts', () => {
    const count = seedDefaultAccounts(db)
    expect(count).toBeGreaterThanOrEqual(20)

    const allAccounts = db.select().from(accounts).all()
    expect(allAccounts.length).toBeGreaterThanOrEqual(20)
  })

  it('seeds accounts with all five types', () => {
    seedDefaultAccounts(db)
    const allAccounts = db.select().from(accounts).all()

    const types = new Set(allAccounts.map((a) => a.type))
    expect(types).toContain('ASSET')
    expect(types).toContain('LIABILITY')
    expect(types).toContain('EQUITY')
    expect(types).toContain('REVENUE')
    expect(types).toContain('EXPENSE')
  })

  it('stores monetary amounts as integers (cents)', () => {
    seedDefaultAccounts(db)

    // Insert a transaction with journal entries
    const txResult = db
      .insert(schema.transactions)
      .values({ date: '2026-01-15', description: 'Test transaction' })
      .returning()
      .get()

    const cashAccount = db.select().from(accounts).all()
      .find((a) => a.code === '1000')!

    const revenueAccount = db.select().from(accounts).all()
      .find((a) => a.code === '4000')!

    // $150.00 = 15000 cents
    db.insert(schema.journalEntries)
      .values({
        transactionId: txResult.id,
        accountId: cashAccount.id,
        debit: 15000,
        credit: 0,
      })
      .run()

    db.insert(schema.journalEntries)
      .values({
        transactionId: txResult.id,
        accountId: revenueAccount.id,
        debit: 0,
        credit: 15000,
      })
      .run()

    const entries = db.select().from(schema.journalEntries).all()
    expect(entries[0].debit).toBe(15000)
    expect(entries[1].credit).toBe(15000)
    // Confirm they are integers, not floats
    expect(Number.isInteger(entries[0].debit)).toBe(true)
    expect(Number.isInteger(entries[1].credit)).toBe(true)
  })

  it('does not re-seed if accounts already exist', () => {
    seedDefaultAccounts(db)
    const countAfterFirst = db.select().from(accounts).all().length

    seedDefaultAccounts(db)
    const countAfterSecond = db.select().from(accounts).all().length

    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('enforces non-negative debit and credit via CHECK constraint', () => {
    seedDefaultAccounts(db)

    const txResult = db
      .insert(schema.transactions)
      .values({ date: '2026-01-15', description: 'Bad entry' })
      .returning()
      .get()

    const cashAccount = db.select().from(accounts).all()
      .find((a) => a.code === '1000')!

    expect(() => {
      db.insert(schema.journalEntries)
        .values({
          transactionId: txResult.id,
          accountId: cashAccount.id,
          debit: -100,
          credit: 0,
        })
        .run()
    }).toThrow()
  })
})
