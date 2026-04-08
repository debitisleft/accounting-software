import { useState, useEffect, useCallback } from 'react'
import { api, type Contact } from '../lib/api'

const contactTypes = ['ALL', 'CUSTOMER', 'VENDOR', 'EMPLOYEE', 'OTHER'] as const

export function ContactsPage({
  version,
  onSelectContact,
}: {
  version: number
  onSelectContact: (contactId: string) => void
}) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [filterType, setFilterType] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [newType, setNewType] = useState<string>('CUSTOMER')
  const [newName, setNewName] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')

  const reload = useCallback(() => {
    setLoading(true)
    api
      .listContacts(
        filterType === 'ALL' ? undefined : filterType,
        search || undefined,
      )
      .then((c) => {
        setContacts(c)
        setError(null)
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [filterType, search])

  useEffect(() => {
    reload()
  }, [version, reload])

  const handleCreate = async () => {
    if (!newName.trim()) return
    try {
      await api.createContact({
        contactType: newType,
        name: newName.trim(),
        companyName: newCompany.trim() || undefined,
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
      })
      setNewName('')
      setNewCompany('')
      setNewEmail('')
      setNewPhone('')
      setShowCreate(false)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return
    try {
      await api.deleteContact(id)
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  const handleToggleActive = async (contact: Contact) => {
    try {
      if (contact.is_active) {
        await api.deactivateContact(contact.id)
      } else {
        await api.reactivateContact(contact.id)
      }
      reload()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Contacts</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4a90d9',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {showCreate ? 'Cancel' : '+ New Contact'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 8, backgroundColor: '#fee', color: '#c00', marginBottom: 12, borderRadius: 4 }}>
          {error}
          <button onClick={() => setError(null)} style={{ marginLeft: 8, cursor: 'pointer' }}>
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <div style={{ padding: 16, backgroundColor: '#f0f4f8', borderRadius: 8, marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>New Contact</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              >
                <option value="CUSTOMER">Customer</option>
                <option value="VENDOR">Vendor</option>
                <option value="EMPLOYEE">Employee</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Name *</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Contact name"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Company</label>
              <input
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                placeholder="Company name"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Email</label>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="email@example.com"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600 }}>Phone</label>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="555-1234"
                style={{ width: '100%', padding: 6, marginTop: 4 }}
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim()}
            style={{
              marginTop: 12,
              padding: '8px 16px',
              backgroundColor: newName.trim() ? '#4a90d9' : '#ccc',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: newName.trim() ? 'pointer' : 'default',
            }}
          >
            Create Contact
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        {contactTypes.map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            style={{
              padding: '4px 12px',
              border: '1px solid #ccc',
              borderRadius: 16,
              backgroundColor: filterType === t ? '#4a90d9' : '#fff',
              color: filterType === t ? '#fff' : '#333',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase() + 's'}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email..."
          style={{ flex: 1, padding: '6px 12px', border: '1px solid #ccc', borderRadius: 4 }}
        />
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>Loading...</div>
      ) : contacts.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#888' }}>No contacts found</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f0f0f0', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Name</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Type</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Company</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Email</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Phone</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Status</th>
              <th style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr
                key={c.id}
                style={{
                  borderBottom: '1px solid #eee',
                  opacity: c.is_active ? 1 : 0.5,
                  cursor: 'pointer',
                }}
                onClick={() => onSelectContact(c.id)}
              >
                <td style={{ padding: '8px 12px', fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 4,
                      backgroundColor:
                        c.type === 'CUSTOMER' ? '#e8f5e9' :
                        c.type === 'VENDOR' ? '#e3f2fd' :
                        c.type === 'EMPLOYEE' ? '#fff3e0' : '#f5f5f5',
                    }}
                  >
                    {c.type}
                  </span>
                </td>
                <td style={{ padding: '8px 12px' }}>{c.company_name || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{c.email || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{c.phone || '-'}</td>
                <td style={{ padding: '8px 12px' }}>{c.is_active ? 'Active' : 'Inactive'}</td>
                <td style={{ padding: '8px 12px' }} onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => handleToggleActive(c)}
                    style={{ marginRight: 4, fontSize: 11, cursor: 'pointer' }}
                  >
                    {c.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    style={{ fontSize: 11, cursor: 'pointer', color: '#c00' }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
