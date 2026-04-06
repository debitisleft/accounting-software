import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

function formatCents(cents: number): string {
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
}

type Template = {
  id: string; description: string; recurrence: string; start_date: string;
  end_date: string | null; last_generated: string | null; is_paused: number;
  entries_json: string; created_at: number
}

export function RecurringTransactions({ version, onGenerated }: { version: number; onGenerated: () => void }) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [localVersion, setLocalVersion] = useState(0)
  const [msg, setMsg] = useState('')

  // Add form state
  const [desc, setDesc] = useState('')
  const [recurrence, setRecurrence] = useState('MONTHLY')
  const [startDate, setStartDate] = useState('')
  const [acct1, setAcct1] = useState('')
  const [acct2, setAcct2] = useState('')
  const [amount, setAmount] = useState('')

  const refresh = () => setLocalVersion((v) => v + 1)

  useEffect(() => {
    api.listRecurring().then(setTemplates).catch(() => {})
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [version, localVersion])

  const handleCreate = async () => {
    const cents = Math.round(parseFloat(amount || '0') * 100)
    if (!desc || !acct1 || !acct2 || cents <= 0 || !startDate) { setMsg('Fill all fields'); return }
    try {
      await api.createRecurring({
        description: desc, recurrence, start_date: startDate,
        entries: [
          { account_id: acct1, debit: cents, credit: 0 },
          { account_id: acct2, debit: 0, credit: cents },
        ],
      })
      setDesc(''); setAmount(''); setShowAdd(false); setMsg('Template created')
      refresh()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const handleGenerate = async (tmpl: Template) => {
    const date = new Date().toISOString().split('T')[0]
    try {
      await api.generateRecurring(tmpl.id, date)
      setMsg(`Generated transaction for "${tmpl.description}"`)
      refresh(); onGenerated()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2>Recurring Transactions</h2>
        <button onClick={() => setShowAdd((s) => !s)}
          style={{ padding: '6px 16px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          {showAdd ? 'Cancel' : '+ New Template'}
        </button>
      </div>

      {msg && <div style={{ fontSize: '12px', marginBottom: '8px', color: msg.startsWith('Error') ? 'red' : 'green' }}>{msg}</div>}

      {showAdd && (
        <div style={{ padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '6px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={{ fontSize: '12px' }}>Description<input value={desc} onChange={(e) => setDesc(e.target.value)} style={{ display: 'block', padding: '4px', width: '180px' }} /></label>
            <label style={{ fontSize: '12px' }}>Recurrence
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} style={{ display: 'block', padding: '4px' }}>
                <option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option><option value="YEARLY">Yearly</option>
              </select>
            </label>
            <label style={{ fontSize: '12px' }}>Start<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ display: 'block', padding: '4px' }} /></label>
            <label style={{ fontSize: '12px' }}>Debit Account
              <select value={acct1} onChange={(e) => setAcct1(e.target.value)} style={{ display: 'block', padding: '4px' }}>
                <option value="">Select...</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '12px' }}>Credit Account
              <select value={acct2} onChange={(e) => setAcct2(e.target.value)} style={{ display: 'block', padding: '4px' }}>
                <option value="">Select...</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
              </select>
            </label>
            <label style={{ fontSize: '12px' }}>Amount ($)<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ display: 'block', padding: '4px', width: '80px' }} /></label>
            <button onClick={handleCreate} style={{ padding: '6px 16px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Create</button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <p style={{ color: '#888' }}>No recurring templates yet.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '8px' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Frequency</th>
              <th style={{ textAlign: 'left', padding: '8px' }}>Last Generated</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Status</th>
              <th style={{ textAlign: 'center', padding: '8px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tmpl) => {
              const entries = JSON.parse(tmpl.entries_json || '[]') as { debit: number }[]
              const amt = entries.reduce((s: number, e: { debit: number }) => s + e.debit, 0)
              return (
                <tr key={tmpl.id} style={{ borderBottom: '1px solid #ddd' }}>
                  <td style={{ padding: '6px 8px' }}>{tmpl.description}</td>
                  <td style={{ padding: '6px 8px' }}>{tmpl.recurrence} — {formatCents(amt)}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{tmpl.last_generated ?? '—'}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    {tmpl.is_paused ? <span style={{ color: '#888' }}>Paused</span> : <span style={{ color: 'green' }}>Active</span>}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <button onClick={() => handleGenerate(tmpl)} disabled={tmpl.is_paused !== 0}
                      style={{ fontSize: '11px', padding: '2px 8px', marginRight: '4px', cursor: tmpl.is_paused ? 'not-allowed' : 'pointer' }}>Generate</button>
                    {tmpl.is_paused ? (
                      <button onClick={async () => { await api.resumeRecurring(tmpl.id); refresh() }} style={{ fontSize: '11px', padding: '2px 8px', marginRight: '4px', cursor: 'pointer' }}>Resume</button>
                    ) : (
                      <button onClick={async () => { await api.pauseRecurring(tmpl.id); refresh() }} style={{ fontSize: '11px', padding: '2px 8px', marginRight: '4px', cursor: 'pointer' }}>Pause</button>
                    )}
                    <button onClick={async () => { await api.deleteRecurring(tmpl.id); refresh() }} style={{ fontSize: '11px', padding: '2px 8px', cursor: 'pointer', color: '#c00' }}>Delete</button>
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
