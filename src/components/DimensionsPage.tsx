import { useState, useEffect, useCallback } from 'react'
import { api, type Dimension } from '../lib/api'

export function DimensionsPage({ version }: { version: number }) {
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [filterType, setFilterType] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // New dimension form
  const [newType, setNewType] = useState('')
  const [customType, setCustomType] = useState('')
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newParentId, setNewParentId] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editCode, setEditCode] = useState('')

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.listDimensions(filterType || undefined),
      api.listDimensionTypes(),
    ])
      .then(([dims, ts]) => {
        setDimensions(dims)
        setTypes(ts)
        setError(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filterType])

  useEffect(() => { reload() }, [version, reload])

  const handleCreate = async () => {
    const dimType = newType === '__custom__' ? customType.toUpperCase().trim() : newType
    if (!dimType || !newName.trim()) return
    try {
      await api.createDimension({
        dimType,
        name: newName.trim(),
        code: newCode.trim() || undefined,
        parentId: newParentId || undefined,
      })
      setNewName('')
      setNewCode('')
      setNewParentId('')
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dimension?')) return
    try {
      await api.deleteDimension(id)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleToggleActive = async (dim: Dimension) => {
    try {
      await api.updateDimension(dim.id, { isActive: dim.is_active === 1 ? 0 : 1 })
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      await api.updateDimension(editingId, {
        name: editName.trim() || undefined,
        code: editCode.trim() || undefined,
      })
      setEditingId(null)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const effectiveType = newType === '__custom__' ? customType.toUpperCase().trim() : newType
  const possibleParents = dimensions.filter(
    (d) => d.type === effectiveType && d.is_active === 1,
  )

  // Group dimensions by type for display
  const grouped = new Map<string, Dimension[]>()
  for (const d of dimensions) {
    const arr = grouped.get(d.type) || []
    arr.push(d)
    grouped.set(d.type, arr)
  }

  if (loading && dimensions.length === 0) return <div style={{ padding: '20px' }}>Loading...</div>

  const defaultTypes = ['CLASS', 'LOCATION', 'PROJECT', 'DEPARTMENT']
  const allTypeOptions = [...new Set([...defaultTypes, ...types])]

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h2>Dimensions</h2>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
        Dimensions are tags you can attach to transaction lines (e.g., Class, Location, Project).
        They enable filtering on all reports.
      </p>

      {error && (
        <div style={{ padding: '10px', backgroundColor: '#ffe6e6', color: 'red', borderRadius: '4px', marginBottom: '12px' }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: '8px', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Filter by type */}
      <div style={{ marginBottom: '16px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label style={{ fontSize: '13px', fontWeight: 600 }}>Filter by type:</label>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ padding: '4px 8px' }}>
          <option value="">All</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      {/* Create new dimension */}
      <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '12px', marginBottom: '20px', backgroundColor: '#f9f9f9' }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Add Dimension</h4>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Type</label>
            <select value={newType} onChange={(e) => setNewType(e.target.value)} style={{ padding: '4px 8px', minWidth: '120px' }}>
              <option value="">Select type...</option>
              {allTypeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              <option value="__custom__">Custom...</option>
            </select>
          </div>
          {newType === '__custom__' && (
            <div>
              <label style={{ fontSize: '12px', display: 'block' }}>Custom Type</label>
              <input value={customType} onChange={(e) => setCustomType(e.target.value)} placeholder="e.g. JOB" style={{ padding: '4px 8px', width: '100px' }} />
            </div>
          )}
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Name</label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Retail" style={{ padding: '4px 8px', width: '140px' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', display: 'block' }}>Code (opt.)</label>
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} placeholder="e.g. RET" style={{ padding: '4px 8px', width: '80px' }} />
          </div>
          {possibleParents.length > 0 && (
            <div>
              <label style={{ fontSize: '12px', display: 'block' }}>Parent (opt.)</label>
              <select value={newParentId} onChange={(e) => setNewParentId(e.target.value)} style={{ padding: '4px 8px' }}>
                <option value="">None</option>
                {possibleParents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          <button onClick={handleCreate} disabled={!effectiveType || !newName.trim()} style={{ padding: '6px 16px', cursor: 'pointer', backgroundColor: '#1976d2', color: '#fff', border: 'none', borderRadius: '4px' }}>
            Add
          </button>
        </div>
      </div>

      {/* Dimensions list grouped by type */}
      {dimensions.length === 0 ? (
        <p style={{ color: '#999' }}>No dimensions yet. Create one above.</p>
      ) : (
        [...grouped.entries()].map(([type, dims]) => (
          <div key={type} style={{ marginBottom: '20px' }}>
            <h3 style={{ borderBottom: '2px solid #333', paddingBottom: '4px', fontSize: '15px' }}>
              {type} <span style={{ fontSize: '12px', color: '#888', fontWeight: 'normal' }}>({dims.length})</span>
            </h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ddd' }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '12px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '12px' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '12px' }}>Parent</th>
                  <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: '12px' }}>Active</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '12px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dims.map((d) => {
                  const parentName = d.parent_id
                    ? dimensions.find((p) => p.id === d.parent_id)?.name ?? ''
                    : ''
                  const indent = d.depth * 20
                  const isEditing = editingId === d.id
                  return (
                    <tr key={d.id} style={{ borderBottom: '1px solid #eee', opacity: d.is_active ? 1 : 0.5 }}>
                      <td style={{ padding: '6px 8px', paddingLeft: `${8 + indent}px` }}>
                        {isEditing ? (
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ padding: '2px 4px', width: '120px' }} />
                        ) : d.name}
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '12px' }}>
                        {isEditing ? (
                          <input value={editCode} onChange={(e) => setEditCode(e.target.value)} style={{ padding: '2px 4px', width: '60px' }} />
                        ) : (d.code ?? '')}
                      </td>
                      <td style={{ padding: '6px 8px', color: '#666', fontSize: '12px' }}>{parentName}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                        <span style={{ color: d.is_active ? 'green' : 'red', fontSize: '12px' }}>
                          {d.is_active ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {isEditing ? (
                          <>
                            <button onClick={handleSaveEdit} style={{ fontSize: '12px', cursor: 'pointer', marginRight: '4px' }}>Save</button>
                            <button onClick={() => setEditingId(null)} style={{ fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => { setEditingId(d.id); setEditName(d.name); setEditCode(d.code ?? '') }} style={{ fontSize: '12px', cursor: 'pointer', marginRight: '4px' }}>Edit</button>
                            <button onClick={() => handleToggleActive(d)} style={{ fontSize: '12px', cursor: 'pointer', marginRight: '4px' }}>
                              {d.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => handleDelete(d.id)} style={{ fontSize: '12px', cursor: 'pointer', color: 'red' }}>Delete</button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  )
}
