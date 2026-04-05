import { useState, useEffect } from 'react'
import { api, type AppMetadata, type BackupInfo } from '../lib/api'

export function SettingsPage({ version }: { version: number }) {
  const [metadata, setMetadata] = useState<AppMetadata | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [msg, setMsg] = useState('')

  // Settings state
  const [companyName, setCompanyName] = useState('')
  const [fiscalMonth, setFiscalMonth] = useState('1')
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const [dateFormat, setDateFormat] = useState('YYYY-MM-DD')
  const [settingsMsg, setSettingsMsg] = useState('')

  useEffect(() => {
    api.getAppMetadata().then(setMetadata).catch(() => {})
    api.listBackups().then(setBackups).catch(() => {})
    api.getAllSettings().then((s) => {
      setCompanyName(s.company_name ?? 'My Company')
      setFiscalMonth(s.fiscal_year_start_month ?? '1')
      setCurrencySymbol(s.currency_symbol ?? '$')
      setDateFormat(s.date_format ?? 'YYYY-MM-DD')
    }).catch(() => {})
  }, [version])

  const saveSettings = async () => {
    try {
      await api.setSetting('company_name', companyName)
      await api.setSetting('fiscal_year_start_month', fiscalMonth)
      await api.setSetting('currency_symbol', currencySymbol)
      await api.setSetting('date_format', dateFormat)
      setSettingsMsg('Settings saved')
    } catch (e) {
      setSettingsMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleAutoBackup = async () => {
    try {
      const result = await api.autoBackup()
      setMsg(`Backup created: ${result.path} (${result.backup_count} total)`)
      api.listBackups().then(setBackups)
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div style={{ padding: '24px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Settings</h2>

      {/* Company & Preferences */}
      <section style={{ marginBottom: '32px' }}>
        <h3>Company & Preferences</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '400px' }}>
          <label style={{ fontSize: '13px' }}>
            Company Name
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={{ display: 'block', width: '100%', padding: '6px', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '13px' }}>
            Fiscal Year Start Month
            <select value={fiscalMonth} onChange={(e) => setFiscalMonth(e.target.value)} style={{ display: 'block', width: '100%', padding: '6px', marginTop: '4px' }}>
              {months.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: '13px' }}>
            Currency Symbol
            <input value={currencySymbol} onChange={(e) => setCurrencySymbol(e.target.value)} style={{ display: 'block', width: '60px', padding: '6px', marginTop: '4px' }} />
          </label>
          <label style={{ fontSize: '13px' }}>
            Date Format
            <select value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} style={{ display: 'block', width: '100%', padding: '6px', marginTop: '4px' }}>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
            </select>
          </label>
          <button onClick={saveSettings} style={{ padding: '8px 20px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', alignSelf: 'start' }}>
            Save Settings
          </button>
          {settingsMsg && <div style={{ fontSize: '13px', color: settingsMsg.startsWith('Error') ? 'red' : 'green' }}>{settingsMsg}</div>}
        </div>
      </section>

      {/* About */}
      <section style={{ marginBottom: '32px' }}>
        <h3>About</h3>
        {metadata && (
          <div style={{ fontSize: '13px', lineHeight: 1.8 }}>
            <div>Version: <strong>{metadata.version}</strong></div>
            <div>Database: <code style={{ fontSize: '12px' }}>{metadata.db_path}</code></div>
          </div>
        )}
      </section>

      {/* Backup & Restore */}
      <section style={{ marginBottom: '32px' }}>
        <h3>Backup & Restore</h3>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button onClick={handleAutoBackup} style={{ padding: '8px 16px', cursor: 'pointer', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px' }}>
            Create Backup Now
          </button>
        </div>
        {msg && <div style={{ fontSize: '13px', marginBottom: '12px', color: msg.startsWith('Error') ? 'red' : 'green' }}>{msg}</div>}

        <h4>Auto-Backups</h4>
        {backups.length === 0 ? (
          <p style={{ color: '#888', fontSize: '13px' }}>No backups found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #ddd' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px' }}>Filename</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Size</th>
                <th style={{ textAlign: 'right', padding: '4px 8px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.path} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: '12px' }}>{b.filename}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right' }}>{formatBytes(b.size)}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'right', color: '#666' }}>{b.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
