import { useState } from 'react'
import { DatabaseProvider } from './db/DatabaseProvider'
import { AccountsListPage } from './components/AccountsListPage'
import { JournalEntryForm } from './components/JournalEntryForm'
import './App.css'

type Tab = 'accounts' | 'journal' | 'reports'

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
            onClick={() => setTab('reports')}
            style={{
              padding: '6px 16px',
              fontWeight: tab === 'reports' ? 'bold' : 'normal',
              borderBottom: tab === 'reports' ? '2px solid #333' : 'none',
            }}
          >
            Reports
          </button>
        </nav>

        <main>
          {tab === 'accounts' && <AccountsListPage />}
          {tab === 'journal' && <JournalEntryForm />}
          {tab === 'reports' && (
            <div style={{ padding: '20px' }}>
              <p>Reports will be available in Phase 6.</p>
            </div>
          )}
        </main>
      </div>
    </DatabaseProvider>
  )
}

export default App
