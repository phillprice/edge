import { useState, useEffect, useCallback } from 'react'
import { Mail, Send, Calendar as CalendarIcon } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { useGroups } from '../GroupContext'
import { useFavouriteGroups } from '../hooks/useFavouriteGroups'
import {
  Section,
  Toggle,
  PlayerFollowsSection,
  TeamSubsSection,
  TelegramSection,
  CalendarSection
} from './notifications/Sections'

// ── Data loading ──────────────────────────────────────────────────────────────

function toJson(r) {
  return r.json()
}

async function fetchAll(apiFetch) {
  return Promise.all([
    apiFetch('/api/notifications/prefs').then(toJson),
    apiFetch('/api/notifications/subscriptions').then(toJson),
    apiFetch('/api/notifications/player-follows').then(toJson),
    apiFetch('/api/notifications/telegram').then(toJson),
    apiFetch('/api/calendar/token').then(toJson)
  ])
}

function applyCalData(data, setCalToken, setCalActiveGroups) {
  setCalToken(data.token ?? '')
  setCalActiveGroups(data.activeGroups ?? [])
}

function matchSub(teamId, seasonId, channel) {
  return (r) => r.team_id === teamId && r.season_id === seasonId && r.channel === channel
}

// ── Hook ──────────────────────────────────────────────────────────────────────

function useNotifications() {
  const apiFetch = useApiFetch()
  const [prefs, setPrefs] = useState(null)
  const [subs, setSubs] = useState([])
  const [follows, setFollows] = useState([])
  const [telegram, setTelegram] = useState(null)
  const [calToken, setCalToken] = useState(null)
  const [calActiveGroups, setCalActiveGroups] = useState([])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const [p, s, f, t, cal] = await fetchAll(apiFetch)
      setPrefs(p.prefs ?? p)
      setSubs(s)
      setFollows(f)
      setTelegram(t)
      applyCalData(cal, setCalToken, setCalActiveGroups)
    } catch {
      setError('Failed to load notification preferences.')
    }
  }, [apiFetch])

  useEffect(() => {
    load()
  }, [load])

  const setPref = useCallback(
    async (type, channel, enabled) => {
      setPrefs((p) => ({
        ...(p || {}),
        [type]: { ...((p || {})[type] || {}), [channel]: enabled }
      }))
      await apiFetch('/api/notifications/prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notif_type: type, channel, enabled })
      })
    },
    [apiFetch]
  )

  const setSubEnabled = useCallback(
    async (teamId, seasonId, channel, enabled, label, year) => {
      const match = matchSub(teamId, seasonId, channel)
      setSubs((s) =>
        s.some(match)
          ? s.map((r) => (match(r) ? { ...r, enabled } : r))
          : [...s, { team_id: teamId, season_id: seasonId, channel, enabled, label, year }]
      )
      await apiFetch(`/api/notifications/subscriptions/${teamId}/${seasonId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, enabled })
      })
    },
    [apiFetch]
  )

  const removeFollow = useCallback(
    async (playerId) => {
      setFollows((f) => f.filter((r) => r.player_id !== playerId))
      await apiFetch(`/api/notifications/player-follows/${playerId}`, { method: 'DELETE' })
    },
    [apiFetch]
  )

  const generateCal = useCallback(async () => {
    const cal = await apiFetch('/api/calendar/token', { method: 'POST' }).then(toJson)
    applyCalData(cal, setCalToken, setCalActiveGroups)
  }, [apiFetch])

  const revokeCal = useCallback(async () => {
    await apiFetch('/api/calendar/token', { method: 'DELETE' })
    const cal = await apiFetch('/api/calendar/token', { method: 'POST' }).then(toJson)
    applyCalData(cal, setCalToken, setCalActiveGroups)
  }, [apiFetch])

  return {
    prefs,
    subs,
    follows,
    telegram,
    setTelegram,
    calToken,
    calActiveGroups,
    generateCal,
    revokeCal,
    error,
    setPref,
    setSubEnabled,
    removeFollow
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'Email', label: 'Email', icon: Mail },
  { id: 'Telegram', label: 'Telegram', icon: Send },
  { id: 'Calendar', label: 'Calendar', icon: CalendarIcon }
]

function Tabs({ active, onChange }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 0,
        borderBottom: '2px solid var(--border)',
        marginBottom: '1.5rem',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className="secondary"
          style={{
            borderRadius: 0,
            border: 'none',
            borderBottom: active === t.id ? '2px solid var(--hotpink)' : '2px solid transparent',
            marginBottom: -2,
            fontWeight: active === t.id ? 600 : 400,
            color: active === t.id ? 'var(--hotpink)' : 'var(--text2)',
            padding: '0.5rem 1.1rem',
            background: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          <t.icon size={16} />
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ── Email tab content ─────────────────────────────────────────────────────────

function EmailTab({ prefs, subs, follows, setPref, setSubEnabled, removeFollow, myGroups }) {
  return (
    <>
      <Section title="Email notifications">
        <Toggle
          label="Access request outcome"
          description="Email when your access request is approved or denied"
          checked={prefs.access_outcome ? prefs.access_outcome.email : true}
          onChange={(v) => setPref('access_outcome', 'email', v)}
        />
        <Toggle
          label="New match results"
          description="Email when a match is ingested for a team you follow (see subscriptions below)"
          checked={prefs.new_match ? prefs.new_match.email : true}
          onChange={(v) => setPref('new_match', 'email', v)}
        />
        <Toggle
          label="Player milestones"
          description="Email when a player you follow hits a career or match milestone"
          checked={prefs.milestone ? prefs.milestone.email : false}
          onChange={(v) => setPref('milestone', 'email', v)}
        />
      </Section>
      <Section title="Team subscriptions">
        <TeamSubsSection subs={subs} onSetSubEnabled={setSubEnabled} availableGroups={myGroups} />
      </Section>
      <Section title="Player follows (milestone alerts)">
        <PlayerFollowsSection follows={follows} onRemoveFollow={removeFollow} />
      </Section>
    </>
  )
}

// ── Tab content ───────────────────────────────────────────────────────────────

function TabContent({ activeTab, n, myGroups, favourites }) {
  if (activeTab === 'Email')
    return (
      <EmailTab
        prefs={n.prefs}
        subs={n.subs}
        follows={n.follows}
        setPref={n.setPref}
        setSubEnabled={n.setSubEnabled}
        removeFollow={n.removeFollow}
        myGroups={myGroups}
      />
    )
  if (activeTab === 'Telegram')
    return (
      <Section title="Telegram">
        <TelegramSection
          telegram={n.telegram}
          prefs={n.prefs}
          setTelegram={n.setTelegram}
          onPref={n.setPref}
        />
      </Section>
    )
  return (
    <Section title="Calendar">
      <CalendarSection
        calToken={n.calToken}
        calActiveGroups={n.calActiveGroups}
        calFavourites={favourites}
        generateCal={n.generateCal}
        revokeCal={n.revokeCal}
      />
    </Section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Notifications() {
  const { myGroups } = useGroups()
  const { favourites } = useFavouriteGroups(myGroups)
  const [activeTab, setActiveTab] = useState('Email')
  const n = useNotifications()

  if (n.error)
    return (
      <div className="page">
        <p style={{ color: 'var(--red)' }}>{n.error}</p>
      </div>
    )
  if (!n.prefs)
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    )

  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 24 }}>Notification preferences</h1>
      <Tabs active={activeTab} onChange={setActiveTab} />
      <TabContent activeTab={activeTab} n={n} myGroups={myGroups} favourites={favourites} />
    </div>
  )
}
