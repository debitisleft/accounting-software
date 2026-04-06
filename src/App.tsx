import { useState } from 'react'
import { AppShell, type Page } from './components/AppShell'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Dashboard } from './components/Dashboard'
import { AccountsListPage } from './components/AccountsListPage'
import { JournalEntryForm } from './components/JournalEntryForm'
import { TrialBalanceReport } from './components/TrialBalance'
import { IncomeStatementReport } from './components/IncomeStatement'
import { BalanceSheetReport } from './components/BalanceSheet'
import { TransactionRegister } from './components/TransactionRegister'
import { SettingsPage } from './components/SettingsPage'
import { AccountLedger } from './components/AccountLedger'
import { OpeningBalancesWizard } from './components/OpeningBalancesWizard'
import { FiscalYearClose } from './components/FiscalYearClose'
import { CashFlowStatementReport } from './components/CashFlowStatement'
import { CsvImport } from './components/CsvImport'
import { api } from './lib/api'

function App() {
  const [fileOpen, setFileOpen] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')
  const [version, setVersion] = useState(0)
  const [ledgerAccountId, setLedgerAccountId] = useState<string | null>(null)

  const refresh = () => setVersion((v) => v + 1)

  const openLedger = (accountId: string) => {
    setLedgerAccountId(accountId)
    setPage('accounts')
  }

  const handleCloseFile = async () => {
    await api.closeFile()
    setFileOpen(false)
    setPage('dashboard')
    setLedgerAccountId(null)
  }

  if (!fileOpen) {
    return <WelcomeScreen onFileOpened={() => { setFileOpen(true); setPage('dashboard'); refresh() }} />
  }

  return (
    <AppShell activePage={page} onNavigate={(p) => { setPage(p); setLedgerAccountId(null) }} onCloseFile={handleCloseFile}>
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
      {page === 'csv-import' && <CsvImport version={version} onImported={refresh} />}
      {page === 'cash-flow' && <CashFlowStatementReport version={version} />}
      {page === 'opening-balances' && <OpeningBalancesWizard version={version} onSaved={refresh} />}
      {page === 'fiscal-year-close' && <FiscalYearClose version={version} />}
      {page === 'settings' && <SettingsPage version={version} />}
    </AppShell>
  )
}

export default App
