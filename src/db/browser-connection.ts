import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { drizzle } from 'drizzle-orm/sql-js'
import * as schema from './schema'
import { getTableName } from 'drizzle-orm'
import { accounts, transactions, journalEntries } from './schema'

/**
 * Creates an in-browser SQLite database using sql.js (WASM).
 * Uses the same Drizzle schema as the Node backend.
 */
export async function createBrowserDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  })

  const sqlite = new SQL.Database()

  // Run migrations manually (same SQL as migrate.ts)
  const accountsTable = getTableName(accounts)
  const transactionsTable = getTableName(transactions)
  const entriesTable = getTableName(journalEntries)

  sqlite.run(`
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

  const db = drizzle(sqlite, { schema })

  return { db, sqlite }
}

export type BrowserDatabase = Awaited<ReturnType<typeof createBrowserDatabase>>['db']
