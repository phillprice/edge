// Two-axis Team × Season filter. Both axes are multi-select; the selection is the
// cross-product (intersected with the teams/seasons the user actually has). This lets you
// view one team across seasons, several teams in one season ("U11 Hurricanes 2026 +
// U11 Whirlwinds 2026"), or any mix. Emits the resulting [{ team_id, season_id }] pairs.
//
// myGroups: [{ team_id, season_id, label, year }]
// value:    [{ team_id, season_id }]  (currently-selected pairs — always a cross-product)

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {children}
    </div>
  )
}

export default function TeamSeasonFilter({ myGroups, value, onChange }) {
  // Distinct teams and seasons available to this user.
  const teams = [...new Map(myGroups.map(g => [g.team_id, { team_id: g.team_id, label: g.label }])).values()]
    .sort((a, b) => (a.label || '').localeCompare(b.label || ''))
  const seasons = [...new Map(myGroups.map(g => [g.season_id, { season_id: g.season_id, year: g.year }])).values()]
    .sort((a, b) => String(b.year || '').localeCompare(String(a.year || '')))

  const selTeams   = new Set(value.map(v => v.team_id))
  const selSeasons = new Set(value.map(v => v.season_id))

  // Emit the cross-product of the chosen teams × seasons, intersected with what exists.
  // An empty axis means "all" on that axis (so deselecting everything = everything available).
  function emit(teamSet, seasonSet) {
    const ts = teamSet.size   ? teamSet   : new Set(teams.map(t => t.team_id))
    const ss = seasonSet.size ? seasonSet : new Set(seasons.map(s => s.season_id))
    onChange(
      myGroups
        .filter(g => ts.has(g.team_id) && ss.has(g.season_id))
        .map(g => ({ team_id: g.team_id, season_id: g.season_id }))
    )
  }
  const toggle = (set, id) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  if (!teams.length) return null

  return (
    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <Row label="Team">
        {teams.map(t => (
          <button key={t.team_id}
            className={selTeams.has(t.team_id) ? 'pill active' : 'pill'}
            onClick={() => emit(toggle(selTeams, t.team_id), selSeasons)}>
            {t.label}
          </button>
        ))}
      </Row>
      {seasons.length > 1 && (
        <Row label="Season">
          {seasons.map(s => (
            <button key={s.season_id}
              className={selSeasons.has(s.season_id) ? 'pill active' : 'pill'}
              onClick={() => emit(selTeams, toggle(selSeasons, s.season_id))}>
              {s.year ?? s.season_id}
            </button>
          ))}
        </Row>
      )}
    </div>
  )
}
