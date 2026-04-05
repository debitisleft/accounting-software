import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Account types following standard double-entry bookkeeping.
 * Normal balance side:
 *   ASSET, EXPENSE → debit
 *   LIABILITY, EQUITY, REVENUE → credit
 */
export const accountTypeEnum = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
] as const

export type AccountType = (typeof accountTypeEnum)[number]

// ── accounts ─────────────────────────────────────────────
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type', { enum: accountTypeEnum }).notNull(),
  parentId: integer('parent_id'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
})

// ── transactions (header) ────────────────────────────────
export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),            // ISO date string YYYY-MM-DD
  description: text('description').notNull(),
  createdAt: text('created_at').notNull().default('(datetime(\'now\'))'),
})

// ── journal_entries (line items) ─────────────────────────
// debit and credit are INTEGER CENTS — $1.00 = 100
export const journalEntries = sqliteTable('journal_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  transactionId: integer('transaction_id')
    .notNull()
    .references(() => transactions.id),
  accountId: integer('account_id')
    .notNull()
    .references(() => accounts.id),
  debit: integer('debit').notNull().default(0),   // cents
  credit: integer('credit').notNull().default(0), // cents
  memo: text('memo'),
})
