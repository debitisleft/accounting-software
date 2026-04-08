import { useState, useEffect, useCallback } from 'react'
import { api, type Account, type Contact, type GLAccountGroup, type Dimension } from '../lib/api'

function formatCents(cents: number): string {
  if (cents === 0) return '-'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function GeneralLedgerPage({ version }: { version: number }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [dimTypes, setDimTypes] = useState<string[]>([])
  const [glData, setGlData] = useState<GLAccountGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Filters
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [contactId, setContactId] = useState('')
  const [journalType, setJournalType] = useState('')
  const [includeVoid, setIncludeVoid] = useState(false)

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {})
    api.listContacts(undefined, undefined, 1).then(setContacts).catch(() => {})
    api.listDimensions().then((dims) => {
      setDimensions(dims.filter((d) => d.is_active === 1))
      setDimTypes([...new Set(dims.filter((d) => d.is_active === 1).map((d) => d.type))])
    }).catch(() => {})
  }, [version])

  const runReport = useCallback(() => {
    setLoading(true)
    setError(null)
    api
      .getGeneralLedger({
        account_ids: selectedAccountIds.length > 0 ? selectedAccountIds : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        contact_id: contactId || undefined,
        journal_type: journalType || undefined,
        include_void: includeVoid,
      })
      .then(setGlData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [selectedAccountIds, startDate, endDate, contactId, journalType, includeVoid])

  useEffect(() => {
    runReport()
  }, [version])

  const toggleCollapse = (accountId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const grandTotalDebits = glData.reduce((s, g) => s + g.total_debits, 0)
  const grandTotalCredits = glData.reduce((s, g) => s + g.total_credits, 0)

  const handleExportCsv = () => {
    const rows: string[] = ['Account Code,Account Name,Date,Ref,Description,Contact,Debit,Credit,Balance']
    for (const group of glData) {
      for (const entry of group.entries) {
        rows.push([
          group.account.code,
          `"${group.account.name}"`,
          entry.date,
          entry.reference || '',
          `"${entry.description.replace(/"/g, '""')}"`,
          entry.contact_name || '',
          (entry.debit / 100).toFixed(2),
          (entry.credit / 100).toFixed(2),
          (entry.running_balance / 100).toFixed(2),
        ].join(','))
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'general-ledger.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>General Ledger</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExportCsv} style={{ padding: '6px 12px', cursor: 'pointer' }}>Export CSV</button>
          <button onClick={() => window.print()} style={{ padding: '6px 12px', cursor: 'pointer' }}>Print</button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 8, backgroundColor: '#fee', color: '#c00', marginBottom: 12, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Filter Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, padding: 12, backgroundColor: '#f0f4f8', borderRadius: 8, alignItems: 'end', fontSize: 12 }}>
        <label>
          Account
          <select
            value={selectedAccountIds.length === 1 ? selectedAccountIds[0] : ''}
            onChange={(e) => setSelectedAccountIds(e.target.value ? [e.target.value] : [])}
            style={{ display: 'block', padding: 4, minWidth: 150, marginTop: 2 }}
          >
            <option value="">All Accounts</option>
            {accounts.filter((a) => a.is_active).map((a) => (
              <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
            ))}
          </select>
        </label>
        <label>
          Start Date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            style={{ display: 'block', padding: 4, marginTop: 2 }} />
        </label>
        <label>
          End Date
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            style={{ display: 'block', padding: 4, marginTop: 2 }} />
        </label>
        <label>
          Contact
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}
            style={{ display: 'block', padding: 4, minWidth: 120, marginTop: 2 }}>
            <option value="">All</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Journal Type
          <select value={journalType} onChange={(e) => setJournalType(e.target.value)}
            style={{ display: 'block', padding: 4, marginTop: 2 }}>
            <option value="">All</option>
            <option value="GENERAL">General</option>
            <option value="ADJUSTING">Adjusting</option>
            <option value="CLOSING">Closing</option>
            <option value="REVERSING">Reversing</option>
            <option value="OPENING">Opening</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
          <input type="checkbox" checked={includeVoid} onChange={(e) => setIncludeVoid(e.target.checked)} />
          Include Voided
        </label>
        <button
          onClick={runReport}
          style={{ padding: '6px 16px', backgroundColor: '#4a90d9', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', alignSelf: 'end' }}
        >
          Run
        </button>
      </div>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>Loading...</div>
      ) : glData.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#888' }}>No entries found</div>
      ) : (
        <>
          {glData.map((group) => {
            const isCollapsed = collapsed.has(group.account.id)
            return (
              <div key={group.account.id} style={{ marginBottom: 16, border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
                {/* Account Header */}
                <div
                  onClick={() => toggleCollapse(group.account.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', padding: '10px 16px',
                    backgroundColor: '#f5f5f5', cursor: 'pointer', fontWeight: 600, fontSize: 14,
                  }}
                >
                  <span>{isCollapsed ? '\u25B6' : '\u25BC'} {group.account.code} - {group.account.name}</span>
                  <span style={{ display: 'flex', gap: 24, fontSize: 13 }}>
                    <span>Opening: {formatCents(group.opening_balance)}</span>
                    <span>Closing: {formatCents(group.closing_balance)}</span>
                  </span>
                </div>

                {!isCollapsed && (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #ddd', backgroundColor: '#fafafa' }}>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Date</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Ref</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Description</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Contact</th>
                          <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 600 }}>Dimensions</th>
                          <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600 }}>Debit</th>
                          <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600 }}>Credit</th>
                          <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 600 }}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.entries.map((entry, i) => (
                          <tr
                            key={i}
                            style={{
                              borderBottom: '1px solid #f0f0f0',
                              textDecoration: entry.is_void ? 'line-through' : 'none',
                              opacity: entry.is_void ? 0.5 : 1,
                            }}
                          >
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{entry.date}</td>
                            <td style={{ padding: '5px 10px', color: '#888', fontSize: 12 }}>{entry.reference || ''}</td>
                            <td style={{ padding: '5px 10px' }}>{entry.description}</td>
                            <td style={{ padding: '5px 10px', fontSize: 12 }}>{entry.contact_name || ''}</td>
                            <td style={{ padding: '5px 10px' }}>
                              {entry.dimensions.map((d, j) => (
                                <span key={j} style={{ display: 'inline-block', padding: '1px 5px', marginRight: 3, borderRadius: 3, backgroundColor: '#e8eaf6', fontSize: 10 }}>
                                  {d.type}: {d.name}
                                </span>
                              ))}
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                              {entry.debit > 0 ? formatCents(entry.debit) : ''}
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace' }}>
                              {entry.credit > 0 ? formatCents(entry.credit) : ''}
                            </td>
                            <td style={{ padding: '5px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 500 }}>
                              {formatCents(entry.running_balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #ccc', fontWeight: 600 }}>
                          <td colSpan={5} style={{ padding: '6px 10px' }}>Totals</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(group.total_debits)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(group.total_credits)}</td>
                          <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(group.closing_balance)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </>
                )}
              </div>
            )
          })}

          {/* Grand Totals */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, padding: '12px 16px', backgroundColor: '#e8eaf6', borderRadius: 8, fontWeight: 600, fontSize: 14 }}>
            <span>Grand Total Debits: {formatCents(grandTotalDebits)}</span>
            <span>Grand Total Credits: {formatCents(grandTotalCredits)}</span>
          </div>
        </>
      )}

      {/* Print CSS */}
      <style>{`
        @media print {
          nav, button, select, input, label { display: none !important; }
          div[style*="f0f4f8"] { display: none !important; }
          div[style*="e8eaf6"] { break-before: avoid; }
        }
      `}</style>
    </div>
  )
}
