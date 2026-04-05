import { useState } from 'react'
import { AccountsListPage } from './components/AccountsListPage'
import { JournalEntryForm } from './components/JournalEntryForm'
import { TrialBalanceReport } from './components/TrialBalance'
import { IncomeStatementReport } from './components/IncomeStatement'
import { BalanceSheetReport } from './components/BalanceSheet'
import './App.css'

type Tab = 'accounts' | 'journal' | 'trial-balance' | 'income-statement' | 'balance-sheet'

function App() {
  const [tab, setTab] = useState<Tab>('accounts')
  const [version, setVersion] = useState(0)

  const refresh = () => setVersion((v) => v + 1)

  return (
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
        {(['accounts', 'journal', 'trial-balance', 'income-statement', 'balance-sheet'] as Tab[]).map(
          (t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 16px',
                fontWeight: tab === t ? 'bold' : 'normal',
                borderBottom: tab === t ? '2px solid #333' : 'none',
              }}
            >
              {t === 'accounts'
                ? 'Accounts'
                : t === 'journal'
                  ? 'Journal Entry'
                  : t === 'trial-balance'
                    ? 'Trial Balance'
                    : t === 'income-statement'
                      ? 'Income Statement'
                      : 'Balance Sheet'}
            </button>
          ),
        )}
      </nav>

      <main>
        {tab === 'accounts' && <AccountsListPage version={version} />}
        {tab === 'journal' && <JournalEntryForm version={version} onSaved={refresh} />}
        {tab === 'trial-balance' && <TrialBalanceReport version={version} />}
        {tab === 'income-statement' && <IncomeStatementReport version={version} />}
        {tab === 'balance-sheet' && <BalanceSheetReport version={version} />}
      </main>
    </div>
  )
}

export default App
