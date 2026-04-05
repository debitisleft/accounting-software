import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

/** Formats integer cents as dollar string: 15000 → "$150.00" */
function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

interface AccountWithBalance extends Account {
  balance: number
}

export function AccountsListPage({ version }: { version: number }) {
  const [accounts, setAccounts] = useState<AccountWithBalance[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const accts = await api.getAccounts()
        const withBalances = await Promise.all(
          accts.map(async (acct) => {
            const balance = await api.getAccountBalance(acct.id)
            return { ...acct, balance }
          }),
        )
        setAccounts(withBalances)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [version])

  if (error) return <div>Error: {error}</div>

  const grouped = {
    ASSET: accounts.filter((a) => a.type === 'ASSET'),
    LIABILITY: accounts.filter((a) => a.type === 'LIABILITY'),
    EQUITY: accounts.filter((a) => a.type === 'EQUITY'),
    REVENUE: accounts.filter((a) => a.type === 'REVENUE'),
    EXPENSE: accounts.filter((a) => a.type === 'EXPENSE'),
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Chart of Accounts</h2>
      {Object.entries(grouped).map(([type, accts]) => (
        <div key={type} style={{ marginBottom: '20px' }}>
          <h3 style={{ borderBottom: '2px solid #333', paddingBottom: '4px' }}>
            {type}
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Code</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {accts.map((acct) => (
                <tr key={acct.id}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
                    {acct.code}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{acct.name}</td>
                  <td
                    style={{
                      padding: '4px 8px',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                      color: acct.balance < 0 ? 'red' : 'inherit',
                    }}
                  >
                    {formatCents(acct.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
