import { useState, useEffect } from 'react'
import { api, type BalanceSheetResult } from '../lib/api'
import { downloadCsv } from '../lib/download'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

export function BalanceSheetReport({ version }: { version: number }) {
  const [asOfDate, setAsOfDate] = useState('2026-12-31')
  const [report, setReport] = useState<BalanceSheetResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getBalanceSheet(asOfDate).then(setReport).catch((e) => setError(String(e)))
  }, [version, asOfDate])

  if (error) return <div>Error: {error}</div>
  if (!report) return <div>Loading...</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Balance Sheet</h2>
        <button onClick={async () => { const csv = await api.exportCsv('BalanceSheet', { asOfDate }); downloadCsv(csv, 'balance-sheet.csv') }} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Export CSV</button>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <label>
          As of:
          <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} />
        </label>
      </div>

      {!report.is_balanced && (
        <div style={{ padding: '12px', backgroundColor: '#ffe6e6', color: 'red', borderRadius: '4px', marginBottom: '16px', fontWeight: 'bold' }}>
          OUT OF BALANCE — Assets ({formatCents(report.total_assets)}) != Liabilities + Equity ({formatCents(report.total_liabilities + report.total_equity)})
        </div>
      )}

      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Assets</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.assets.map((acct) => (
            <tr key={acct.account_id}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Assets</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.total_assets)}
            </td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Liabilities</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.liabilities.map((acct) => (
            <tr key={acct.account_id}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Liabilities</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.total_liabilities)}
            </td>
          </tr>
        </tbody>
      </table>

      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px' }}>Equity</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
        <tbody>
          {report.equity.map((acct) => (
            <tr key={acct.account_id}>
              <td style={{ padding: '4px 8px' }}>{acct.code} — {acct.name}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(acct.balance)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
            <td style={{ padding: '6px 8px' }}>Total Equity (incl. Net Income)</td>
            <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {formatCents(report.total_equity)}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        style={{
          padding: '12px',
          marginTop: '16px',
          borderRadius: '4px',
          backgroundColor: report.is_balanced ? '#e6ffe6' : '#ffe6e6',
          fontWeight: 'bold',
          textAlign: 'center',
        }}
      >
        {report.is_balanced
          ? `Assets (${formatCents(report.total_assets)}) = Liabilities (${formatCents(report.total_liabilities)}) + Equity (${formatCents(report.total_equity)})`
          : `OUT OF BALANCE: ${formatCents(report.total_assets)} != ${formatCents(report.total_liabilities + report.total_equity)}`}
      </div>
    </div>
  )
}
