import { useState, useMemo } from 'react'
import { useDatabase } from '../db/DatabaseProvider'
import { getIncomeStatement } from '../lib/accounting'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function IncomeStatementReport() {
  const { db, isLoading, error, version } = useDatabase()
  const [startDate, setStartDate] = useState('2026-01-01')
  const [endDate, setEndDate] = useState('2026-12-31')

  const report = useMemo(() => {
    if (!db) return null
    return getIncomeStatement(db, startDate, endDate)
  }, [db, version, startDate, endDate])

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error}</div>
  if (!db || !report) return <div>No data</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Income Statement</h2>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
        <label>
          From:
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
        <label>
          To:
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
      </div>

      {/* Revenue */}
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Revenue</h3>
      {report.revenue.accounts.length === 0 ? (
        <p style={{ color: '#888' }}>No revenue in this period.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            {report.revenue.accounts.map((acct) => (
              <tr key={acct.accountId}>
                <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(acct.balance)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
              <td style={{ padding: '4px 8px' }}>Total Revenue</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(report.revenue.total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Expenses */}
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Expenses</h3>
      {report.expenses.accounts.length === 0 ? (
        <p style={{ color: '#888' }}>No expenses in this period.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            {report.expenses.accounts.map((acct) => (
              <tr key={acct.accountId}>
                <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(acct.balance)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
              <td style={{ padding: '4px 8px' }}>Total Expenses</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(report.expenses.total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Net Income */}
      <div
        style={{
          padding: '12px',
          marginTop: '16px',
          borderRadius: '4px',
          backgroundColor: report.netIncome >= 0 ? '#e6ffe6' : '#ffe6e6',
          fontWeight: 'bold',
          fontSize: '18px',
          textAlign: 'center',
        }}
      >
        Net Income: {formatCents(report.netIncome)}
      </div>
    </div>
  )
}
