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

type CashFlowData = {
  net_income: number
  operating: { account_id: string; code: string; name: string; amount: number }[]
  investing: { account_id: string; code: string; name: string; amount: number }[]
  financing: { account_id: string; code: string; name: string; amount: number }[]
  total_operating: number
  total_investing: number
  total_financing: number
  net_change_in_cash: number
  beginning_cash: number
  ending_cash: number
}

function Section({ title, items, total }: { title: string; items: { code: string; name: string; amount: number }[]; total: number }) {
  return (
    <>
      <h3 style={{ borderBottom: '1px solid #333', paddingBottom: '4px', marginTop: '16px' }}>{title}</h3>
      {items.length === 0 ? (
        <p style={{ color: '#888', fontSize: '13px' }}>No activity</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '4px' }}>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td style={{ padding: '4px 8px', fontSize: '13px' }}>{item.code} — {item.name}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontSize: '13px', color: item.amount < 0 ? '#c00' : undefined }}>
                  {formatCents(item.amount)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', borderTop: '1px solid #999' }}>
              <td style={{ padding: '4px 8px' }}>Total {title}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>
                {formatCents(total)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </>
  )
}

export function CashFlowStatementReport({ version }: { version: number }) {
  const [startDate, setStartDate] = useState('2026-01-01')
  const [endDate, setEndDate] = useState('2026-12-31')
  const [report, setReport] = useState<CashFlowData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getCashFlowStatement(startDate, endDate).then(setReport).catch((e) => setError(String(e)))
  }, [version, startDate, endDate])

  if (error) return <div>Error: {error}</div>
  if (!report) return <div>Loading...</div>

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Statement of Cash Flows</h2>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <label>From: <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} /></label>
        <label>To: <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ marginLeft: '8px', padding: '4px' }} /></label>
      </div>

      <div style={{ fontSize: '13px', marginBottom: '8px' }}>
        <strong>Net Income:</strong> <span style={{ fontFamily: 'monospace' }}>{formatCents(report.net_income)}</span>
      </div>

      <Section title="Operating Activities" items={report.operating} total={report.total_operating} />
      <Section title="Investing Activities" items={report.investing} total={report.total_investing} />
      <Section title="Financing Activities" items={report.financing} total={report.total_financing} />

      <div style={{ padding: '12px', marginTop: '20px', borderRadius: '4px', backgroundColor: '#f0f0f0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Net Change in Cash</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 'bold' }}>{formatCents(report.net_change_in_cash)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px' }}>Beginning Cash Balance</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(report.beginning_cash)}</td>
            </tr>
            <tr style={{ borderTop: '2px solid #333', fontWeight: 'bold', fontSize: '16px' }}>
              <td style={{ padding: '8px' }}>Ending Cash Balance</td>
              <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(report.ending_cash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
