import { useState } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'

// ── Shared primitives ─────────────────────────────────────────────────────────

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        cursor: 'pointer',
        padding: '12px 0',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3, accentColor: 'var(--accent)', width: 16, height: 16, flexShrink: 0 }}
      />
      <span>
        <span style={{ fontWeight: 500 }}>{label}</span>
        {description && (
          <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {description}
          </span>
        )}
      </span>
    </label>
  )
}

export function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 4,
          borderBottom: '2px solid var(--accent)',
          paddingBottom: 6
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

// ── Player follows ────────────────────────────────────────────────────────────

function PlayerDropdown({ results, onAdd }) {
  if (results.length === 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        zIndex: 10,
        boxShadow: '0 4px 12px rgba(0,0,0,.15)'
      }}
    >
      {results.map((p) => (
        <button
          key={p.player_id}
          onClick={() => onAdd(p)}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 12px',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--fg)',
            fontSize: 14
          }}
        >
          {p.display_name ?? p.name}
        </button>
      ))}
    </div>
  )
}

function FollowedChips({ follows, onRemove }) {
  if (follows.length === 0) {
    return <p style={{ color: 'var(--muted)', fontSize: 14 }}>No players followed yet.</p>
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {follows.map((f) => (
        <span
          key={f.player_id}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'var(--chip-bg)',
            borderRadius: 20,
            padding: '4px 10px',
            fontSize: 13
          }}
        >
          {f.player_name}
          <button
            onClick={() => onRemove(f.player_id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted)',
              fontSize: 16,
              lineHeight: 1,
              padding: 0
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

function notAlreadyFollowed(follows) {
  return (p) => !follows.some((f) => f.player_id === p.player_id)
}

export function PlayerFollowsSection({ follows, onRemoveFollow }) {
  const apiFetch = useApiFetch()
  const [playerSearch, setPlayerSearch] = useState('')
  const [playerResults, setPlayerResults] = useState([])

  async function searchPlayers(q) {
    setPlayerSearch(q)
    if (q.length < 2) return setPlayerResults([])
    const data = await apiFetch(`/api/players?search=${encodeURIComponent(q)}&limit=8`).then((r) =>
      r.json()
    )
    setPlayerResults((data.players ?? data).filter(notAlreadyFollowed(follows)))
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
        <input
          type="text"
          placeholder="Search players…"
          value={playerSearch}
          onChange={(e) => searchPlayers(e.target.value)}
          style={{
            width: '100%',
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--input-bg)',
            color: 'var(--fg)',
            fontSize: 14,
            boxSizing: 'border-box'
          }}
        />
        <PlayerDropdown results={playerResults} onAdd={addFollow} />
      </div>
      <FollowedChips follows={follows} onRemove={onRemoveFollow} />
    </>
  )
}

// ── Team subscriptions ────────────────────────────────────────────────────────

function isEnabled(sub) {
  return sub ? sub.enabled === 1 || sub.enabled === true : false
}

function isEmailChannel(s) {
  return s.channel === 'email'
}

function matchesTeamSeason(g) {
  return (s) => s.team_id === g.team_id && s.season_id === g.season_id
}

function GroupToggle({ g, sub, onSetSubEnabled }) {
  return (
    <Toggle
      label={g.label || `Team ${g.team_id}`}
      description={g.year ? `Season ${g.year}` : undefined}
      checked={isEnabled(sub)}
      onChange={(v) => onSetSubEnabled(g.team_id, g.season_id, 'email', v, g.label, g.year)}
    />
  )
}

function SubToggle({ s, onSetSubEnabled }) {
  return (
    <Toggle
      label={s.label || `Team ${s.team_id}`}
      description={s.year ? `Season ${s.year}` : undefined}
      checked={isEnabled(s)}
      onChange={(v) => onSetSubEnabled(s.team_id, s.season_id, 'email', v)}
    />
  )
}

export function TeamSubsSection({ subs, onSetSubEnabled, availableGroups }) {
  const emailSubs = subs.filter(isEmailChannel)

  if (availableGroups.length > 0 && availableGroups.length < 6) {
    return availableGroups.map((g) => {
      const sub = emailSubs.find(matchesTeamSeason(g))
      return (
        <GroupToggle
          key={`${g.team_id}:${g.season_id}`}
          g={g}
          sub={sub}
          onSetSubEnabled={onSetSubEnabled}
        />
      )
    })
  }

  if (emailSubs.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', fontSize: 14, padding: '12px 0' }}>
        No team subscriptions yet. Star a team on the match list to subscribe to its match results.
      </p>
    )
  }
  return emailSubs.map((s) => (
    <SubToggle key={`${s.team_id}:${s.season_id}`} s={s} onSetSubEnabled={onSetSubEnabled} />
  ))
}

// ── Telegram ──────────────────────────────────────────────────────────────────

function TelegramConnected({ telegram, prefs, onPref, onRemove }) {
  return (
    <>
      <p style={{ fontSize: 14, marginBottom: 12 }}>
        Connected (chat ID ending …{telegram.chatIdHint}).{' '}
        <button
          onClick={onRemove}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent)',
            fontSize: 14,
            padding: 0
          }}
        >
          Disconnect
        </button>
      </p>
      <Toggle
        label="New match results (Telegram)"
        checked={!!prefs.new_match?.telegram}
        onChange={(v) => onPref('new_match', 'telegram', v)}
      />
      <Toggle
        label="Player milestones (Telegram)"
        checked={!!prefs.milestone?.telegram}
        onChange={(v) => onPref('milestone', 'telegram', v)}
      />
    </>
  )
}

