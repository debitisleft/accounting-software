import Database from 'better-sqlite3'
import { getTableName } from 'drizzle-orm'
import { accounts, transactions, journalEntries } from './schema'

/**
 * Creates all tables from schema using raw SQL.
 * Uses IF NOT EXISTS so it's safe to call multiple times.
 */
export function migrateDatabase(sqlite: Database.Database): void {
  const accountsTable = getTableName(accounts)
  const transactionsTable = getTableName(transactions)
  const entriesTable = getTableName(journalEntries)

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ${accountsTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
      parent_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${transactionsTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ${entriesTable} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL REFERENCES ${transactionsTable}(id),
      account_id INTEGER NOT NULL REFERENCES ${accountsTable}(id),
      debit INTEGER NOT NULL DEFAULT 0,
      credit INTEGER NOT NULL DEFAULT 0,
      memo TEXT,
      CHECK(debit >= 0),
      CHECK(credit >= 0)
    );
  `)
}
