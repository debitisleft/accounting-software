import { useState, useEffect } from 'react'
import { api, type AppMetadata, type BackupInfo } from '../lib/api'

export function SettingsPage({ version }: { version: number }) {
  const [metadata, setMetadata] = useState<AppMetadata | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [msg, setMsg] = useState('')

  useEffect(() => {
    api.getAppMetadata().then(setMetadata).catch(() => {})
    api.listBackups().then(setBackups).catch(() => {})
  }, [version])

  const handleExport = async () => {
    setMsg('Export requires Tauri file dialog — run in desktop app.')
  }

  const handleImport = async () => {
    setMsg('Import requires Tauri file dialog — run in desktop app.')
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

  return (
    <div style={{ padding: '24px', maxWidth: '700px', margin: '0 auto' }}>
      <h2>Settings</h2>

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
          <button onClick={handleExport} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Export Database
          </button>
          <button onClick={handleImport} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Import Database
          </button>
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
