import { useState, useEffect } from 'react'
import { api, type IncomeStatementResult } from '../lib/api'
import { downloadCsv } from '../lib/download'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function IncomeStatementReport({ version }: { version: number }) {
  const [startDate, setStartDate] = useState('2026-01-01')
  const [endDate, setEndDate] = useState('2026-12-31')
  const [includeAdjusting, setIncludeAdjusting] = useState(true)
  const [excludeClosing, setExcludeClosing] = useState(true)
  const [basis, setBasis] = useState<'ACCRUAL' | 'CASH'>('ACCRUAL')
  const [report, setReport] = useState<IncomeStatementResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const excludeTypes: string[] = []
    if (!includeAdjusting) excludeTypes.push('ADJUSTING')
    if (excludeClosing) excludeTypes.push('CLOSING')
    api.getIncomeStatement(startDate, endDate, excludeTypes.length > 0 ? excludeTypes : undefined, basis === 'CASH' ? 'CASH' : undefined)
      .then(setReport).catch((e) => setError(String(e)))
  }, [version, startDate, endDate, includeAdjusting, excludeClosing, basis])

  if (error) return <div>Error: {error}</div>
  if (!report) return <div>Loading...</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Income Statement</h2>
        <button onClick={async () => { const csv = await api.exportCsv('IncomeStatement', { startDate, endDate }); downloadCsv(csv, 'income-statement.csv') }} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Export CSV</button>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '12px' }}>
        <label>
          From:
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
        <label>
          To:
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', fontSize: '13px', alignItems: 'center' }}>
        <label>
          Basis:
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'ACCRUAL' | 'CASH')} style={{ marginLeft: '6px', padding: '3px' }}>
            <option value="ACCRUAL">Accrual</option>
            <option value="CASH">Cash</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={includeAdjusting} onChange={(e) => setIncludeAdjusting(e.target.checked)} />
          {' '}Include adjusting entries
        </label>
        <label>
          <input type="checkbox" checked={excludeClosing} onChange={(e) => setExcludeClosing(e.target.checked)} />
          {' '}Exclude closing entries
        </label>
      </div>

      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Revenue</h3>
      {report.revenue.length === 0 ? (
        <p style={{ color: '#888' }}>No revenue in this period.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            {report.revenue.map((acct) => (
              <tr key={acct.account_id}>
                <td style={{ padding: '4px 8px', paddingLeft: `${8 + (acct.depth ?? 0) * 20}px` }}>{acct.code} — {acct.name}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(acct.balance)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
              <td style={{ padding: '4px 8px' }}>Total Revenue</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(report.total_revenue)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Expenses</h3>
      {report.expenses.length === 0 ? (
        <p style={{ color: '#888' }}>No expenses in this period.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
          <tbody>
            {report.expenses.map((acct) => (
              <tr key={acct.account_id}>
                <td style={{ padding: '4px 8px', paddingLeft: `${8 + (acct.depth ?? 0) * 20}px` }}>{acct.code} — {acct.name}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                  {formatCents(acct.balance)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
              <td style={{ padding: '4px 8px' }}>Total Expenses</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(report.total_expenses)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <div
        style={{
          padding: '12px',
          marginTop: '16px',
          borderRadius: '4px',
          backgroundColor: report.net_income >= 0 ? '#e6ffe6' : '#ffe6e6',
          fontWeight: 'bold',
          fontSize: '18px',
          textAlign: 'center',
        }}
      >
        Net Income: {formatCents(report.net_income)}
      </div>
    </div>
  )
}
