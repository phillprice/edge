import { useState, useEffect, useCallback } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'
import TeamDropdown from '../../components/TeamDropdown'
import { useGroupFilter } from '../../hooks/useGroupFilter'

// ── Players tab ───────────────────────────────────────────────────────────────

export default function PlayersTab() {
  const {
    myGroups,
    favourites,
    toggleFavourite,
    selectedGroups,
    pillValue,
    setGroups,
    isExplicit
  } = useGroupFilter()
  const apiFetch = useApiFetch()

  const [players, setPlayers] = useState([])
  const [edits, setEdits] = useState({}) // { playerId: jerseyNumber }
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  const loadPlayers = useCallback(() => {
    if (selectedGroups.length === 0) {
      setPlayers([])
      setEdits({})
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    params.set('groups', selectedGroups.map((g) => `${g.team_id}:${g.season_id}`).join(','))
    apiFetch(`/api/admin/players?${params}`)
      .then((r) => r.json())
      .then((rows) => {
        setPlayers(rows)
        setEdits({})
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apiFetch, selectedGroups])

  useEffect(() => {
    loadPlayers()
  }, [loadPlayers])

  function handleNumberChange(playerId, val) {
    setEdits((prev) => ({ ...prev, [playerId]: val }))
  }

  async function saveJerseys() {
    setSaving(true)
    setMsg(null)
    const updates = players
      .filter((p) => edits[p.playerId] !== undefined)
      .map((p) => ({ playerId: p.playerId, jerseyNumber: edits[p.playerId] }))
    try {
      await apiFetch('/api/admin/players/jerseys', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      setMsg({
        ok: true,
        text: `Saved ${updates.length} jersey number${updates.length !== 1 ? 's' : ''}`
      })
      loadPlayers()
    } catch {
      setMsg({ ok: false, text: 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  const hasEdits = Object.keys(edits).length > 0

  return (
    <div>
      {myGroups.length > 1 && (
        <div style={{ marginBottom: '1rem' }}>
          <TeamDropdown
            myGroups={myGroups}
            value={pillValue}
            onChange={setGroups}
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            isExplicit={isExplicit}
          />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem'
        }}
      >
        <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>
          {loading ? 'Loading…' : `${players.length} player${players.length !== 1 ? 's' : ''}`}
        </span>
        {hasEdits && (
          <button className="btn-primary" onClick={saveJerseys} disabled={saving}>
            {saving
              ? 'Saving…'
              : `Save ${Object.keys(edits).length} change${Object.keys(edits).length !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {msg && (
        <div
          className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}
          style={{ marginBottom: '0.75rem' }}
        >
          {msg.text}
        </div>
      )}

      {!loading && players.length > 0 && (
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th
                style={{
                  textAlign: 'left',
                  padding: '6px 8px',
                  color: 'var(--text2)',
                  fontWeight: 500
                }}
              >
                Player
              </th>
              <th
                style={{
                  textAlign: 'center',
                  padding: '6px 8px',
                  color: 'var(--text2)',
                  fontWeight: 500,
                  width: 100
                }}
              >
                Jersey #
              </th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const current =
                edits[p.playerId] !== undefined ? edits[p.playerId] : (p.jerseyNumber ?? '')
              const changed = edits[p.playerId] !== undefined
              return (
                <tr key={p.playerId} style={{ borderTop: '1px solid var(--border2)' }}>
                  <td style={{ padding: '6px 8px' }}>{p.name}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      value={current}
                      placeholder="–"
                      onChange={(e) => handleNumberChange(p.playerId, e.target.value)}
                      style={{
                        width: 64,
                        textAlign: 'center',
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: changed ? '1px solid var(--accent)' : '1px solid var(--border2)',
                        background: changed ? 'var(--bg3)' : 'var(--bg2)',
                        color: 'var(--text)',
                        fontSize: '0.85rem'
                      }}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {!loading && selectedGroups && selectedGroups.length === 0 && (
        <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>No team selected.</p>
      )}
    </div>
  )
}
