import { useState } from 'react'
import { AppShell, type Page } from './components/AppShell'
import { Dashboard } from './components/Dashboard'
import { AccountsListPage } from './components/AccountsListPage'
import { JournalEntryForm } from './components/JournalEntryForm'
import { TrialBalanceReport } from './components/TrialBalance'
import { IncomeStatementReport } from './components/IncomeStatement'
import { BalanceSheetReport } from './components/BalanceSheet'
import { TransactionRegister } from './components/TransactionRegister'
import { SettingsPage } from './components/SettingsPage'
import { AccountLedger } from './components/AccountLedger'

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [version, setVersion] = useState(0)
  const [ledgerAccountId, setLedgerAccountId] = useState<string | null>(null)

  const refresh = () => setVersion((v) => v + 1)

  const openLedger = (accountId: string) => {
    setLedgerAccountId(accountId)
    setPage('accounts') // Keep sidebar highlighting on accounts
  }

  return (
    <AppShell activePage={page} onNavigate={(p) => { setPage(p); setLedgerAccountId(null) }}>
      {page === 'dashboard' && <Dashboard version={version} />}
      {page === 'accounts' && !ledgerAccountId && <AccountsListPage version={version} />}
      {page === 'accounts' && ledgerAccountId && (
        <AccountLedger accountId={ledgerAccountId} version={version} onBack={() => setLedgerAccountId(null)} />
      )}
      {page === 'journal' && <JournalEntryForm version={version} onSaved={refresh} />}
      {page === 'register' && <TransactionRegister version={version} />}
      {page === 'trial-balance' && <TrialBalanceReport version={version} onDrillDown={openLedger} />}
      {page === 'income-statement' && <IncomeStatementReport version={version} />}
      {page === 'balance-sheet' && <BalanceSheetReport version={version} />}
      {page === 'settings' && <SettingsPage version={version} />}
    </AppShell>
  )
}

export default App
