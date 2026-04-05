import Dexie, { type Table } from 'dexie'

export interface Account {
  id?: number
  code: string
  name: string
  type: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE'
  parentId?: number
  isActive: number // 1 = true, 0 = false
  createdAt: number
}

export type AccountType = Account['type']

export interface Transaction {
  id?: number
  date: string        // YYYY-MM-DD
  description: string
  createdAt: number
}

export interface JournalEntry {
  id?: number
  transactionId: number
  accountId: number
  debit: number   // integer cents
  credit: number  // integer cents
  memo?: string
}

export interface AuditLog {
  id?: number
  journalEntryId: number
  fieldChanged: string
  oldValue: string
  newValue: string
  changedAt: number
}

export interface ReconciliationPeriod {
  id?: number
  accountId: number
  periodStart: string
  periodEnd: string
  isLocked: number
  lockedAt?: number
}

export interface CategorizationRule {
  id?: number
  merchantPattern: string
  suggestedAccountId: number
  confidence: number
  timesConfirmed: number
}

export class BookkeepingDatabase extends Dexie {
  accounts!: Table<Account, number>
  transactions!: Table<Transaction, number>
  journalEntries!: Table<JournalEntry, number>
  auditLog!: Table<AuditLog, number>
  reconciliationPeriods!: Table<ReconciliationPeriod, number>
  categorizationRules!: Table<CategorizationRule, number>

  constructor(name = 'BookkeepingDB') {
    super(name)
    this.version(1).stores({
      accounts: '++id, code, type, parentId, isActive',
      transactions: '++id, date',
      journalEntries: '++id, transactionId, accountId',
      auditLog: '++id, journalEntryId, changedAt',
      reconciliationPeriods: '++id, accountId, periodStart',
      categorizationRules: '++id, merchantPattern',
    })
  }
}

export const db = new BookkeepingDatabase()
