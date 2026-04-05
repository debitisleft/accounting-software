import { useState, useEffect } from 'react'
import { api, type TransactionWithEntries, type Account } from '../lib/api'

function formatCents(cents: number): string {
  if (cents === 0) return ''
  const abs = Math.abs(cents)
  const dollars = Math.floor(abs / 100)
  const remainder = abs % 100
  return `$${dollars.toLocaleString()}.${String(remainder).padStart(2, '0')}`
}

export function TransactionRegister({ version }: { version: number }) {
  const [transactions, setTransactions] = useState<TransactionWithEntries[]>([])
  const [total, setTotal] = useState(0)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [accountId, setAccountId] = useState('')
  const [memoSearch, setMemoSearch] = useState('')

  // Pagination
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [version])

  useEffect(() => {
    setPage(0)
  }, [startDate, endDate, accountId, memoSearch, pageSize])

  useEffect(() => {
    api
      .listTransactions({
        offset: page * pageSize,
        limit: pageSize,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        account_id: accountId || undefined,
        memo_search: memoSearch || undefined,
      })
      .then((result) => {
        setTransactions(result.transactions)
        setTotal(result.total)
        setError(null)
      })
      .catch((e) => setError(String(e)))
  }, [version, page, pageSize, startDate, endDate, accountId, memoSearch])

  const totalPages = Math.ceil(total / pageSize)
  const accountMap = new Map(accounts.map((a) => [a.id, a]))

  const clearFilters = () => {
    setStartDate('')
    setEndDate('')
    setAccountId('')
    setMemoSearch('')
  }

  const hasFilters = startDate || endDate || accountId || memoSearch

  if (error) return <div style={{ padding: '20px', color: 'red' }}>Error: {error}</div>

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <h2>Transaction Register</h2>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '6px' }}>
        <label style={{ fontSize: '12px' }}>
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ display: 'block', padding: '4px' }} />
        </label>
        <label style={{ fontSize: '12px' }}>
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ display: 'block', padding: '4px' }} />
        </label>
        <label style={{ fontSize: '12px' }}>
          Account
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ display: 'block', padding: '4px' }}>
            <option value="">All</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '12px' }}>
          Search
          <input type="text" value={memoSearch} onChange={(e) => setMemoSearch(e.target.value)} placeholder="Search descriptions..." style={{ display: 'block', padding: '4px', width: '160px' }} />
        </label>
        {hasFilters && (
          <button onClick={clearFilters} style={{ alignSelf: 'end', padding: '4px 12px', cursor: 'pointer' }}>
            Clear Filters
          </button>
        )}
      </div>

      {/* Results info */}
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>
        {total} transaction{total !== 1 ? 's' : ''} found
      </div>

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
            const accountNames = tx.entries
              .map((e) => accountMap.get(e.account_id)?.name ?? e.account_id)
            const primaryAccount = accountNames[0] ?? ''
            const accountLabel = tx.entries.length <= 2
              ? primaryAccount
              : `${primaryAccount} (split ${tx.entries.length})`

            return (
              <tr key={tx.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(isExpanded ? null : tx.id)}>
                <td colSpan={6} style={{ padding: 0 }}>
                  {/* Main row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '90px 60px 1fr 180px 100px 60px',
                    alignItems: 'center',
                    padding: '8px',
                    borderBottom: '1px solid #f0f0f0',
                    textDecoration: tx.is_void ? 'line-through' : 'none',
                    opacity: tx.is_void ? 0.5 : 1,
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '13px' }}>{tx.date}</span>
                    <span style={{ fontSize: '12px', color: '#888' }}>{tx.reference ?? ''}</span>
                    <span style={{ fontSize: '13px' }}>{tx.description}</span>
                    <span style={{ fontSize: '12px', color: '#666' }}>{accountLabel}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '13px' }}>
                      {formatCents(totalDebit)}
                    </span>
                    <span style={{ textAlign: 'center' }}>
                      {tx.is_void ? (
                        <span style={{ backgroundColor: '#f44336', color: '#fff', padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 'bold' }}>VOID</span>
                      ) : null}
                    </span>
                  </div>

                  {/* Expanded entries */}
                  {isExpanded && (
                    <div style={{ padding: '8px 8px 8px 40px', backgroundColor: '#fafafa', borderBottom: '1px solid #e0e0e0' }}>
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
                          {tx.entries.map((entry) => {
                            const acct = accountMap.get(entry.account_id)
                            return (
                              <tr key={entry.id}>
                                <td style={{ padding: '4px' }}>{acct ? `${acct.code} — ${acct.name}` : entry.account_id}</td>
                                <td style={{ padding: '4px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(entry.debit)}</td>
                                <td style={{ padding: '4px', textAlign: 'right', fontFamily: 'monospace' }}>{formatCents(entry.credit)}</td>
                                <td style={{ padding: '4px', color: '#888' }}>{entry.memo ?? ''}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
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
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} style={{ padding: '4px 8px', cursor: page === 0 ? 'not-allowed' : 'pointer' }}>
              Prev
            </button>
            <span>Page {page + 1} of {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ padding: '4px 8px', cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>
              Next
            </button>
          </div>
          <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} style={{ padding: '4px' }}>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>
        </div>
      )}
    </div>
  )
}
