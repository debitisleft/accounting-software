import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'
import { downloadCsv } from '../lib/download'

function formatCents(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  const formatted = `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
  return negative ? `(${formatted})` : formatted
}

interface AccountWithBalance extends Account {
  balance: number
}

function AddAccountForm({ onCreated, accounts }: { onCreated: () => void; accounts: Account[] }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [acctType, setAcctType] = useState('ASSET')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState('')

  const parentOptions = accounts.filter((a) => a.type === acctType)

  const handleSubmit = async () => {
    setError('')
    try {
      await api.createAccount({ code, name, acctType, parentId: parentId || undefined })
      setCode('')
      setName('')
      setAcctType('ASSET')
      setParentId('')
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ padding: '12px', backgroundColor: '#f0f0f0', borderRadius: '6px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '13px' }}>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} style={{ display: 'block', padding: '4px', width: '80px' }} />
        </label>
        <label style={{ fontSize: '13px' }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ display: 'block', padding: '4px', width: '200px' }} />
        </label>
        <label style={{ fontSize: '13px' }}>
          Type
          <select value={acctType} onChange={(e) => { setAcctType(e.target.value); setParentId('') }} style={{ display: 'block', padding: '4px' }}>
            <option value="ASSET">Asset</option>
            <option value="LIABILITY">Liability</option>
            <option value="EQUITY">Equity</option>
            <option value="REVENUE">Revenue</option>
            <option value="EXPENSE">Expense</option>
          </select>
        </label>
        <label style={{ fontSize: '13px' }}>
          Parent
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} style={{ display: 'block', padding: '4px' }}>
            <option value="">(None — top level)</option>
            {parentOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </label>
        <button onClick={handleSubmit} style={{ padding: '6px 16px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
          Add
        </button>
      </div>
      {error && <div style={{ color: 'red', fontSize: '13px', marginTop: '4px' }}>{error}</div>}
    </div>
  )
}

export function AccountsListPage({ version }: { version: number }) {
  const [activeAccounts, setActiveAccounts] = useState<AccountWithBalance[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [localVersion, setLocalVersion] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  const refresh = () => setLocalVersion((v) => v + 1)

  useEffect(() => {
    (async () => {
      try {
        const accts = await api.getAccounts()
        const withBalances = await Promise.all(
          accts.map(async (acct) => {
            const balance = await api.getAccountBalance(acct.id)
            return { ...acct, balance }
          }),
        )
        setActiveAccounts(withBalances)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [version, localVersion])

  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>

  const grouped = {
    ASSET: activeAccounts.filter((a) => a.type === 'ASSET'),
    LIABILITY: activeAccounts.filter((a) => a.type === 'LIABILITY'),
    EQUITY: activeAccounts.filter((a) => a.type === 'EQUITY'),
    REVENUE: activeAccounts.filter((a) => a.type === 'REVENUE'),
    EXPENSE: activeAccounts.filter((a) => a.type === 'EXPENSE'),
  }

  const startEdit = (acct: AccountWithBalance) => {
    setEditingId(acct.id)
    setEditName(acct.name)
    setEditCode(acct.code)
  }

  const saveEdit = async () => {
    if (!editingId) return
    try {
      await api.updateAccount(editingId, { name: editName, code: editCode })
      setEditingId(null)
      refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  const handleDeactivate = async (acct: AccountWithBalance) => {
    try {
      await api.deactivateAccount(acct.id)
      refresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Chart of Accounts</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={async () => { const csv = await api.exportCsv('ChartOfAccounts'); downloadCsv(csv, 'chart-of-accounts.csv') }} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Export CSV</button>
          <button
            onClick={() => setShowAdd((s) => !s)}
            style={{ padding: '6px 16px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {showAdd ? 'Cancel' : '+ Add Account'}
          </button>
        </div>
      </div>

      {showAdd && <AddAccountForm accounts={activeAccounts} onCreated={() => { refresh(); setShowAdd(false) }} />}

      {Object.entries(grouped).map(([type, accts]) => (
        <div key={type} style={{ marginBottom: '20px' }}>
          <h3 style={{ borderBottom: '2px solid #333', paddingBottom: '4px' }}>{type}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Code</th>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Name</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Balance</th>
                <th style={{ textAlign: 'center', padding: '4px 8px', width: '120px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accts.map((acct) => {
                const indent = (acct.depth ?? 0) * 20
                const isParent = accts.some((a) => a.parent_id === acct.id)
                return (
                <tr key={acct.id} style={{ fontWeight: isParent ? 600 : 'normal' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
                    {editingId === acct.id ? (
                      <input value={editCode} onChange={(e) => setEditCode(e.target.value)} style={{ width: '70px', padding: '2px' }} />
                    ) : acct.code}
                  </td>
                  <td style={{ padding: '4px 8px', paddingLeft: `${8 + indent}px` }}>
                    {editingId === acct.id ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '200px', padding: '2px' }} />
                    ) : acct.name}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'monospace', color: acct.balance < 0 ? 'red' : 'inherit' }}>
                    {formatCents(acct.balance)}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    {editingId === acct.id ? (
                      <>
                        <button onClick={saveEdit} style={{ fontSize: '12px', marginRight: '4px', cursor: 'pointer' }}>Save</button>
                        <button onClick={() => setEditingId(null)} style={{ fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(acct)} style={{ fontSize: '12px', marginRight: '4px', cursor: 'pointer' }}>Edit</button>
                        <button
                          onClick={() => handleDeactivate(acct)}
                          disabled={acct.balance !== 0}
                          style={{ fontSize: '12px', cursor: acct.balance !== 0 ? 'not-allowed' : 'pointer', opacity: acct.balance !== 0 ? 0.4 : 1 }}
                          title={acct.balance !== 0 ? 'Cannot deactivate: balance is not zero' : 'Deactivate'}
                        >
                          Deactivate
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
