import { useState, useEffect } from 'react'
import { api, type AccountLedgerResult } from '../lib/api'

function formatCents(cents: number): string {
  if (cents === 0) return ''
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function AccountLedger({
  accountId,
  version,
  onBack,
}: {
  accountId: string
  version: number
  onBack: () => void
}) {
  const [data, setData] = useState<AccountLedgerResult | null>(null)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getAccountLedger(accountId, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }).then(setData).catch((e) => setError(String(e)))
  }, [accountId, version, startDate, endDate])

  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  if (!data) return <div style={{ padding: '20px' }}>Loading...</div>

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <div className="no-print" style={{ marginBottom: '16px' }}>
        <button onClick={onBack} style={{ padding: '4px 12px', cursor: 'pointer', marginRight: '16px' }}>&larr; Back</button>
      </div>

      <h2>{data.account_code} — {data.account_name}</h2>
      <p style={{ color: '#666', fontSize: '13px', marginTop: '-8px' }}>Account Ledger ({data.account_type})</p>

      <div className="no-print" style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <label style={{ fontSize: '12px' }}>From<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ display: 'block', padding: '4px' }} /></label>
        <label style={{ fontSize: '12px' }}>To<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ display: 'block', padding: '4px' }} /></label>
      </div>

      {data.entries.length === 0 ? (
        <p style={{ color: '#888' }}>No entries for this account in the selected period.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', backgroundColor: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Ref</th>
              <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px' }}>Debit</th>
              <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px' }}>Credit</th>
              <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '13px' }}>{entry.date}</td>
                <td style={{ padding: '6px 8px', fontSize: '12px', color: '#888' }}>{entry.reference ?? ''}</td>
                <td style={{ padding: '6px 8px', fontSize: '13px' }}>{entry.description}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>{formatCents(entry.debit)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>{formatCents(entry.credit)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '13px', fontWeight: 'bold' }}>
                  {formatCents(entry.running_balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
