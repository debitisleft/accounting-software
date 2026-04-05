import { useState, useEffect } from 'react'
import { useDatabase } from '../db/DatabaseProvider'
import { getAccountBalance } from '../lib/accounting'
import type { AccountBalance } from '../lib/accounting'

/** Formats integer cents as dollar string: 15000 → "$150.00" */
function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function AccountsListPage() {
  const { db, isLoading, error, version } = useDatabase()
  const [balances, setBalances] = useState<AccountBalance[]>([])

  useEffect(() => {
    if (!db) return
    ;(async () => {
      const allAccounts = await db.accounts.toArray()
      const results = await Promise.all(
        allAccounts.map((acct) => getAccountBalance(db, acct.id!)),
      )
      setBalances(results)
    })()
  }, [db, version])

  if (isLoading) return <div>Loading database...</div>
  if (error) return <div>Error: {error}</div>
  if (!db) return <div>Database not available</div>

  const grouped = {
    ASSET: balances.filter((b) => b.type === 'ASSET'),
    LIABILITY: balances.filter((b) => b.type === 'LIABILITY'),
    EQUITY: balances.filter((b) => b.type === 'EQUITY'),
    REVENUE: balances.filter((b) => b.type === 'REVENUE'),
    EXPENSE: balances.filter((b) => b.type === 'EXPENSE'),
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
                <tr key={acct.accountId}>
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
