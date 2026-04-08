import { useState, useEffect, useCallback } from 'react'
import { api, type DocumentMeta } from '../lib/api'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function DocumentAttachments({
  entityType,
  entityId,
  version,
}: {
  entityType: string
  entityId: string
  version: number
}) {
  const [documents, setDocuments] = useState<DocumentMeta[]>([])
  const [collapsed, setCollapsed] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api.listDocuments(entityType, entityId)
      .then(setDocuments)
      .catch((e) => setError(String(e)))
  }, [entityType, entityId])

  useEffect(() => { reload() }, [version, reload])

  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return
    try {
      await api.deleteDocument(docId)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleOpen = async (docId: string) => {
    try {
      const path = await api.getDocumentPath(docId)
      // In a real Tauri app, this would use shell.open(path)
      console.log('Open document:', path)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ marginTop: 12, border: '1px solid #ddd', borderRadius: 6 }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', cursor: 'pointer', backgroundColor: '#f9f9f9',
          borderRadius: collapsed ? 6 : '6px 6px 0 0',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {collapsed ? '\u25B6' : '\u25BC'} Attachments
          {documents.length > 0 && (
            <span style={{
              marginLeft: 6, display: 'inline-block', minWidth: 18, height: 18,
              lineHeight: '18px', textAlign: 'center', borderRadius: 9,
              backgroundColor: '#4a90d9', color: '#fff', fontSize: 11,
            }}>
              {documents.length}
            </span>
          )}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: 12 }}>
          {error && (
            <div style={{ padding: 6, backgroundColor: '#fee', color: '#c00', fontSize: 12, marginBottom: 8, borderRadius: 4 }}>
              {error}
            </div>
          )}

          {documents.length === 0 ? (
            <div style={{ fontSize: 12, color: '#888', padding: '8px 0' }}>No attachments</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 8px', backgroundColor: '#f5f5f5', borderRadius: 4, fontSize: 12,
                  }}
                >
                  <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => handleOpen(doc.id)}>
                    <div style={{ fontWeight: 500 }}>{doc.filename}</div>
                    <div style={{ color: '#888', fontSize: 11 }}>
                      {formatFileSize(doc.file_size_bytes)} &middot; {doc.mime_type}
                      {doc.description && ` &middot; ${doc.description}`}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(doc.id, doc.filename)}
                    style={{ fontSize: 11, cursor: 'pointer', color: '#c00', background: 'none', border: 'none' }}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
