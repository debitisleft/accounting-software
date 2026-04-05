import { useState, useEffect } from 'react'
import { useDatabase } from '../db/DatabaseProvider'
import { getTrialBalance } from '../lib/accounting'
import type { TrialBalance } from '../lib/accounting'

function formatCents(cents: number): string {
  if (cents === 0) return ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
}

export function TrialBalanceReport() {
  const { db, isLoading, error, version } = useDatabase()
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null)

  useEffect(() => {
    if (!db) return
    getTrialBalance(db).then(setTrialBalance)
  }, [db, version])

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error}</div>
  if (!db || !trialBalance) return <div>No data</div>

  const isBalanced = trialBalance.totalDebit === trialBalance.totalCredit

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Trial Balance</h2>

      {!isBalanced && (
        <div style={{ padding: '12px', backgroundColor: '#ffe6e6', color: 'red', borderRadius: '4px', marginBottom: '16px', fontWeight: 'bold' }}>
          OUT OF BALANCE — Debits ({formatCents(trialBalance.totalDebit)}) != Credits ({formatCents(trialBalance.totalCredit)})
        </div>
      )}

      {trialBalance.rows.length === 0 ? (
        <p>No transactions recorded yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Code</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Account</th>
              <th style={{ textAlign: 'right', padding: '8px' }}>Debit</th>
              <th style={{ textAlign: 'right', padding: '8px' }}>Credit</th>
            </tr>
          </thead>
          <tbody>
            {trialBalance.rows.map((row) => (
              <tr key={row.accountId} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{row.code}</td>
                <td style={{ padding: '6px 8px' }}>{row.name}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(row.debit)}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(row.credit)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid #333', fontWeight: 'bold' }}>
              <td colSpan={2} style={{ padding: '8px' }}>TOTAL</td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(trialBalance.totalDebit)}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(trialBalance.totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {isBalanced && trialBalance.rows.length > 0 && (
        <div style={{ padding: '12px', backgroundColor: '#e6ffe6', color: 'green', borderRadius: '4px', marginTop: '16px', textAlign: 'center' }}>
          Trial Balance is balanced.
        </div>
      )}
    </div>
  )
}
