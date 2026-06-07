// Team/season filter — each group the user has access to is its own pill.
// Label = "Team Year" (e.g. "U11 Whirlwinds 2025"). No separate Season axis.
// Deselecting all pills = show everything (same as no filter).
//
// myGroups: [{ team_id, season_id, label, year }]
// value:    [{ team_id, season_id }]  (selected pairs)

export default function TeamSeasonFilter({ myGroups, value, onChange, hideLabel = false }) {
  if (!myGroups.length) return null

  // Sort: by label then year
  const sorted = [...myGroups].sort((a, b) => {
    const l = (a.label || '').localeCompare(b.label || '')
    return l !== 0 ? l : String(a.year || '').localeCompare(String(b.year || ''))
  })

  const selKeys = new Set(value.map(v => `${v.team_id}:${v.season_id}`))

  function toggle(g) {
    const key = `${g.team_id}:${g.season_id}`
    const next = selKeys.has(key)
      ? value.filter(v => !(v.team_id === g.team_id && v.season_id === g.season_id))
      : [...value, { team_id: g.team_id, season_id: g.season_id }]
    // Deselecting all = emit full list (show everything the user can see)
    onChange(next.length ? next : myGroups.map(g => ({ team_id: g.team_id, season_id: g.season_id })))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {!hideLabel && <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>Team</span>}
      {sorted.map(g => {
        const key = `${g.team_id}:${g.season_id}`
        const label = g.year ? `${g.label} ${g.year}` : g.label
        return (
          <button key={key}
            className={selKeys.has(key) ? 'pill active' : 'pill'}
            onClick={() => toggle(g)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}
