import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

export function createDatabase(path: string = 'bookkeeping.db') {
  const sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  return { db, sqlite }
}

/** Works with both better-sqlite3 and sql.js Drizzle instances */
export type AppDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>
