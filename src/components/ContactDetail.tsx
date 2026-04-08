import { useState, useEffect, useCallback } from 'react'
import { api, type Contact, type ContactLedgerResult } from '../lib/api'

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

export function ContactDetail({
  contactId,
  version,
  onBack,
}: {
  contactId: string
  version: number
  onBack: () => void
}) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [ledger, setLedger] = useState<ContactLedgerResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Edit state
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const reload = useCallback(() => {
    setLoading(true)
    Promise.all([api.getContact(contactId), api.getContactLedger(contactId)])
      .then(([c, l]) => {
        setContact(c)
        setLedger(l)
        setEditName(c.name)
        setEditCompany(c.company_name || '')
        setEditEmail(c.email || '')
        setEditPhone(c.phone || '')
        setEditNotes(c.notes || '')
        setError(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [contactId])

  useEffect(() => {
    reload()
  }, [version, reload])

  const handleSave = async () => {
    try {
      await api.updateContact(contactId, {
        name: editName.trim(),
        companyName: editCompany.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        notes: editNotes.trim(),
      })
      setEditing(false)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  if (loading) {
    return <div style={{ padding: 24, color: '#888' }}>Loading...</div>
  }

  if (!contact) {
    return <div style={{ padding: 24, color: '#c00' }}>Contact not found</div>
  }

  return (
    <div style={{ padding: 24, maxWidth: 1000 }}>
      <button
        onClick={onBack}
        style={{ marginBottom: 16, cursor: 'pointer', background: 'none', border: 'none', color: '#4a90d9', fontSize: 14 }}
      >
        &larr; Back to Contacts
      </button>

      {error && (
        <div style={{ padding: 8, backgroundColor: '#fee', color: '#c00', marginBottom: 12, borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Contact Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{contact.name}</h2>
          <span
            style={{
              fontSize: 12,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor:
                contact.type === 'CUSTOMER' ? '#e8f5e9' :
                contact.type === 'VENDOR' ? '#e3f2fd' :
                contact.type === 'EMPLOYEE' ? '#fff3e0' : '#f5f5f5',
            }}
          >
            {contact.type}
          </span>
          {!contact.is_active && (
            <span style={{ marginLeft: 8, fontSize: 12, color: '#c00' }}>INACTIVE</span>
          )}
        </div>
        <button
          onClick={() => setEditing(!editing)}
          style={{ padding: '6px 12px', cursor: 'pointer' }}
        >
          {editing ? 'Cancel' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div style={{ padding: 16, backgroundColor: '#f0f4f8', borderRadius: 8, marginBottom: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Name</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Company</label>
              <input value={editCompany} onChange={(e) => setEditCompany(e.target.value)} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Email</label>
              <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Phone</label>
              <input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Notes</label>
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} style={{ width: '100%', padding: 6, marginTop: 4 }} />
            </div>
          </div>
          <button
            onClick={handleSave}
            style={{ marginTop: 12, padding: '8px 16px', backgroundColor: '#4a90d9', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
          >
            Save Changes
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 16px', marginBottom: 24, fontSize: 13 }}>
          <div><strong>Company:</strong> {contact.company_name || '-'}</div>
          <div><strong>Email:</strong> {contact.email || '-'}</div>
          <div><strong>Phone:</strong> {contact.phone || '-'}</div>
          <div><strong>Tax ID:</strong> {contact.tax_id ? `***-**-${contact.tax_id.slice(-4)}` : '-'}</div>
          <div><strong>Country:</strong> {contact.country || '-'}</div>
          {contact.notes && <div style={{ gridColumn: '1 / -1' }}><strong>Notes:</strong> {contact.notes}</div>}
        </div>
      )}

      {/* Summary */}
      {ledger && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <div style={{ padding: 16, backgroundColor: '#f0f4f8', borderRadius: 8, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#666' }}>Total Debits</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCents(ledger.total_debits)}</div>
          </div>
          <div style={{ padding: 16, backgroundColor: '#f0f4f8', borderRadius: 8, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#666' }}>Total Credits</div>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCents(ledger.total_credits)}</div>
          </div>
          <div style={{ padding: 16, backgroundColor: '#f0f4f8', borderRadius: 8, flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#666' }}>Net Balance</div>
            <div style={{ fontSize: 20, fontWeight: 600, color: ledger.net_balance >= 0 ? '#2e7d32' : '#c62828' }}>
              {formatCents(ledger.net_balance)}
            </div>
          </div>
        </div>
      )}

      {/* Ledger */}
      <h3 style={{ marginBottom: 8 }}>Contact Ledger</h3>
      {ledger && ledger.entries.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>No transactions linked to this contact</div>
      ) : ledger ? (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontSize: 12 }}>Date</th>
              <th style={{ padding: '8px 12px', fontSize: 12 }}>Ref</th>
              <th style={{ padding: '8px 12px', fontSize: 12 }}>Description</th>
              <th style={{ padding: '8px 12px', fontSize: 12 }}>Type</th>
              <th style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>Debit</th>
              <th style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>Credit</th>
              <th style={{ padding: '8px 12px', fontSize: 12, textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {ledger.entries.map((e, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>{e.date}</td>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>{e.reference || '-'}</td>
                <td style={{ padding: '8px 12px', fontSize: 13 }}>{e.description}</td>
                <td style={{ padding: '8px 12px', fontSize: 11 }}>
                  <span style={{ padding: '1px 4px', borderRadius: 3, backgroundColor: '#f0f0f0' }}>{e.journal_type}</span>
                </td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{formatCents(e.total_debit)}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right' }}>{formatCents(e.total_credit)}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', fontWeight: 500 }}>{formatCents(e.running_balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}
