import { useState, useEffect } from 'react'
import { api, type Account } from '../lib/api'

type ColumnMapping = {
  date: number | null
  description: number | null
  account: number | null
  debit: number | null
  credit: number | null
}

function parseCsv(text: string): string[][] {
  return text.trim().split('\n').map((line) => {
    const row: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue }
      if (ch === ',' && !inQuotes) { row.push(current.trim()); current = ''; continue }
      current += ch
    }
    row.push(current.trim())
    return row
  })
}

export function CsvImport({ version, onImported }: { version: number; onImported: () => void }) {
  const [_csvText, setCsvText] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({ date: null, description: null, account: null, debit: null, credit: null })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; duplicates: number; errors: { row: number; message: string }[] } | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    api.getAccounts().then(setAccounts).catch(() => {})
  }, [version])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvText(text)
      const parsed = parseCsv(text)
      if (parsed.length > 0) {
        setHeaders(parsed[0])
        setRows(parsed.slice(1))
        // Auto-detect columns
        const h = parsed[0].map((s) => s.toLowerCase())
        setMapping({
          date: h.findIndex((c) => c.includes('date')),
          description: h.findIndex((c) => c.includes('desc') || c.includes('memo') || c.includes('payee')),
          account: h.findIndex((c) => c.includes('account') || c.includes('category')),
          debit: h.findIndex((c) => c.includes('debit') || c.includes('withdrawal')),
          credit: h.findIndex((c) => c.includes('credit') || c.includes('deposit')),
        })
      }
      setImportResult(null)
    }
    reader.readAsText(file)
  }

  const handleImport = async () => {
    if (mapping.date === null || mapping.date < 0) return
    setImporting(true)
    const mapped = rows.map((row) => ({
      date: mapping.date !== null && mapping.date >= 0 ? row[mapping.date] ?? '' : '',
      description: mapping.description !== null && mapping.description >= 0 ? row[mapping.description] ?? '' : '',
      account_code: mapping.account !== null && mapping.account >= 0 ? row[mapping.account] ?? '' : '',
      debit: mapping.debit !== null && mapping.debit >= 0 ? Math.round(parseFloat(row[mapping.debit] || '0') * 100) : 0,
      credit: mapping.credit !== null && mapping.credit >= 0 ? Math.round(parseFloat(row[mapping.credit] || '0') * 100) : 0,
    })).filter((r) => r.date || r.description || r.debit || r.credit)

    // For real Tauri: call a backend command. For now we simulate via createTransaction per row.
    let imported = 0, skipped = 0, duplicates = 0
    const errors: { row: number; message: string }[] = []
    const accountMap = new Map(accounts.map((a) => [a.code, a]))
    const cashAcct = accounts.find((a) => a.code === '1000')

    for (let i = 0; i < mapped.length; i++) {
      const r = mapped[i]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) { errors.push({ row: i, message: `Invalid date: "${r.date}"` }); skipped++; continue }
      const acct = accountMap.get(r.account_code)
      if (!acct) { errors.push({ row: i, message: `Unknown account: "${r.account_code}"` }); skipped++; continue }
      if (r.debit === 0 && r.credit === 0) { errors.push({ row: i, message: 'No amount' }); skipped++; continue }
      if (!cashAcct) { errors.push({ row: i, message: 'No cash account for offset' }); skipped++; continue }

      try {
        await api.createTransaction({
          date: r.date,
          description: r.description || `Import row ${i + 1}`,
          entries: [
            { account_id: acct.id, debit: r.debit, credit: r.credit },
            { account_id: cashAcct.id, debit: r.credit, credit: r.debit },
          ],
        })
        imported++
      } catch (e) {
        errors.push({ row: i, message: e instanceof Error ? e.message : String(e) })
        skipped++
      }
    }

    setImportResult({ imported, skipped, duplicates, errors })
    setImporting(false)
    if (imported > 0) onImported()
  }

  const preview = rows.slice(0, 10)
  const colOptions = [{ value: -1, label: '(skip)' }, ...headers.map((h, i) => ({ value: i, label: h }))]

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      <h2>Import CSV</h2>

      <div style={{ marginBottom: '16px' }}>
        <input type="file" accept=".csv" onChange={handleFileUpload} />
      </div>

      {headers.length > 0 && (
        <>
          <h3>Column Mapping</h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px', padding: '12px', backgroundColor: '#f5f5f5', borderRadius: '6px' }}>
            {(['date', 'description', 'account', 'debit', 'credit'] as const).map((field) => (
              <label key={field} style={{ fontSize: '13px' }}>
                {field.charAt(0).toUpperCase() + field.slice(1)}
                <select value={mapping[field] ?? -1} onChange={(e) => setMapping((m) => ({ ...m, [field]: parseInt(e.target.value) }))}
                  style={{ display: 'block', padding: '4px' }}>
                  {colOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>

          <h3>Preview (first 10 rows)</h3>
          <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '12px', width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #333' }}>
                  {headers.map((h, i) => <th key={i} style={{ padding: '4px 8px', textAlign: 'left' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, ri) => (
                  <tr key={ri} style={{ borderBottom: '1px solid #ddd' }}>
                    {row.map((cell, ci) => <td key={ci} style={{ padding: '4px 8px' }}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button onClick={handleImport} disabled={importing || mapping.date === null || mapping.date < 0}
              style={{ padding: '8px 24px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
              {importing ? 'Importing...' : `Import ${rows.length} rows`}
            </button>
            <span style={{ fontSize: '13px', color: '#888' }}>{rows.length} data rows detected</span>
          </div>
        </>
      )}

      {importResult && (
        <div style={{ marginTop: '16px', padding: '16px', borderRadius: '6px', backgroundColor: importResult.imported > 0 ? '#e6ffe6' : '#fff3e0' }}>
          <h3 style={{ margin: '0 0 8px' }}>Import Summary</h3>
          <div style={{ fontSize: '14px' }}>
            <div><strong>{importResult.imported}</strong> imported</div>
            <div><strong>{importResult.skipped}</strong> skipped</div>
            {importResult.duplicates > 0 && <div><strong>{importResult.duplicates}</strong> duplicates detected</div>}
          </div>
          {importResult.errors.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <strong>Errors:</strong>
              <ul style={{ margin: '4px 0', fontSize: '12px', color: 'red' }}>
                {importResult.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>Row {e.row + 1}: {e.message}</li>
                ))}
                {importResult.errors.length > 20 && <li>...and {importResult.errors.length - 20} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
