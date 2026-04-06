import { useState, useEffect } from 'react'
import { api } from '../lib/api'

function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return neg ? `(${formatted})` : formatted
}

export function FiscalYearClose({ version }: { version: number }) {
  const [endDate, setEndDate] = useState('2026-12-31')
  const [closes, setCloses] = useState<{ transaction_id: string; date: string; net_income: number }[]>([])
  const [message, setMessage] = useState('')
  const [closing, setClosing] = useState(false)

  const loadCloses = () => {
    api.listFiscalYearCloses().then(setCloses).catch(() => {})
  }

  useEffect(loadCloses, [version])

  const handleClose = async () => {
    if (!confirm(`Close fiscal year ending ${endDate}? This will create a closing entry and lock the period.`)) return
    setClosing(true)
    try {
      const result = await api.closeFiscalYear(endDate)
      setMessage(`Fiscal year closed. Net income of ${formatCents(result.net_income)} transferred to Retained Earnings.`)
      loadCloses()
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setClosing(false)
  }

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Fiscal Year Close</h2>
      <p style={{ color: '#666', marginBottom: '16px' }}>
        Closing a fiscal year zeroes all revenue and expense accounts and transfers the net income to Retained Earnings.
        The period will be locked after closing.
      </p>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'end', marginBottom: '24px' }}>
        <label>
          Fiscal Year End Date:
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ display: 'block', padding: '4px', marginTop: '4px' }} />
        </label>
        <button onClick={handleClose} disabled={closing}
          style={{ padding: '8px 20px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Close Year
        </button>
      </div>

      {message && (
        <div style={{ padding: '12px', marginBottom: '16px', borderRadius: '4px',
          backgroundColor: message.startsWith('Error') ? '#ffe6e6' : '#e6ffe6',
          color: message.startsWith('Error') ? 'red' : 'green' }}>
          {message}
        </div>
      )}

      <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '4px' }}>Closing History</h3>
      {closes.length === 0 ? (
        <p style={{ color: '#888' }}>No fiscal years have been closed yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Date</th>
              <th style={{ textAlign: 'right', padding: '8px' }}>Net Income</th>
            </tr>
          </thead>
          <tbody>
            {closes.map((c) => (
              <tr key={c.transaction_id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{c.date}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace',
                  color: c.net_income >= 0 ? 'green' : 'red' }}>
                  {formatCents(c.net_income)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
