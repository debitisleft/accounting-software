import { useState, useEffect } from 'react'
import { api, type RecentFile } from '../lib/api'

export function WelcomeScreen({ onFileOpened }: { onFileOpened: () => void }) {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([])
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.getRecentFiles().then(setRecentFiles).catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!companyName.trim()) {
      setError('Please enter a company name')
      return
    }
    setError('')
    try {
      // In Tauri, this would use a save dialog. In dev/browser, use a default path.
      const path = `${companyName.trim().replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}.sqlite`
      await api.createNewFile(path, companyName.trim())
      onFileOpened()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleOpen = async () => {
    setError('')
    try {
      // In Tauri, this would use an open dialog. In dev/browser, prompt for path.
      const path = prompt('Enter path to .sqlite file:')
      if (!path) return
      await api.openFile(path)
      onFileOpened()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const handleOpenRecent = async (path: string) => {
    setError('')
    try {
      await api.openRecentFile(path)
      onFileOpened()
    } catch (e) {
      setError(`Could not open file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleRemoveRecent = async (path: string) => {
    await api.removeRecentFile(path)
    setRecentFiles((prev) => prev.filter((f) => f.path !== path))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', backgroundColor: '#f5f5f5' }}>
      <div style={{ maxWidth: '500px', width: '100%', padding: '40px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '28px', color: '#1a1a2e' }}>Bookkeeping</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '32px', fontSize: '14px' }}>
          Double-entry accounting — your data, your files, your control.
        </p>

        {/* New Company File */}
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>New Company File</h3>
          {creating ? (
            <div>
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Company name"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                style={{ width: '100%', padding: '8px', marginBottom: '8px', boxSizing: 'border-box', border: '1px solid #ddd', borderRadius: '4px' }}
              />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleCreate} style={{ flex: 1, padding: '8px', backgroundColor: '#4CAF50', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  Create
                </button>
                <button onClick={() => { setCreating(false); setCompanyName('') }} style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', border: '1px solid #ddd', backgroundColor: '#fff' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
              + New Company File
            </button>
          )}
        </div>

        {/* Open Existing */}
        <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <button onClick={handleOpen} style={{ width: '100%', padding: '10px', backgroundColor: '#fff', color: '#333', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' }}>
            Open Existing File...
          </button>
        </div>

        {error && <div style={{ color: 'red', fontSize: '13px', marginBottom: '16px', textAlign: 'center' }}>{error}</div>}

        {/* Recent Files */}
        {recentFiles.length > 0 && (
          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Recent Files</h3>
            {recentFiles.map((file) => (
              <div
                key={file.path}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
              >
                <div
                  style={{ cursor: 'pointer', flex: 1 }}
                  onClick={() => handleOpenRecent(file.path)}
                >
                  <div style={{ fontWeight: 500, fontSize: '14px' }}>{file.company_name}</div>
                  <div style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>{file.path}</div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveRecent(file.path) }}
                  style={{ background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '16px', padding: '4px' }}
                  title="Remove from list"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        <p style={{ textAlign: 'center', color: '#aaa', fontSize: '11px', marginTop: '24px' }}>
          Each company file is a standard .sqlite database — portable, inspectable, yours.
        </p>
      </div>
    </div>
  )
}
