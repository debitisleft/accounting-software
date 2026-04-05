import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

interface EntryRow {
  accountId: string
  debitDollars: string
  creditDollars: string
  memo: string
}

const emptyRow = (): EntryRow => ({
  accountId: '',
  debitDollars: '',
  creditDollars: '',
  memo: '',
})

/** Converts dollar string to integer cents using Math.round */
function dollarsToCents(dollars: string): number {
  const trimmed = dollars.trim()
  if (trimmed === '') return 0
  return Math.round(parseFloat(trimmed) * 100)
}

export function JournalEntryForm({
  version,
  onSaved,
}: {
  version: number
  onSaved: () => void
}) {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([emptyRow(), emptyRow()])
  const [saveMessage, setSaveMessage] = useState('')
  const [accountList, setAccountList] = useState<Account[]>([])

  useEffect(() => {
    api.getAccounts().then(setAccountList).catch(() => {})
  }, [version])

  const totalDebit = rows.reduce((sum, r) => sum + dollarsToCents(r.debitDollars), 0)
  const totalCredit = rows.reduce((sum, r) => sum + dollarsToCents(r.creditDollars), 0)
  const isBalanced = totalDebit === totalCredit && totalDebit > 0
  const hasAllAccounts = rows.every(
    (r) =>
      r.accountId !== '' &&
      (dollarsToCents(r.debitDollars) > 0 || dollarsToCents(r.creditDollars) > 0),
  )
  const canSave = isBalanced && hasAllAccounts && description.trim() !== '' && date !== ''

  const updateRow = (index: number, field: keyof EntryRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  const removeRow = (index: number) => {
    if (rows.length <= 2) return
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!canSave) return

    const entries = rows
      .filter((r) => r.accountId !== '')
      .map((r) => ({
        account_id: r.accountId,
        debit: dollarsToCents(r.debitDollars),
        credit: dollarsToCents(r.creditDollars),
        memo: r.memo || undefined,
      }))

    try {
      const txId = await api.createTransaction({
        date,
        description: description.trim(),
        entries,
      })
      setSaveMessage(`Transaction ${txId.slice(0, 8)}... saved!`)
      setDescription('')
      setRows([emptyRow(), emptyRow()])
      onSaved()
    } catch (err) {
      setSaveMessage(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const balanceColor =
    totalDebit === 0 && totalCredit === 0
      ? '#888'
      : isBalanced
        ? 'green'
        : 'red'

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <h2>Journal Entry</h2>

      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
        <label>
          Date:
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ marginLeft: '8px', padding: '4px' }}
          />
        </label>
        <label style={{ flex: 1 }}>
          Description:
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g., Sale of goods"
            style={{ marginLeft: '8px', padding: '4px', width: '300px' }}
          />
        </label>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #333' }}>
            <th style={{ textAlign: 'left', padding: '8px' }}>Account</th>
            <th style={{ textAlign: 'right', padding: '8px' }}>Debit ($)</th>
            <th style={{ textAlign: 'right', padding: '8px' }}>Credit ($)</th>
            <th style={{ textAlign: 'left', padding: '8px' }}>Memo</th>
            <th style={{ padding: '8px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #ddd' }}>
              <td style={{ padding: '4px 8px' }}>
                <select
                  value={row.accountId}
                  onChange={(e) => updateRow(i, 'accountId', e.target.value)}
                  style={{ padding: '4px', width: '200px' }}
                >
                  <option value="">Select account...</option>
                  {accountList.map((acct) => (
                    <option key={acct.id} value={acct.id}>
                      {acct.code} — {acct.name}
                    </option>
                  ))}
                </select>
              </td>
              <td style={{ padding: '4px 8px' }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.debitDollars}
                  onChange={(e) => updateRow(i, 'debitDollars', e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100px', textAlign: 'right', padding: '4px' }}
                />
              </td>
              <td style={{ padding: '4px 8px' }}>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.creditDollars}
                  onChange={(e) => updateRow(i, 'creditDollars', e.target.value)}
                  placeholder="0.00"
                  style={{ width: '100px', textAlign: 'right', padding: '4px' }}
                />
              </td>
              <td style={{ padding: '4px 8px' }}>
                <input
                  type="text"
                  value={row.memo}
                  onChange={(e) => updateRow(i, 'memo', e.target.value)}
                  placeholder="Optional"
                  style={{ width: '120px', padding: '4px' }}
                />
              </td>
              <td style={{ padding: '4px 8px' }}>
                {rows.length > 2 && (
                  <button onClick={() => removeRow(i)} style={{ padding: '2px 8px' }}>
                    X
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid #333', fontWeight: 'bold' }}>
            <td style={{ padding: '8px' }}>
              <button onClick={addRow} style={{ padding: '4px 12px' }}>
                + Add Row
              </button>
            </td>
            <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {(totalDebit / 100).toFixed(2)}
            </td>
            <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace' }}>
              {(totalCredit / 100).toFixed(2)}
            </td>
            <td colSpan={2}></td>
          </tr>
        </tfoot>
      </table>

      <div
        style={{
          padding: '8px 16px',
          marginBottom: '16px',
          borderRadius: '4px',
          backgroundColor:
            balanceColor === 'green'
              ? '#e6ffe6'
              : balanceColor === 'red'
                ? '#ffe6e6'
                : '#f5f5f5',
          color: balanceColor,
          fontWeight: 'bold',
          textAlign: 'center',
        }}
      >
        {totalDebit === 0 && totalCredit === 0
          ? 'Enter amounts to begin'
          : isBalanced
            ? `BALANCED — Debits and Credits both equal $${(totalDebit / 100).toFixed(2)}`
            : `OUT OF BALANCE — Difference: $${(Math.abs(totalDebit - totalCredit) / 100).toFixed(2)}`}
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            padding: '8px 24px',
            backgroundColor: canSave ? '#4CAF50' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: canSave ? 'pointer' : 'not-allowed',
            fontSize: '16px',
          }}
        >
          Save Transaction
        </button>
        {saveMessage && (
          <span style={{ color: saveMessage.startsWith('Error') ? 'red' : 'green' }}>
            {saveMessage}
          </span>
        )}
      </div>
    </div>
  )
}
