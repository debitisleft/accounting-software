import { useState } from 'react'
import { DatabaseProvider } from './db/DatabaseProvider'
import { AccountsListPage } from './components/AccountsListPage'
import { JournalEntryForm } from './components/JournalEntryForm'
import { TrialBalanceReport } from './components/TrialBalance'
import { IncomeStatementReport } from './components/IncomeStatement'
import { BalanceSheetReport } from './components/BalanceSheet'
import './App.css'

type Tab = 'accounts' | 'journal' | 'trial-balance' | 'income-statement' | 'balance-sheet'

function App() {
  const [tab, setTab] = useState<Tab>('accounts')

  return (
    <DatabaseProvider>
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <nav
          style={{
            display: 'flex',
            gap: '8px',
            padding: '12px 20px',
            borderBottom: '2px solid #333',
            backgroundColor: '#f8f8f8',
          }}
        >
          <h1 style={{ margin: 0, marginRight: '24px', fontSize: '20px' }}>
            Bookkeeping
          </h1>
          <button
            onClick={() => setTab('accounts')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'accounts' ? 'bold' : 'normal',
              borderBottom: tab === 'accounts' ? '2px solid #333' : 'none',
            }}
          >
            Accounts
          </button>
          <button
            onClick={() => setTab('journal')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'journal' ? 'bold' : 'normal',
              borderBottom: tab === 'journal' ? '2px solid #333' : 'none',
            }}
          >
            Journal Entry
          </button>
          <button
            onClick={() => setTab('trial-balance')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'trial-balance' ? 'bold' : 'normal',
              borderBottom: tab === 'trial-balance' ? '2px solid #333' : 'none',
            }}
          >
            Trial Balance
          </button>
          <button
            onClick={() => setTab('income-statement')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'income-statement' ? 'bold' : 'normal',
              borderBottom: tab === 'income-statement' ? '2px solid #333' : 'none',
            }}
          >
            Income Statement
          </button>
          <button
            onClick={() => setTab('balance-sheet')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'balance-sheet' ? 'bold' : 'normal',
              borderBottom: tab === 'balance-sheet' ? '2px solid #333' : 'none',
            }}
          >
            Balance Sheet
          </button>
        </nav>

        <main>
          {tab === 'accounts' && <AccountsListPage />}
          {tab === 'journal' && <JournalEntryForm />}
          {tab === 'trial-balance' && <TrialBalanceReport />}
          {tab === 'income-statement' && <IncomeStatementReport />}
          {tab === 'balance-sheet' && <BalanceSheetReport />}
        </main>
      </div>
    </DatabaseProvider>
  )
}

export default App
