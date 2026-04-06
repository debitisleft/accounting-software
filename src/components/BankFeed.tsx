import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

function formatCents(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return neg ? `(${formatted})` : formatted
}

type Pending = {
  id: string; date: string; description: string; amount: number;
  payee: string | null; status: string; suggested_account_id: string | null
}

export function BankFeed({ version, onApproved }: { version: number; onApproved: () => void }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({})
  const [localVersion, setLocalVersion] = useState(0)
  const [msg, setMsg] = useState('')

  const refresh = () => setLocalVersion((v) => v + 1)

  useEffect(() => {
    api.listPendingBankTransactions().then(setPending).catch(() => {})
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [version, localVersion])

  const handleApprove = async (p: Pending) => {
    const acctId = selectedAccounts[p.id] || p.suggested_account_id
    if (!acctId) { setMsg('Select an account first'); return }
    try {
      await api.approveBankTransaction(p.id, acctId)
      setMsg(`Approved: ${p.description}`)
      refresh(); onApproved()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const handleDismiss = async (p: Pending) => {
    try {
      await api.dismissBankTransaction(p.id)
      setMsg(`Dismissed: ${p.description}`)
      refresh()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <h2>Bank Feed</h2>
      <p style={{ color: '#666', marginBottom: '16px' }}>Review and categorize imported bank transactions.</p>

      {msg && <div style={{ fontSize: '12px', marginBottom: '8px', color: msg.startsWith('Error') ? 'red' : 'green' }}>{msg}</div>}

      {pending.length === 0 ? (
        <p style={{ color: '#888' }}>No pending bank transactions.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Date</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Description</th>
              <th style={{ textAlign: 'right', padding: '8px' }}>Amount</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Account</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{p.date}</td>
                <td style={{ padding: '6px 8px' }}>
                  {p.description}
                  {p.payee && <span style={{ color: '#888', fontSize: '11px' }}> ({p.payee})</span>}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: p.amount < 0 ? '#c00' : '#080' }}>
                  {formatCents(p.amount)}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <select value={selectedAccounts[p.id] ?? p.suggested_account_id ?? ''}
                    onChange={(e) => setSelectedAccounts((s) => ({ ...s, [p.id]: e.target.value }))}
                    style={{ padding: '3px', fontSize: '12px' }}>
                    <option value="">Select...</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  <button onClick={() => handleApprove(p)} style={{ fontSize: '11px', padding: '3px 10px', marginRight: '4px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', cursor: 'pointer', borderRadius: '3px' }}>Approve</button>
                  <button onClick={() => handleDismiss(p)} style={{ fontSize: '11px', padding: '3px 10px', cursor: 'pointer' }}>Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
