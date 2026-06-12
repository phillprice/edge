import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Pencil, X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn } from '../utils/cricket'

function InningsRoles({
  fixtureId,
  battingOrder,
  battingRolesData,
  fieldingOrder,
  fieldingRolesData,
  fieldingOvers,
  alsoFielded,
  onRefresh,
}) {
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [editingCaptain, setEditingCaptain] = useState(false)
  const [addWkPlayer, setAddWkPlayer] = useState('')
  const [addWkFrom, setAddWkFrom] = useState('')
  const [addWkTo, setAddWkTo] = useState('')
  const [wkError, setWkError] = useState('')
  const [showWkForm, setShowWkForm] = useState(false)
  const apiFetch = useApiFetch()

  if (!battingRolesData) return null

  // Captain from the WHCC batting innings; WK from the WHCC fielding innings
  const { captain_player_id, players } = battingRolesData
  const wk_stints = fieldingRolesData?.wk_stints ?? []
  const wk_errors = fieldingRolesData?.wk_errors ?? []

  async function setCaptain(player_id) {
    if (!player_id) return
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/captain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innings_order: battingOrder, player_id: Number(player_id) }),
    })
    onRefresh()
    setSaving(false)
  }

  async function addWk() {
    if (!addWkPlayer || !addWkFrom || fieldingOrder == null) return
    setWkError('')
    setSaving(true)
    const body = {
      innings_order: fieldingOrder,
      player_id: Number(addWkPlayer),
      from_over: Number(addWkFrom) + 1,
    }
    if (addWkTo) body.to_over = Number(addWkTo)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.ok) {
      setAddWkPlayer('')
      setAddWkFrom('')
      setAddWkTo('')
      setShowWkForm(false)
      onRefresh()
    } else {
      const { error } = await r.json()
      setWkError(error || 'Failed to save')
    }
    setSaving(false)
  }

  async function deleteWk(wkId) {
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/wk/${wkId}`, { method: 'DELETE' })
    onRefresh()
    setSaving(false)
  }

  async function deleteError(errorId) {
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/wk-error/${errorId}`, { method: 'DELETE' })
    onRefresh()
    setSaving(false)
  }

  const playerName = (pid) => dn(players.find((p) => p.player_id === pid)?.name ?? `#${pid}`)

  async function setFirstWk() {
    if (!addWkPlayer || fieldingOrder == null) return
    setWkError('')
    setSaving(true)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        innings_order: fieldingOrder,
        player_id: Number(addWkPlayer),
        from_over: 1,
      }),
    })
    if (r.ok) {
      setAddWkPlayer('')
      setShowWkForm(false)
      onRefresh()
    } else {
      const d = await r.json()
      setWkError(d.error || 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="innings-roles">
      <div className="role-col">
        <div className="role-col-label">
          <img
            src="/shield.png"
            height="14"
            className="icon-png"
            style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }}
          />
          Captain
        </div>
        {editingCaptain ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <select
              className="role-select"
              autoFocus
              value={captain_player_id ?? ''}
              onChange={(e) => {
                setCaptain(e.target.value)
                setEditingCaptain(false)
              }}
              disabled={saving}
            >
              <option value="">— unset —</option>
              {players.map((p) => (
                <option key={p.player_id} value={p.player_id}>
                  {dn(p.name)}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => setEditingCaptain(false)} title="Cancel">
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="wk-stint">
            <span className="wk-stint-name">
              {captain_player_id ? (
                <span
                  className="player-link"
                  onClick={() => navigate(`/player/${captain_player_id}`)}
                >
                  {dn(players.find((p) => p.player_id === captain_player_id)?.name ?? '')}
                </span>
              ) : (
                <span className="dim" style={{ fontWeight: 400 }}>
                  unset
                </span>
              )}
            </span>
            <button
              className="icon-btn"
              onClick={() => setEditingCaptain(true)}
              title="Edit captain"
              disabled={saving}
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="role-col">
        <div className="role-col-label">
          <img
            src="/gloves.png"
            className="icon-png"
            height="14"
            style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }}
          />
          Wicket keeper
        </div>
        {showWkForm ? (
          <>
            <div className="wk-add-row">
              {wk_stints.length > 0 && (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.82rem',
                    color: 'var(--text2)',
                  }}
                >
                  from ov
                  <input
                    type="number"
                    min="0"
                    className="role-input-over"
                    value={addWkFrom}
                    onChange={(e) => {
                      setAddWkFrom(e.target.value)
                      setWkError('')
                    }}
                    disabled={saving}
                  />
                  {fieldingOvers && (
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: '0.75rem', padding: '1px 6px' }}
                      onClick={() => setAddWkFrom(String(Math.ceil(Math.floor(fieldingOvers) / 2)))}
                    >
                      half
                    </button>
                  )}
                </label>
              )}
              <select
                className="role-select"
                value={addWkPlayer}
                onChange={(e) => setAddWkPlayer(e.target.value)}
                disabled={saving}
              >
                <option value="">
                  {wk_stints.length === 0 ? '— set keeper —' : '— new keeper —'}
                </option>
                {players.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {dn(p.name)}
                  </option>
                ))}
              </select>
              <button
                className="secondary"
                style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                onClick={wk_stints.length === 0 ? setFirstWk : addWk}
                disabled={saving || !addWkPlayer || (wk_stints.length > 0 && addWkFrom === '')}
              >
                {wk_stints.length === 0 ? 'Set' : 'Add'}
              </button>
              <button
                className="secondary"
                style={{ fontSize: '0.82rem', padding: '4px 8px' }}
                onClick={() => {
                  setShowWkForm(false)
                  setAddWkPlayer('')
                  setAddWkFrom('')
                  setWkError('')
                }}
              >
                Cancel
              </button>
            </div>
            {wkError && (
              <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: 4 }}>{wkError}</div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            {wk_stints.map((stint) => {
              const overRange = stint.to_over
                ? `ov ${stint.from_over - 1}–${stint.to_over - 1}`
                : stint.from_over > 1
                  ? `ov ${stint.from_over - 1}+`
                  : null
              return (
                <div key={stint.id} className="wk-stint">
                  <span
                    className="wk-stint-name player-link"
                    onClick={() => navigate(`/player/${stint.player_id}`)}
                  >
                    {playerName(stint.player_id)}
                  </span>
                  {overRange && <span className="dim wk-stint-meta">{overRange}</span>}
                  {stint.byes > 0 && <span className="dim wk-stint-meta">{stint.byes}b</span>}
                  <button
                    className="icon-btn danger"
                    onClick={() => deleteWk(stint.id)}
                    disabled={saving}
                    title="Remove"
                  >
                    <X size={12} />
                  </button>
                  {wk_errors
                    .filter((e) => e.player_id === stint.player_id)
                    .map((err) => (
                      <span key={err.id} className="error-tag">
                        {err.error_type === 'dropped_catch' ? 'dropped' : 'missed stumping'}
                        <button
                          className="icon-btn"
                          onClick={() => deleteError(err.id)}
                          disabled={saving}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                </div>
              )
            })}
            <button
              className="icon-btn"
              onClick={() => {
                setAddWkPlayer('')
                setAddWkFrom('')
                setShowWkForm(true)
              }}
              title={wk_stints.length === 0 ? 'Set keeper' : 'Record change'}
              disabled={saving}
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </div>
      {alsoFielded?.length > 0 && (
        <div className="role-col" style={{ minWidth: 0 }}>
          <div className="role-col-label">Also fielded</div>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {alsoFielded.map((p) => (
              <span key={p.player_id} className="wk-stint">
                <span
                  className="wk-stint-name player-link"
                  onClick={() => navigate(`/player/${p.player_id}`)}
                >
                  {dn(p.name)}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default InningsRoles
