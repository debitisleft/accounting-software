import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

function strToCents(str: string): number {
  const trimmed = str.trim()
  if (trimmed === '') return 0
  return Math.round(parseFloat(trimmed) * 100)
}

export function OpeningBalancesWizard({ version, onSaved }: { version: number; onSaved: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [effectiveDate, setEffectiveDate] = useState('2026-01-01')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.getAccounts().then((accts) => {
      setAccounts(accts)
      const init: Record<string, string> = {}
      for (const a of accts) init[a.id] = ''
      setAmounts(init)
    }).catch(() => {})
  }, [version])

  const handleSave = async () => {
    const balances = Object.entries(amounts)
      .filter(([, v]) => strToCents(v) !== 0)
      .map(([id, v]) => ({ account_id: id, balance: strToCents(v) }))

    if (balances.length === 0) {
      setMessage('Enter at least one non-zero balance')
      return
    }

    setSaving(true)
    try {
      const txId = await api.enterOpeningBalances(balances, effectiveDate)
      setMessage(`Opening balances saved (${txId.slice(0, 8)}...)`)
      onSaved()
    } catch (e) {
      setMessage(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
    setSaving(false)
  }

  const grouped = {
    ASSET: accounts.filter((a) => a.type === 'ASSET'),
    LIABILITY: accounts.filter((a) => a.type === 'LIABILITY'),
    EQUITY: accounts.filter((a) => a.type === 'EQUITY' && a.code !== '3500'),
  }

  return (
    <div style={{ padding: '20px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Opening Balances</h2>
      <p style={{ color: '#666', marginBottom: '16px' }}>
        Enter the current balances for each account. The difference will be posted to Opening Balance Equity.
      </p>

      <label style={{ marginBottom: '16px', display: 'block' }}>
        Effective Date:
        <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
          style={{ marginLeft: '8px', padding: '4px' }} />
      </label>

      {(Object.entries(grouped) as [string, Account[]][]).map(([type, accts]) => (
        <div key={type} style={{ marginBottom: '16px' }}>
          <h3 style={{ borderBottom: '1px solid #ccc', paddingBottom: '4px' }}>{type}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {accts.map((acct) => (
                <tr key={acct.id}>
                  <td style={{ padding: '4px 8px', fontSize: '13px' }}>{acct.code} — {acct.name}</td>
                  <td style={{ padding: '4px 8px', width: '120px' }}>
                    <input type="number" step="0.01" min="0" placeholder="0.00"
                      value={amounts[acct.id] ?? ''}
                      onChange={(e) => setAmounts((prev) => ({ ...prev, [acct.id]: e.target.value }))}
                      style={{ width: '100px', textAlign: 'right', padding: '4px' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '16px' }}>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: '8px 24px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '16px' }}>
          Save Opening Balances
        </button>
        {message && <span style={{ color: message.startsWith('Error') ? 'red' : 'green' }}>{message}</span>}
      </div>
    </div>
  )
}
