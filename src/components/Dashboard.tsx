import { useState, useEffect } from 'react'
import { api, type DashboardSummary } from '../lib/api'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      style={{
        flex: '1 1 200px',
        padding: '20px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        borderLeft: `4px solid ${color}`,
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}
    >
      <div style={{ fontSize: '12px', color: '#666', textTransform: 'uppercase', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 'bold', fontFamily: 'monospace' }}>
        {formatCents(value)}
      </div>
    </div>
  )
}

export function Dashboard({ version }: { version: number }) {
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getDashboardSummary().then(setData).catch((e) => setError(String(e)))
  }, [version])

  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>
  if (!data) return <div style={{ padding: '20px' }}>Loading...</div>

  return (
    <div style={{ padding: '24px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2 style={{ marginTop: 0, marginBottom: '20px' }}>Dashboard</h2>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
        <SummaryCard label="Total Assets" value={data.total_assets} color="#2196F3" />
        <SummaryCard label="Total Liabilities" value={data.total_liabilities} color="#f44336" />
        <SummaryCard label="Total Equity" value={data.total_equity} color="#4CAF50" />
        <SummaryCard label="Net Income" value={data.net_income} color={data.net_income >= 0 ? '#4CAF50' : '#f44336'} />
      </div>

      {/* Revenue / Expenses row */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
        <SummaryCard label="Revenue" value={data.total_revenue} color="#66bb6a" />
        <SummaryCard label="Expenses" value={data.total_expenses} color="#ef5350" />
        <SummaryCard label="Transactions" value={data.transaction_count} color="#9e9e9e" />
      </div>

      {/* Recent transactions */}
      <h3>Recent Transactions</h3>
      {data.recent_transactions.length === 0 ? (
        <p style={{ color: '#888' }}>No transactions recorded yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', backgroundColor: '#fafafa' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#666' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '12px', color: '#666' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '12px', color: '#666' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.recent_transactions.map((tx) => {
              const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
              return (
                <tr key={tx.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '13px' }}>{tx.date}</td>
                  <td style={{ padding: '8px 12px', fontSize: '13px' }}>{tx.description}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>
                    {formatCents(totalDebit)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
