import { useState, useEffect } from 'react'
import { useApiFetch } from '../hooks/useApiFetch'

export default function RequestAccessPage() {
  const apiFetch = useApiFetch()
  const [teams, setTeams] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [submitted, setSubmitted] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch('/api/access-requests/teams')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        setTeams(Array.isArray(rows) ? rows : [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apiFetch])

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function submit() {
    if (!selected.size) return
    setSaving(true)
    setError(null)
    const toRequest = teams.filter((t) => selected.has(`${t.team_id}:${t.season_id}`))
    const results = await Promise.allSettled(
      toRequest.map((t) =>
        apiFetch('/api/access-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_id: t.team_id, season_id: t.season_id })
        })
      )
    )
    const succeeded = new Set()
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.ok) {
        succeeded.add(`${toRequest[i].team_id}:${toRequest[i].season_id}`)
      }
    })
    setSubmitted((prev) => new Set([...prev, ...succeeded]))
    setSelected(new Set())
    if (succeeded.size < toRequest.length) setError('Some requests could not be submitted.')
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="page">
        <p style={{ color: 'var(--text2)', textAlign: 'center', padding: '2rem' }}>
          Loading available teams…
        </p>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Request team access</h1>
      <p style={{ color: 'var(--text2)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
        Select the teams you play for and submit a request. An admin will approve your access.
      </p>

      {teams.length === 0 ? (
        <div className="card">
          <div className="empty">No teams are set up yet — check back later.</div>
        </div>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {teams.map((t) => {
            const key = `${t.team_id}:${t.season_id}`
            const done = submitted.has(key)
            return (
              <label
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  padding: '0.5rem 0.25rem',
                  cursor: done ? 'default' : 'pointer',
                  opacity: done ? 0.6 : 1,
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.9rem'
                }}
              >
                <input
                  type="checkbox"
                  checked={done || selected.has(key)}
                  disabled={done}
                  onChange={() => toggle(key)}
                />
                <span style={{ flex: 1 }}>{t.label}</span>
                {t.year && (
                  <span style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>{t.year}</span>
                )}
                {done && (
                  <span style={{ color: 'var(--green)', fontSize: '0.75rem', fontWeight: 600 }}>
                    Requested
                  </span>
                )}
              </label>
            )
          })}
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--red)', fontSize: '0.85rem', marginTop: '0.75rem' }}>{error}</p>
      )}

      {teams.length > 0 && (
        <button
          onClick={submit}
          disabled={!selected.size || saving}
          style={{ marginTop: '1rem' }}
        >
          {saving ? 'Submitting…' : `Request access (${selected.size} selected)`}
        </button>
      )}
    </div>
  )
}
