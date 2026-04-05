import { useState, useEffect } from 'react'
import { api, type LockedPeriod } from '../lib/api'

export function PeriodManagement({ version }: { version: number }) {
  const [periods, setPeriods] = useState<LockedPeriod[]>([])
  const [lockDate, setLockDate] = useState('')
  const [msg, setMsg] = useState('')

  const refresh = () => {
    api.listLockedPeriodsGlobal().then(setPeriods).catch(() => {})
  }

  useEffect(refresh, [version])

  const handleLock = async () => {
    if (!lockDate) return
    if (!confirm(`This will prevent editing all transactions through ${lockDate}. Continue?`)) return
    try {
      await api.lockPeriodGlobal(lockDate)
      setMsg(`Locked through ${lockDate}`)
      setLockDate('')
      refresh()
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handleUnlock = async () => {
    if (!confirm('This will unlock the most recent period. Continue?')) return
    try {
      await api.unlockPeriodGlobal()
      setMsg('Most recent period unlocked')
      refresh()
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const latestLock = periods.length > 0 ? periods[0].end_date : null

  return (
    <div>
      <h3>Period Locking</h3>
      <p style={{ fontSize: '13px', color: '#666' }}>
        Locked periods prevent editing or voiding transactions. {latestLock ? `Currently locked through ${latestLock}.` : 'No periods are currently locked.'}
      </p>

      <div style={{ display: 'flex', gap: '8px', alignItems: 'end', marginBottom: '16px' }}>
        <label style={{ fontSize: '13px' }}>
          Lock through date
          <input type="date" value={lockDate} onChange={(e) => setLockDate(e.target.value)} style={{ display: 'block', padding: '4px', marginTop: '4px' }} />
        </label>
        <button onClick={handleLock} disabled={!lockDate} style={{ padding: '6px 16px', backgroundColor: '#f44336', color: '#fff', border: 'none', borderRadius: '4px', cursor: lockDate ? 'pointer' : 'not-allowed' }}>
          Lock Period
        </button>
        {periods.length > 0 && (
          <button onClick={handleUnlock} style={{ padding: '6px 16px', cursor: 'pointer' }}>
            Unlock Most Recent
          </button>
        )}
      </div>

      {msg && <div style={{ fontSize: '13px', marginBottom: '12px', color: msg.startsWith('Error') ? 'red' : 'green' }}>{msg}</div>}

      {periods.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', maxWidth: '400px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px' }}>Locked Through</th>
              <th style={{ textAlign: 'right', padding: '4px 8px' }}>Locked At</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{p.end_date}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#666' }}>
                  {new Date(p.locked_at * 1000).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
