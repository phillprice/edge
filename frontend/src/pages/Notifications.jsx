import { useState, useEffect, useCallback } from 'react'
import { useApiFetch } from '../hooks/useApiFetch'

function PlayerFollowsSection({ follows, onRemoveFollow }) {
  const apiFetch = useApiFetch()
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerResults, setPlayerResults] = useState([])

  async function searchPlayers(q) {
    setPlayerSearch(q)
    if (q.length < 2) { setPlayerResults([]); return }
    const res = await apiFetch(`/api/players?search=${encodeURIComponent(q)}&limit=8`)
    const data = await res.json()
    setPlayerResults((data.players ?? data).filter(p => !follows.some(f => f.player_id === p.player_id)))
  }

  async function addFollow(player) {
    setPlayerSearch('')
    setPlayerResults([])
    await apiFetch('/api/notifications/player-follows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: player.player_id })
    })
  }

  return (
    <>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input type="text" placeholder="Search players…" value={playerSearch} onChange={e => searchPlayers(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--fg)', fontSize: 14, boxSizing: 'border-box' }} />
        {playerResults.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,.15)' }}>
            {playerResults.map(p => (
              <button key={p.player_id} onClick={() => addFollow(p)}
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg)', fontSize: 14 }}>
                {p.display_name ?? p.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {follows.length === 0
        ? <p style={{ color: 'var(--muted)', fontSize: 14 }}>No players followed yet.</p>
        : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {follows.map(f => (
            <span key={f.player_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--chip-bg)', borderRadius: 20, padding: '4px 10px', fontSize: 13 }}>
              {f.player_name}
              <button onClick={() => onRemoveFollow(f.player_id)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      }
    </>
  )
}

function Toggle({ checked, onChange, label, description }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: 'var(--accent)', width: 16, height: 16, flexShrink: 0 }} />
      <span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {description && <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{description}</span>}
      </span>
    </label>
  )
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, borderBottom: '2px solid var(--accent)', paddingBottom: 6 }}>{title}</h2>
      {children}
    </section>
  )
}

function TeamSubsSection({ subs, onSetSubEnabled }) {
  const emailSubs = subs.filter(s => s.channel === 'email')
  if (emailSubs.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 0' }}>No team subscriptions yet. You&apos;ll be subscribed automatically when your access requests are approved.</p>
  }
  return emailSubs.map(s => (
    <Toggle key={`${s.team_id}:${s.season_id}`}
      label={s.label || `Team ${s.team_id}`}
      description={s.year ? `Season ${s.year}` : undefined}
      checked={s.enabled === 1 || s.enabled === true}
      onChange={v => onSetSubEnabled(s.team_id, s.season_id, 'email', v)} />
  ))
}

function TelegramSection({ telegram, prefs, setTelegram, onPref }) {
  const apiFetch = useApiFetch()
  const [chatIdInput, setChatIdInput] = useState('')

  async function saveTelegram() {
    if (!/^\d+$/.test(chatIdInput.trim())) return
    await apiFetch('/api/notifications/telegram', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatIdInput.trim() }) })
    setTelegram({ registered: true, chatIdHint: chatIdInput.trim().slice(-4) })
    setChatIdInput('')
  }

  async function removeTelegram() {
    await apiFetch('/api/notifications/telegram', { method: 'DELETE' })
    setTelegram({ registered: false })
  }
  if (telegram?.registered) return (
    <>
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Connected (chat ID ending …{telegram.chatIdHint}).{' '}
        <button onClick={removeTelegram} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 14, padding: 0 }}>Disconnect</button>
      </p>
      <Toggle label="New match results (Telegram)" checked={prefs.new_match?.telegram ?? false} onChange={v => onPref('new_match', 'telegram', v)} />
      <Toggle label="Player milestones (Telegram)" checked={prefs.milestone?.telegram ?? false} onChange={v => onPref('milestone', 'telegram', v)} />
    </>
  )
  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>
        Get match results and milestones via Telegram.
        To set up: open Telegram, find <strong>@WHCC_EDGE_Bot</strong> and send <code>/start</code> &mdash; it will reply with your chat ID.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input type="text" placeholder="Paste your chat ID here" value={chatIdInput} onChange={e => setChatIdInput(e.target.value)}
          style={{ flex: 1, padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--fg)', fontSize: 14 }} />
        <button onClick={saveTelegram} disabled={!/^\d+$/.test(chatIdInput.trim())}
          style={{ padding: '8px 16px', background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>Connect</button>
      </div>
    </>
  )
}

function useNotifications() {
  const apiFetch = useApiFetch()
  const [prefs,   setPrefs]   = useState(null)
  const [subs,    setSubs]    = useState([])
  const [follows, setFollows] = useState([])
  const [telegram, setTelegram] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const [p, s, f, t] = await Promise.all([
        apiFetch('/api/notifications/prefs').then(r => r.json()),
        apiFetch('/api/notifications/subscriptions').then(r => r.json()),
        apiFetch('/api/notifications/player-follows').then(r => r.json()),
        apiFetch('/api/notifications/telegram').then(r => r.json()),
      ])
      setPrefs(p.prefs ?? p); setSubs(s); setFollows(f); setTelegram(t)
    } catch { setError('Failed to load notification preferences.') }
  }, [apiFetch])

  useEffect(() => { load() }, [load])

  const setPref = useCallback(async (notifType, channel, enabled) => {
    setPrefs(p => ({ ...p, [notifType]: { ...(p?.[notifType] ?? {}), [channel]: enabled } }))
    await apiFetch('/api/notifications/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notif_type: notifType, channel, enabled }) })
  }, [apiFetch])

  const setSubEnabled = useCallback(async (teamId, seasonId, channel, enabled) => {
    setSubs(s => s.map(r => r.team_id === teamId && r.season_id === seasonId && r.channel === channel ? { ...r, enabled } : r))
    await apiFetch(`/api/notifications/subscriptions/${teamId}/${seasonId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, enabled }) })
  }, [apiFetch])

  const removeFollow = useCallback(async (playerId) => {
    setFollows(f => f.filter(r => r.player_id !== playerId))
    await apiFetch(`/api/notifications/player-follows/${playerId}`, { method: 'DELETE' })
  }, [apiFetch])

  return { prefs, subs, follows, telegram, setTelegram, error, setPref, setSubEnabled, removeFollow }
}

export default function Notifications() {
  const { prefs, subs, follows, telegram, setTelegram, error, setPref, setSubEnabled, removeFollow } = useNotifications()
  if (error) return <div className="page"><p style={{ color: 'var(--red)' }}>{error}</p></div>
  if (!prefs) return <div className="page"><p>Loading…</p></div>
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 24 }}>Notification preferences</h1>
      <Section title="Email notifications">
        <Toggle label="Access request outcome" description="Email when your access request is approved or denied" checked={prefs.access_outcome?.email ?? true} onChange={v => setPref('access_outcome', 'email', v)} />
        <Toggle label="New match results" description="Email when a match is ingested for a team you follow (see subscriptions below)" checked={prefs.new_match?.email ?? true} onChange={v => setPref('new_match', 'email', v)} />
        <Toggle label="Player milestones" description="Email when a player you follow hits a career or match milestone" checked={prefs.milestone?.email ?? false} onChange={v => setPref('milestone', 'email', v)} />
      </Section>
      <Section title="Team subscriptions"><TeamSubsSection subs={subs} onSetSubEnabled={setSubEnabled} /></Section>
      <Section title="Player follows (milestone alerts)"><PlayerFollowsSection follows={follows} onRemoveFollow={removeFollow} /></Section>
      <Section title="Telegram"><TelegramSection telegram={telegram} prefs={prefs} setTelegram={setTelegram} onPref={setPref} /></Section>
    </div>
  )
}
