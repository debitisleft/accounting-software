import { useState, useEffect } from 'react'
import { api, type Dimension, type DimensionFilter } from '../lib/api'

export function DimensionFilterBar({
  version,
  onChange,
}: {
  version: number
  onChange: (filters: DimensionFilter[]) => void
}) {
  const [dimensions, setDimensions] = useState<Dimension[]>([])
  const [types, setTypes] = useState<string[]>([])
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    api.listDimensions().then((dims) => {
      const active = dims.filter((d) => d.is_active === 1)
      setDimensions(active)
      setTypes([...new Set(active.map((d) => d.type))].sort())
    }).catch(() => {})
  }, [version])

  const handleToggle = (type: string, dimId: string) => {
    setSelected((prev) => {
      const next = { ...prev }
      const set = new Set(next[type] || [])
      if (set.has(dimId)) {
        set.delete(dimId)
      } else {
        set.add(dimId)
      }
      next[type] = set

      // Build filters and notify parent
      const filters: DimensionFilter[] = []
      for (const [t, ids] of Object.entries(next)) {
        for (const id of ids) {
          filters.push({ type: t, dimension_id: id })
        }
      }
      // Use setTimeout to avoid setState-during-render
      setTimeout(() => onChange(filters), 0)

      return next
    })
  }

  if (types.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px' }}>
      <span style={{ fontWeight: 600, color: '#666' }}>Dimensions:</span>
      {types.map((type) => {
        const typeDims = dimensions.filter((d) => d.type === type)
        const sel = selected[type] || new Set()
        return (
          <div key={type} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#888', textTransform: 'uppercase' }}>{type}:</span>
            {typeDims.map((dim) => {
              const isSelected = sel.has(dim.id)
              return (
                <button
                  key={dim.id}
                  onClick={() => handleToggle(type, dim.id)}
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    border: isSelected ? '1px solid #1976d2' : '1px solid #ccc',
                    backgroundColor: isSelected ? '#e3f2fd' : 'transparent',
                    color: isSelected ? '#1976d2' : '#666',
                    cursor: 'pointer',
                  }}
                >
                  {dim.code || dim.name}
                </button>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
