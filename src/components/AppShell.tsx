import { useState, type ReactNode } from 'react'

export type Page =
  | 'dashboard'
  | 'journal'
  | 'register'
  | 'accounts'
  | 'trial-balance'
  | 'income-statement'
  | 'balance-sheet'
  | 'opening-balances'
  | 'settings'

interface SidebarItem {
  id: Page
  label: string
}

interface SidebarSection {
  title: string
  items: SidebarItem[]
}

const sections: SidebarSection[] = [
  {
    title: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard' }],
  },
  {
    title: 'Transactions',
    items: [
      { id: 'journal', label: 'Journal Entry' },
      { id: 'register', label: 'Register' },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { id: 'accounts', label: 'Chart of Accounts' },
      { id: 'opening-balances', label: 'Opening Balances' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { id: 'trial-balance', label: 'Trial Balance' },
      { id: 'income-statement', label: 'Income Statement' },
      { id: 'balance-sheet', label: 'Balance Sheet' },
    ],
  },
]

const sidebarExpanded = 220
const sidebarCollapsed = 52

/** Short label for collapsed sidebar */
const shortLabels: Record<Page, string> = {
  dashboard: 'D',
  journal: 'JE',
  register: 'R',
  accounts: 'A',
  'trial-balance': 'TB',
  'income-statement': 'IS',
  'balance-sheet': 'BS',
  'opening-balances': 'OB',
  settings: 'S',
}

export function AppShell({
  activePage,
  onNavigate,
  onCloseFile,
  children,
}: {
  activePage: Page
  onNavigate: (page: Page) => void
  onCloseFile?: () => void
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(false)
  const width = collapsed ? sidebarCollapsed : sidebarExpanded

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      {/* Sidebar */}
      <nav
        style={{
          width,
          minWidth: width,
          backgroundColor: '#1a1a2e',
          color: '#e0e0e0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.15s ease',
        }}
      >
        <div
          style={{
            padding: collapsed ? '16px 8px' : '16px',
            borderBottom: '1px solid #333',
            fontWeight: 'bold',
            fontSize: collapsed ? '14px' : '16px',
            color: '#fff',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          {collapsed ? 'B' : 'Bookkeeping'}
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '14px',
              padding: '2px',
            }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '\u25B6' : '\u25C0'}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {sections.map((section) => (
            <div key={section.title} style={{ marginBottom: '8px' }}>
              {!collapsed && (
                <div
                  style={{
                    padding: '4px 16px',
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#888',
                    fontWeight: 600,
                  }}
                >
                  {section.title}
                </div>
              )}
              {section.items.map((item) => {
                const isActive = activePage === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: collapsed ? 'center' : 'left',
                      padding: collapsed ? '8px 4px' : '8px 16px',
                      border: 'none',
                      background: isActive ? '#16213e' : 'transparent',
                      color: isActive ? '#fff' : '#ccc',
                      fontSize: '13px',
                      cursor: 'pointer',
                      borderLeft: isActive ? '3px solid #4a90d9' : '3px solid transparent',
                    }}
                  >
                    {collapsed ? shortLabels[item.id] : item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Settings at bottom */}
        <div style={{ borderTop: '1px solid #333' }}>
          <button
            onClick={() => onNavigate('settings')}
            title={collapsed ? 'Settings' : undefined}
            style={{
              display: 'block',
              width: '100%',
              textAlign: collapsed ? 'center' : 'left',
              padding: collapsed ? '12px 4px' : '12px 16px',
              border: 'none',
              background: activePage === 'settings' ? '#16213e' : 'transparent',
              color: activePage === 'settings' ? '#fff' : '#ccc',
              fontSize: '13px',
              cursor: 'pointer',
              borderLeft: activePage === 'settings' ? '3px solid #4a90d9' : '3px solid transparent',
            }}
          >
            {collapsed ? 'S' : 'Settings'}
          </button>
          {onCloseFile && (
            <button
              onClick={onCloseFile}
              title={collapsed ? 'Close File' : undefined}
              style={{
                display: 'block',
                width: '100%',
                textAlign: collapsed ? 'center' : 'left',
                padding: collapsed ? '10px 4px' : '10px 16px',
                border: 'none',
                background: 'transparent',
                color: '#888',
                fontSize: '12px',
                cursor: 'pointer',
                borderLeft: '3px solid transparent',
              }}
            >
              {collapsed ? 'X' : 'Close File'}
            </button>
          )}
        </div>
      </nav>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          backgroundColor: '#fafafa',
        }}
      >
        {children}
      </main>
    </div>
  )
}
