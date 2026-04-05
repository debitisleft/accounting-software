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

function App() {
  const [page, setPage] = useState<Page>('dashboard')
  const [version, setVersion] = useState(0)

  const refresh = () => setVersion((v) => v + 1)

  return (
    <AppShell activePage={page} onNavigate={setPage}>
      {page === 'dashboard' && <Dashboard version={version} />}
      {page === 'accounts' && <AccountsListPage version={version} />}
      {page === 'journal' && <JournalEntryForm version={version} onSaved={refresh} />}
      {page === 'register' && <TransactionRegister version={version} />}
      {page === 'trial-balance' && <TrialBalanceReport version={version} />}
      {page === 'income-statement' && <IncomeStatementReport version={version} />}
      {page === 'balance-sheet' && <BalanceSheetReport version={version} />}
      {page === 'settings' && <SettingsPage version={version} />}
    </AppShell>
  )
}

export default App
