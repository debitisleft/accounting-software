import { useState, useEffect, useCallback } from 'react'
import { api, type TransactionWithEntries, type Account, type AuditLogEntry, type JournalEntryInput } from '../lib/api'
import { downloadCsv } from '../lib/download'

function formatCents(cents: number): string {
  if (cents === 0) return ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
}

function dollarsToCents(dollars: string): number {
  const trimmed = dollars.trim()
  if (trimmed === '') return 0
  return Math.round(parseFloat(trimmed) * 100)
}

function centsToStr(cents: number): string {
  if (cents === 0) return ''
  return (cents / 100).toFixed(2)
}

// ── Expanded Transaction Detail ──────────────────────────

function ExpandedTransaction({
  tx,
  accounts,
  onRefresh,
}: {
  tx: TransactionWithEntries
  accounts: Account[]
  onRefresh: () => void
}) {
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const [editLines, setEditLines] = useState(false)
  const [showAudit, setShowAudit] = useState(false)
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([])
  const [msg, setMsg] = useState('')

  const [lineRows, setLineRows] = useState<{ accountId: string; debitStr: string; creditStr: string; memo: string }[]>([])

  const isLocked = tx.is_locked !== 0
  const isVoid = tx.is_void !== 0

  const startEditLines = () => {
    setLineRows(tx.entries.map((e) => ({
      accountId: e.account_id,
      debitStr: centsToStr(e.debit),
      creditStr: centsToStr(e.credit),
      memo: e.memo ?? '',
    })))
    setEditLines(true)
  }

  const totalLineDebit = lineRows.reduce((s, r) => s + dollarsToCents(r.debitStr), 0)
  const totalLineCredit = lineRows.reduce((s, r) => s + dollarsToCents(r.creditStr), 0)
  const linesBalanced = totalLineDebit === totalLineCredit && totalLineDebit > 0

  const saveLines = async () => {
    const entries: JournalEntryInput[] = lineRows.map((r) => ({
      account_id: r.accountId,
      debit: dollarsToCents(r.debitStr),
      credit: dollarsToCents(r.creditStr),
      memo: r.memo || undefined,
    }))
    try {
      await api.updateTransactionLines(tx.id, entries)
      setEditLines(false)
      setMsg('Lines saved')
      onRefresh()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const handleVoid = async () => {
    if (!confirm('This will create a reversing entry. Continue?')) return
    try {
      await api.voidTransaction(tx.id)
      setMsg('Transaction voided')
      onRefresh()
    } catch (e) { setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const loadAudit = async () => {
    setShowAudit((s) => !s)
    if (!showAudit) {
      const log = await api.getAuditLog(tx.id)
      setAuditLog(log)
    }
  }

  const updateLineRow = (i: number, field: string, value: string) => {
    setLineRows((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  return (
    <div style={{ padding: '12px 12px 12px 40px', backgroundColor: '#fafafa', borderBottom: '1px solid #e0e0e0' }} onClick={(e) => e.stopPropagation()}>
      {!isLocked && !isVoid && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          {!editLines && (
            <>
              <button onClick={startEditLines} style={{ fontSize: '12px', padding: '3px 10px', cursor: 'pointer' }}>Edit Amounts</button>
              <button onClick={handleVoid} style={{ fontSize: '12px', padding: '3px 10px', cursor: 'pointer', color: '#c00' }}>Void</button>
            </>
          )}
          <button onClick={loadAudit} style={{ fontSize: '12px', padding: '3px 10px', cursor: 'pointer', marginLeft: 'auto' }}>
            {showAudit ? 'Hide History' : 'View History'}
          </button>
        </div>
      )}
      {(isLocked || isVoid) && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          {isLocked && <span style={{ fontSize: '12px', color: '#888' }}>Period locked — editing disabled</span>}
          {isVoid && <span style={{ fontSize: '12px', color: '#888' }}>Transaction voided</span>}
          <button onClick={loadAudit} style={{ fontSize: '12px', padding: '3px 10px', cursor: 'pointer', marginLeft: 'auto' }}>
            {showAudit ? 'Hide History' : 'View History'}
          </button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ color: '#888' }}>
            <th style={{ textAlign: 'left', padding: '4px' }}>Account</th>
            <th style={{ textAlign: 'right', padding: '4px' }}>Debit</th>
            <th style={{ textAlign: 'right', padding: '4px' }}>Credit</th>
            <th style={{ textAlign: 'left', padding: '4px' }}>Memo</th>
          </tr>
        </thead>
        <tbody>
          {editLines ? lineRows.map((row, i) => (
            <tr key={i}>
              <td style={{ padding: '4px' }}>
                <select value={row.accountId} onChange={(e) => updateLineRow(i, 'accountId', e.target.value)} style={{ padding: '2px', fontSize: '12px' }}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </select>
              </td>
              <td style={{ padding: '4px' }}><input value={row.debitStr} onChange={(e) => updateLineRow(i, 'debitStr', e.target.value)} style={{ width: '80px', textAlign: 'right', padding: '2px' }} type="number" step="0.01" /></td>
              <td style={{ padding: '4px' }}><input value={row.creditStr} onChange={(e) => updateLineRow(i, 'creditStr', e.target.value)} style={{ width: '80px', textAlign: 'right', padding: '2px' }} type="number" step="0.01" /></td>
              <td style={{ padding: '4px' }}><input value={row.memo} onChange={(e) => updateLineRow(i, 'memo', e.target.value)} style={{ width: '100px', padding: '2px' }} /></td>
            </tr>
          )) : tx.entries.map((entry) => (
            <tr key={entry.id}>
              <td style={{ padding: '4px' }}>{(() => { const a = accountMap.get(entry.account_id); return a ? `${a.code} — ${a.name}` : entry.account_id })()}</td>
              <td style={{ padding: '4px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(entry.debit)}</td>
              <td style={{ padding: '4px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(entry.credit)}</td>
              <td style={{ padding: '4px', color: '#888' }}>{entry.memo ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {editLines && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 'bold', color: linesBalanced ? 'green' : 'red' }}>
            {linesBalanced ? 'Balanced' : `Out of balance: ${formatCents(Math.abs(totalLineDebit - totalLineCredit))}`}
          </span>
          <button onClick={saveLines} disabled={!linesBalanced} style={{ marginLeft: '8px', fontSize: '12px', padding: '3px 10px', backgroundColor: linesBalanced ? '#4CAF50' : '#ccc', color: '#fff', border: 'none', cursor: linesBalanced ? 'pointer' : 'not-allowed' }}>Save Lines</button>
          <button onClick={() => setEditLines(false)} style={{ marginLeft: '4px', fontSize: '12px', padding: '3px 10px', cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      {showAudit && (
        <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#f0f0f0', borderRadius: '4px', fontSize: '11px' }}>
          <strong>Audit Trail</strong>
          {auditLog.length === 0 ? (
            <p style={{ color: '#888' }}>No changes recorded.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '4px' }}>
              <thead><tr style={{ color: '#888' }}><th style={{ textAlign: 'left', padding: '2px' }}>Field</th><th style={{ textAlign: 'left', padding: '2px' }}>Old</th><th style={{ textAlign: 'left', padding: '2px' }}>New</th></tr></thead>
              <tbody>
                {auditLog.map((entry) => (
                  <tr key={entry.id} style={{ borderTop: '1px solid #ddd' }}>
                    <td style={{ padding: '2px' }}>{entry.field_changed}</td>
                    <td style={{ padding: '2px', color: '#c00' }}>{entry.old_value}</td>
                    <td style={{ padding: '2px', color: '#080' }}>{entry.new_value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {msg && <div style={{ fontSize: '12px', marginTop: '4px', color: msg.startsWith('Error') ? 'red' : 'green' }}>{msg}</div>}
    </div>
  )
}

// ── Inline Edit State ───────────────────────────────────

interface InlineEdit {
  date: string
  description: string
  reference: string
}

// ── Main Register ────────────────────────────────────────

export function TransactionRegister({ version }: { version: number }) {
  const [transactions, setTransactions] = useState<TransactionWithEntries[]>([])
  const [total, setTotal] = useState(0)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localVersion, setLocalVersion] = useState(0)

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [accountId, setAccountId] = useState('')
  const [memoSearch, setMemoSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  // Edit mode state
  const [editMode, setEditMode] = useState(false)
  const [edits, setEdits] = useState<Record<string, InlineEdit>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const refresh = () => setLocalVersion((v) => v + 1)

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [version, localVersion])

  useEffect(() => { setPage(0) }, [startDate, endDate, accountId, memoSearch, pageSize])

  useEffect(() => {
    api.listTransactions({
      offset: page * pageSize, limit: pageSize,
      start_date: startDate || undefined, end_date: endDate || undefined,
      account_id: accountId || undefined, memo_search: memoSearch || undefined,
    }).then((result) => { setTransactions(result.transactions); setTotal(result.total); setError(null) })
      .catch((e) => setError(String(e)))
  }, [version, localVersion, page, pageSize, startDate, endDate, accountId, memoSearch])

  // Reset edits when entering edit mode
  const enterEditMode = () => {
    setEditMode(true)
    setEdits({})
    setSaveMsg('')
  }

  const exitEditMode = () => {
    setEditMode(false)
    setEdits({})
    setSaveMsg('')
  }

  const getEdit = (tx: TransactionWithEntries): InlineEdit => {
    return edits[tx.id] ?? { date: tx.date, description: tx.description, reference: tx.reference ?? '' }
  }

  const setEdit = (txId: string, field: keyof InlineEdit, value: string) => {
    setEdits((prev) => {
      const tx = transactions.find((t) => t.id === txId)!
      const current = prev[txId] ?? { date: tx.date, description: tx.description, reference: tx.reference ?? '' }
      return { ...prev, [txId]: { ...current, [field]: value } }
    })
  }

  const isModified = (txId: string): boolean => {
    const edit = edits[txId]
    if (!edit) return false
    const tx = transactions.find((t) => t.id === txId)!
    return edit.date !== tx.date || edit.description !== tx.description || edit.reference !== (tx.reference ?? '')
  }

  const modifiedCount = Object.keys(edits).filter(isModified).length

  const handleSaveAll = async () => {
    setSaving(true)
    setSaveMsg('')
    let saved = 0
    let errors = 0
    for (const [txId, edit] of Object.entries(edits)) {
      if (!isModified(txId)) continue
      try {
        await api.updateTransaction(txId, { date: edit.date, description: edit.description, reference: edit.reference })
        saved++
      } catch {
        errors++
      }
    }
    setSaving(false)
    setSaveMsg(`Saved ${saved} change${saved !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} error${errors !== 1 ? 's' : ''}` : ''}`)
    if (saved > 0) {
      setEdits({})
      refresh()
    }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent, txId: string, field: keyof InlineEdit) => {
    if (e.key === 'Escape') {
      // Restore original value
      const tx = transactions.find((t) => t.id === txId)!
      const original = { date: tx.date, description: tx.description, reference: tx.reference ?? '' }
      setEdits((prev) => {
        const updated = { ...prev }
        if (updated[txId]) {
          updated[txId] = { ...updated[txId], [field]: original[field] }
        }
        return updated
      })
    }
  }, [transactions])

  const totalPages = Math.ceil(total / pageSize)
  const accountMap = new Map(accounts.map((a) => [a.id, a]))
  const hasFilters = startDate || endDate || accountId || memoSearch

  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Transaction Register</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {editMode ? (
            <>
              {modifiedCount > 0 && (
                <span style={{ fontSize: '12px', color: '#E65100', fontWeight: 'bold' }}>
                  {modifiedCount} unsaved change{modifiedCount !== 1 ? 's' : ''}
                </span>
              )}
              <button onClick={handleSaveAll} disabled={saving || modifiedCount === 0}
                style={{ padding: '6px 16px', backgroundColor: modifiedCount > 0 ? '#4CAF50' : '#ccc', color: '#fff', border: 'none', borderRadius: '4px', cursor: modifiedCount > 0 ? 'pointer' : 'not-allowed', fontSize: '12px' }}>
                {saving ? 'Saving...' : 'Save All Changes'}
              </button>
              <button onClick={exitEditMode} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Exit Edit Mode</button>
            </>
          ) : (
            <>
              <button onClick={enterEditMode} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px', backgroundColor: '#2196F3', color: '#fff', border: 'none', borderRadius: '4px' }}>Edit Mode</button>
              <button onClick={async () => { const csv = await api.exportCsv('TransactionRegister', { startDate: startDate || undefined, endDate: endDate || undefined, accountId: accountId || undefined, memoSearch: memoSearch || undefined }); downloadCsv(csv, 'transactions.csv') }} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '12px' }}>Export CSV</button>
            </>
          )}
        </div>
      </div>

      {saveMsg && <div style={{ fontSize: '12px', color: saveMsg.includes('error') ? 'red' : 'green', marginBottom: '8px' }}>{saveMsg}</div>}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '6px' }}>
        <label style={{ fontSize: '12px' }}>From<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ display: 'block', padding: '4px' }} /></label>
        <label style={{ fontSize: '12px' }}>To<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ display: 'block', padding: '4px' }} /></label>
        <label style={{ fontSize: '12px' }}>Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ display: 'block', padding: '4px' }}>
            <option value="">All</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '12px' }}>Search<input type="text" value={memoSearch} onChange={(e) => setMemoSearch(e.target.value)} placeholder="Search..." style={{ display: 'block', padding: '4px', width: '140px' }} /></label>
        {hasFilters && <button onClick={() => { setStartDate(''); setEndDate(''); setAccountId(''); setMemoSearch('') }} style={{ alignSelf: 'end', padding: '4px 12px', cursor: 'pointer' }}>Clear</button>}
      </div>

      <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>{total} transaction{total !== 1 ? 's' : ''}</div>

      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e0e0e0', backgroundColor: '#fafafa' }}>
            <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Date</th>
            <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Ref</th>
            <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Description</th>
            <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px' }}>Accounts</th>
            <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px' }}>Amount</th>
            <th style={{ textAlign: 'center', padding: '8px', fontSize: '12px' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const isExpanded = expandedId === tx.id
            const totalDebit = tx.entries.reduce((s, e) => s + e.debit, 0)
            const primaryAccount = accountMap.get(tx.entries[0]?.account_id)?.name ?? ''
            const accountLabel = tx.entries.length <= 2 ? primaryAccount : `${primaryAccount} (split ${tx.entries.length})`
            const isLocked = tx.is_locked !== 0
            const isVoid = tx.is_void !== 0
            const canEdit = editMode && !isLocked && !isVoid
            const modified = isModified(tx.id)
            const edit = getEdit(tx)

            return (
              <tr key={tx.id} style={{ cursor: editMode ? 'default' : 'pointer' }} onClick={() => { if (!editMode) setExpandedId(isExpanded ? null : tx.id) }}>
                <td colSpan={6} style={{ padding: 0 }}>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '100px 70px 1fr 180px 100px 60px',
                    alignItems: 'center', padding: '4px 8px', borderBottom: '1px solid #f0f0f0',
                    textDecoration: isVoid ? 'line-through' : 'none',
                    opacity: isVoid ? 0.5 : (isLocked && editMode) ? 0.6 : 1,
                    backgroundColor: modified ? '#fff8e1' : isLocked ? '#f9f9f9' : 'transparent',
                  }}>
                    {canEdit ? (
                      <input type="date" value={edit.date} onChange={(e) => setEdit(tx.id, 'date', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, tx.id, 'date')}
                        style={{ fontFamily: 'monospace', fontSize: '12px', padding: '2px', border: '1px solid #ddd', width: '90px' }} tabIndex={0} />
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>{tx.date}</span>
                    )}
                    {canEdit ? (
                      <input value={edit.reference} onChange={(e) => setEdit(tx.id, 'reference', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, tx.id, 'reference')}
                        style={{ fontSize: '12px', padding: '2px', border: '1px solid #ddd', width: '60px' }} tabIndex={0} />
                    ) : (
                      <span style={{ fontSize: '12px', color: '#888' }}>{tx.reference ?? ''}</span>
                    )}
                    {canEdit ? (
                      <input value={edit.description} onChange={(e) => setEdit(tx.id, 'description', e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, tx.id, 'description')}
                        style={{ fontSize: '13px', padding: '2px', border: '1px solid #ddd', width: '100%' }} tabIndex={0} />
                    ) : (
                      <span style={{ fontSize: '13px' }}>{tx.description}</span>
                    )}
                    <span style={{ fontSize: '12px', color: '#666' }}>{accountLabel}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>{formatCents(totalDebit)}</span>
                    <span style={{ textAlign: 'center', display: 'flex', gap: '3px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {modified && <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#FF9800', display: 'inline-block' }} title="Modified" />}
                      {tx.journal_type && tx.journal_type !== 'GENERAL' ? <span style={{ backgroundColor: tx.journal_type === 'ADJUSTING' ? '#2196F3' : tx.journal_type === 'CLOSING' ? '#9C27B0' : tx.journal_type === 'REVERSING' ? '#FF9800' : '#607D8B', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold' }}>{tx.journal_type.slice(0, 3)}</span> : null}
                      {isVoid ? <span style={{ backgroundColor: '#f44336', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold' }}>VOID</span> : null}
                      {isLocked && !isVoid ? <span style={{ fontSize: '12px' }} title="Period locked">🔒</span> : null}
                    </span>
                  </div>
                  {isExpanded && !editMode && <ExpandedTransaction tx={tx} accounts={accounts} onRefresh={refresh} />}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Pagination */}
      {total > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', fontSize: '13px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '4px 8px' }}>Prev</button>
            <span>Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '4px 8px' }}>Next</button>
          </div>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ padding: '4px' }}>
            <option value={25}>25/page</option>
            <option value={50}>50/page</option>
            <option value={100}>100/page</option>
          </select>
        </div>
      )}
    </div>
  )
}