function TelegramSetup({ chatIdInput, setChatIdInput, onSave }) {
  const isValidId = /^\d+$/.test(chatIdInput.trim())
  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>
        Get match results and milestones via Telegram. To set up: open Telegram, find{' '}
        <strong>@WHCC_EDGE_Bot</strong> and send <code>/start</code> &mdash; it will reply with your
        chat ID.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="Paste your chat ID here"
          value={chatIdInput}
          onChange={(e) => setChatIdInput(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--input-bg)',
            color: 'var(--fg)',
            fontSize: 14
          }}
        />
        <button
          onClick={onSave}
          disabled={!isValidId}
          style={{
            padding: '8px 16px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14
          }}
        >
          Connect
        </button>
      </div>
    </>
  )
}

export function TelegramSection({ telegram, prefs, setTelegram, onPref }) {
  const apiFetch = useApiFetch()
  const [chatIdInput, setChatIdInput] = useState('')

  async function saveTelegram() {
    if (!/^\d+$/.test(chatIdInput.trim())) return
    await apiFetch('/api/notifications/telegram', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatIdInput.trim() })
    })
    setTelegram({ registered: true, chatIdHint: chatIdInput.trim().slice(-4) })
    setChatIdInput('')
  }

  async function removeTelegram() {
    await apiFetch('/api/notifications/telegram', { method: 'DELETE' })
    setTelegram({ registered: false })
  }

  if (telegram?.registered) {
    return (
      <TelegramConnected
        telegram={telegram}
        prefs={prefs}
        onPref={onPref}
        onRemove={removeTelegram}
      />
    )
  }
  return (
    <TelegramSetup
      chatIdInput={chatIdInput}
      setChatIdInput={setChatIdInput}
      onSave={saveTelegram}
    />
  )
}

// ── Calendar ──────────────────────────────────────────────────────────────────

const URL_ROW = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 0',
  borderBottom: '1px solid var(--border)'
}
const URL_INPUT = {
  flex: 1,
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--input-bg)',
  color: 'var(--muted)',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}
const CAL_BTN = {
  padding: '6px 12px',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  flexShrink: 0
}

function calUrl(base, token, groups) {
  const g = groups.map((x) => `${x.team_id}:${x.season_id}`).join(',')
  return `${base}/api/calendar/feed/${token}?groups=${encodeURIComponent(g)}`
}

function isFavourite(calFavourites) {
  return (g) => calFavourites.some((f) => f.team_id === g.team_id && f.season_id === g.season_id)
}

function CalendarUrlRow({ label, url, copiedKey, copyKey, onCopy }) {
  return (
    <div style={URL_ROW}>
      <span style={{ fontSize: 13, fontWeight: 500, minWidth: 120 }}>{label}</span>
      <input readOnly value={url} style={URL_INPUT} />
      <button style={CAL_BTN} onClick={() => onCopy(url, copyKey)}>
        {copiedKey === copyKey ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

function CalendarUrlList({ calActiveGroups, favActive, base, token, copied, onCopy }) {
  return (
    <>
      {favActive.length > 0 && (
        <CalendarUrlRow
          label="All favourites"
          url={calUrl(base, token, favActive)}
          copiedKey={copied}
          copyKey="all"
          onCopy={onCopy}
        />
      )}
      {calActiveGroups.map((g) => (
        <CalendarUrlRow
          key={`${g.team_id}:${g.season_id}`}
          label={g.label || `Team ${g.team_id}`}
          url={calUrl(base, token, [g])}
          copiedKey={copied}
          copyKey={`${g.team_id}:${g.season_id}`}
          onCopy={onCopy}
        />
      ))}
    </>
  )
}

function copyToClipboard(url, key, setCopied) {
  navigator.clipboard.writeText(url).then(() => {
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  })
}

export function CalendarSection({
  calToken,
  calActiveGroups,
  calFavourites,
  generateCal,
  revokeCal
}) {
  const [copied, setCopied] = useState(null)

  if (calToken === null || calActiveGroups.length === 0) return null

  if (!calToken) {
    return (
      <>
        <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>
          Subscribe to upcoming fixtures in Google Calendar, Apple Calendar, or Outlook. Anyone with
          the link can see your upcoming fixtures.
        </p>
        <button onClick={generateCal} style={CAL_BTN}>
          Generate calendar link
        </button>
      </>
    )
  }

  const base = window.location.origin
  const favActive = calActiveGroups.filter(isFavourite(calFavourites))
  const onCopy = (url, key) => copyToClipboard(url, key, setCopied)

  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 12 }}>
        Add to any calendar app as a subscription URL. Anyone with the link can see your upcoming
        fixtures — regenerate to invalidate old links.
      </p>
      <CalendarUrlList
        calActiveGroups={calActiveGroups}
        favActive={favActive}
        base={base}
        token={calToken}
        copied={copied}
        onCopy={onCopy}
      />
      <div style={{ marginTop: 12 }}>
        <button
          onClick={revokeCal}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent)',
            fontSize: 13,
            padding: 0
          }}
        >
          Regenerate link (invalidates existing subscriptions)
        </button>
      </div>
    </>
  )
}
