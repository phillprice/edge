import { useState, useEffect } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'

export default function RequestAccess() {
  const apiFetch  = useApiFetch()
  const { user }  = useUser()
  const currentGroups = user?.publicMetadata?.accessGroups ?? []

  const [teams,    setTeams]    = useState([])
  const [selected, setSelected] = useState(new Set())
  const [sending,  setSending]  = useState(false)
  const [sent,     setSent]     = useState(false)
  const [error,    setError]    = useState(null)

  useEffect(() => {
    apiFetch('/api/access-requests/teams').then(r => r.json()).then(ts => setTeams(Array.isArray(ts) ? ts : []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function alreadyHas(key) {
    const [tid, sid] = key.split(':')
    return currentGroups.some(g => g.team_id === Number(tid) && g.season_id === Number(sid))
  }

  function toggle(key) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  async function submit() {
    if (!selected.size) return
    setSending(true); setError(null)
    try {
      await Promise.all([...selected].map(key => {
        const [team_id, season_id] = key.split(':')
        return apiFetch('/api/access-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_id: Number(team_id), season_id: Number(season_id) }),
        })
      }))
      setSent(true)
    } catch (e) { setError(e.message) }
    setSending(false)
  }

  const requestableTeams = teams.filter(t => !alreadyHas(`${t.team_id}:${t.season_id}`))

  if (sent) {
    return (
      <div className="page" style={{ maxWidth: 520, textAlign: 'center', paddingTop: '4rem' }}>
        <CheckCircle2 size={48} style={{ color: 'var(--green)', marginBottom: '1rem' }} />
        <h1>Request sent</h1>
        <p style={{ color: 'var(--text2)' }}>
          Your request has been sent to the team admin. You&apos;ll be able to access the data once it&apos;s approved.
        </p>
      </div>
    )
  }

  return (
    <div className="page" style={{ maxWidth: 520 }}>
      <h1>Request access</h1>
      <p style={{ color: 'var(--text2)', marginBottom: '1.5rem' }}>
        Select the teams you&apos;d like access to. A team admin will review your request.
      </p>

      {teams.length === 0 && (
        <p style={{ color: 'var(--text3)' }}>No teams available yet — please contact your administrator.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: '1.5rem' }}>
        {currentGroups.length > 0 && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 4 }}>
            Already have access
          </div>
        )}
        {/* Already-approved teams — shown disabled */}
        {teams.filter(t => alreadyHas(`${t.team_id}:${t.season_id}`)).map(t => (
          <div key={`${t.team_id}:${t.season_id}`} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 8,
            background: 'var(--surface)', border: '1px solid var(--border)',
            opacity: 0.5,
          }}>
            <input type="checkbox" checked disabled />
            <span>{t.year ? `${t.label} ${t.year}` : t.label}</span>
          </div>
        ))}

        {requestableTeams.length > 0 && currentGroups.length > 0 && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 8, marginBottom: 4 }}>
            Request additional access
          </div>
        )}
        {/* Requestable teams */}
        {requestableTeams.map(t => {
          const key     = `${t.team_id}:${t.season_id}`
          const label   = t.year ? `${t.label} ${t.year}` : t.label
          const checked = selected.has(key)
          return (
            <label key={key} style={{
              display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
              padding: '10px 14px', borderRadius: 8,
              background: checked ? 'var(--surface-alt)' : 'var(--surface)',
              border: `1px solid ${checked ? 'var(--hotpink)' : 'var(--border)'}`,
            }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(key)} />
              <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
            </label>
          )
        })}
      </div>

      {error && <p style={{ color: 'var(--red)', marginBottom: '0.75rem' }}>{error}</p>}

      {requestableTeams.length > 0 ? (
        <button onClick={submit} disabled={sending || !selected.size} style={{ width: '100%' }}>
          {sending ? 'Sending…' : selected.size ? `Request access to ${selected.size} team${selected.size === 1 ? '' : 's'}` : 'Select teams above'}
        </button>
      ) : (
        <p style={{ color: 'var(--text3)', fontSize: '0.85rem', textAlign: 'center' }}>
          You already have access to all available teams.
        </p>
      )}
    </div>
  )
}
