import { accounts, type AccountType } from './schema'
import type { AppDatabase } from './connection'

interface SeedAccount {
  code: string
  name: string
  type: AccountType
}

const defaultAccounts: SeedAccount[] = [
  // ASSETS (1000–1999)
  { code: '1000', name: 'Cash', type: 'ASSET' },
  { code: '1010', name: 'Checking Account', type: 'ASSET' },
  { code: '1020', name: 'Savings Account', type: 'ASSET' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET' },
  { code: '1200', name: 'Inventory', type: 'ASSET' },
  { code: '1300', name: 'Prepaid Expenses', type: 'ASSET' },
  { code: '1500', name: 'Equipment', type: 'ASSET' },
  { code: '1510', name: 'Accumulated Depreciation', type: 'ASSET' },

  // LIABILITIES (2000–2999)
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY' },
  { code: '2100', name: 'Credit Card Payable', type: 'LIABILITY' },
  { code: '2200', name: 'Wages Payable', type: 'LIABILITY' },
  { code: '2300', name: 'Sales Tax Payable', type: 'LIABILITY' },
  { code: '2500', name: 'Notes Payable', type: 'LIABILITY' },

  // EQUITY (3000–3999)
  { code: '3000', name: 'Owner\'s Equity', type: 'EQUITY' },
  { code: '3100', name: 'Owner\'s Draws', type: 'EQUITY' },
  { code: '3200', name: 'Retained Earnings', type: 'EQUITY' },

  // REVENUE (4000–4999)
  { code: '4000', name: 'Sales Revenue', type: 'REVENUE' },
  { code: '4100', name: 'Service Revenue', type: 'REVENUE' },
  { code: '4200', name: 'Interest Income', type: 'REVENUE' },

  // EXPENSES (5000–5999)
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE' },
  { code: '5100', name: 'Rent Expense', type: 'EXPENSE' },
  { code: '5200', name: 'Utilities Expense', type: 'EXPENSE' },
  { code: '5300', name: 'Wages Expense', type: 'EXPENSE' },
  { code: '5400', name: 'Office Supplies', type: 'EXPENSE' },
  { code: '5500', name: 'Depreciation Expense', type: 'EXPENSE' },
  { code: '5600', name: 'Insurance Expense', type: 'EXPENSE' },
]

export function seedDefaultAccounts(db: AppDatabase): number {
  const existing = db.select().from(accounts).all()
  if (existing.length > 0) {
    return existing.length
  }

  for (const acct of defaultAccounts) {
    db.insert(accounts).values(acct).run()
  }

  return defaultAccounts.length
}

export { defaultAccounts }
