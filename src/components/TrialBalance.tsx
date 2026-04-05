import { useState, useEffect } from 'react'
import { api, type TrialBalanceResult } from '../lib/api'

function formatCents(cents: number): string {
  if (cents === 0) return ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
}

export function TrialBalanceReport({ version }: { version: number }) {
  const [data, setData] = useState<TrialBalanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getTrialBalance().then(setData).catch((e) => setError(String(e)))
  }, [version])

  if (error) return <div>Error: {error}</div>
  if (!data) return <div>Loading...</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Trial Balance</h2>

      {!data.is_balanced && (
        <div style={{ padding: '12px', backgroundColor: '#ffe6e6', color: 'red', borderRadius: '4px', marginBottom: '16px', fontWeight: 'bold' }}>
          OUT OF BALANCE — Debits ({formatCents(data.total_debits)}) != Credits ({formatCents(data.total_credits)})
        </div>
      )}

      {data.rows.length === 0 ? (
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
            {data.rows.map((row) => (
              <tr key={row.account_id} style={{ borderBottom: '1px solid #ddd' }}>
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
                {formatCents(data.total_debits)}
              </td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(data.total_credits)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}

      {data.is_balanced && data.rows.length > 0 && (
        <div style={{ padding: '12px', backgroundColor: '#e6ffe6', color: 'green', borderRadius: '4px', marginTop: '16px', textAlign: 'center' }}>
          Trial Balance is balanced.
        </div>
      )}
    </div>
  )
}
