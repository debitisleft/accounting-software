import { useState, useEffect } from 'react'
import { useDatabase } from '../db/DatabaseProvider'
import { getBalanceSheet } from '../lib/accounting'
import type { BalanceSheet } from '../lib/accounting'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function BalanceSheetReport() {
  const { db, isLoading, error, version } = useDatabase()
  const [asOfDate, setAsOfDate] = useState('2026-12-31')
  const [report, setReport] = useState<BalanceSheet | null>(null)

  useEffect(() => {
    if (!db) return
    getBalanceSheet(db, asOfDate).then(setReport)
  }, [db, version, asOfDate])

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error: {error}</div>
  if (!db || !report) return <div>No data</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Balance Sheet</h2>

      <div style={{ marginBottom: '20px' }}>
        <label>
          As of:
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
      </div>

      {!report.isBalanced && (
        <div style={{ padding: '12px', backgroundColor: '#ffe6e6', color: 'red', borderRadius: '4px', marginBottom: '16px', fontWeight: 'bold' }}>
          OUT OF BALANCE — Assets ({formatCents(report.assets.total)}) != Liabilities + Equity ({formatCents(report.liabilities.total + report.equity.total)})
        </div>
      )}

      {/* Assets */}
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Assets</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.assets.accounts.map((acct) => (
            <tr key={acct.accountId}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Assets</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.assets.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Liabilities */}
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Liabilities</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.liabilities.accounts.map((acct) => (
            <tr key={acct.accountId}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Liabilities</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.liabilities.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Equity */}
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Equity</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.equity.accounts.map((acct) => (
            <tr key={acct.accountId}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Equity (incl. Net Income)</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.equity.total)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Accounting Equation */}
      <div
        style={{
          padding: '12px',
          marginTop: '16px',
          borderRadius: '4px',
          backgroundColor: report.isBalanced ? '#e6ffe6' : '#ffe6e6',
          fontWeight: 'bold',
          textAlign: 'center',
        }}
      >
        {report.isBalanced
          ? `Assets (${formatCents(report.assets.total)}) = Liabilities (${formatCents(report.liabilities.total)}) + Equity (${formatCents(report.equity.total)})`
          : `OUT OF BALANCE: ${formatCents(report.assets.total)} != ${formatCents(report.liabilities.total + report.equity.total)}`}
      </div>
    </div>
  )
}
