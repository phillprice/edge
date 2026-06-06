import { useState, useEffect } from 'react'
import { Bell, Archive, Check } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

export default function Notifications() {
  const apiFetch = useApiFetch()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    apiFetch('/api/notifications')
      .then(r => r.ok ? r.json() : { notifications: [] })
      .then(d => setNotifications(Array.isArray(d) ? d : d.notifications || []))
      .catch(() => setNotifications([]))
      .finally(() => setLoading(false))
  }, [])

  async function markAsRead(id) {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' })
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, is_read: true } : n)
    )
  }

  async function archive(id) {
    await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' })
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  // Group notifications by date
  const groupedByDate = {}
  notifications.forEach(n => {
    const date = new Date(n.created_at).toLocaleDateString()
    if (!groupedByDate[date]) groupedByDate[date] = []
    groupedByDate[date].push(n)
  })

  const sortedDates = Object.keys(groupedByDate).sort((a, b) =>
    new Date(b) - new Date(a)
  )

  const unreadCount = notifications.filter(n => !n.is_read).length

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'access_request': return '🔐'
      case 'match_update': return '🏏'
      case 'stats_update': return '📊'
      default: return '🔔'
    }
  }

  return (
    <div className="page" style={{ maxWidth: '700px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Notifications</h1>
        {unreadCount > 0 && (
          <span style={{
            background: 'var(--hotpink)',
            color: '#fff',
            borderRadius: '50%',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 700,
          }}>
            {unreadCount}
          </span>
        )}
      </div>

      {loading ? (
        <div className="loading">Loading notifications…</div>
      ) : notifications.length === 0 ? (
        <div className="card">
          <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', padding: '2rem' }}>
            <Bell size={32} style={{ color: 'var(--text3)', marginBottom: '0.5rem' }} />
            <div>You're all caught up!</div>
            <div style={{ fontSize: '0.85rem' }}>No new notifications</div>
          </div>
        </div>
      ) : (
        <>
          {sortedDates.map(date => (
            <div key={date}>
              <h3 style={{ marginTop: '1.5rem', marginBottom: '0.75rem', color: 'var(--text3)' }}>
                {date === new Date().toLocaleDateString() ? 'Today' : date}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {groupedByDate[date].map(notif => (
                  <div
                    key={notif.id}
                    style={{
                      display: 'flex',
                      gap: '10px',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: notif.is_read ? 'var(--bg2)' : 'var(--bg3)',
                      border: `1px solid ${notif.is_read ? 'var(--border)' : 'var(--border2)'}`,
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ fontSize: '1.2rem', marginTop: '2px', flexShrink: 0 }}>
                      {getNotificationIcon(notif.type)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: notif.is_read ? 400 : 600, fontSize: '0.9rem', marginBottom: '2px' }}>
                        {notif.title}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '4px' }}>
                        {notif.message}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
                        {new Date(notif.created_at).toLocaleTimeString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {!notif.is_read && (
                        <button
                          className="secondary"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                          onClick={() => markAsRead(notif.id)}
                          title="Mark as read"
                        >
                          <Check size={12} />
                        </button>
                      )}
                      <button
                        className="secondary"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text3)' }}
                        onClick={() => archive(notif.id)}
                        title="Archive"
                      >
                        <Archive size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
