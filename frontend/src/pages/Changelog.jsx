import { useState, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { formatDateShort } from '../utils/cricket'

export default function Changelog() {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/changelog', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setEntries)
      .catch(() => setError('Failed to load changelog.'))
  }, [])

  if (error)
    return (
      <div className="page">
        <p style={{ color: 'var(--red)' }}>{error}</p>
      </div>
    )
  if (!entries)
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    )

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: '2rem' }}>What&rsquo;s new</h1>
      {entries.length === 0 && <p style={{ color: 'var(--muted)' }}>No entries yet.</p>}
      {entries.map((e) => (
        <article
          key={e.id}
          style={{
            marginBottom: '3rem',
            paddingBottom: '3rem',
            borderBottom: '1px solid var(--border)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
              flexWrap: 'wrap',
              marginBottom: '0.35rem'
            }}
          >
            {e.version && (
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--hotpink)',
                  background: 'color-mix(in srgb, var(--hotpink) 12%, transparent)',
                  padding: '2px 8px',
                  borderRadius: 20,
                  letterSpacing: '0.04em'
                }}
              >
                {e.version}
              </span>
            )}
            <time style={{ fontSize: 13, color: 'var(--muted)' }} dateTime={e.published_at}>
              {formatDateShort(e.published_at)}
            </time>
          </div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            {e.title}
          </h2>
          <div
            className="changelog-body"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(e.html) }}
          />
        </article>
      ))}
    </div>
  )
}
