import { Star } from 'lucide-react'

// Team/season filter — each group the user has access to is its own pill.
// Label = "Team Year" (e.g. "U11 Whirlwinds 2025"). No separate Season axis.
// Deselecting all pills = show everything (same as no filter).
//
// myGroups: [{ team_id, season_id, label, year }]
// value:    [{ team_id, season_id }]  (selected pairs)
// favourites: [{ team_id, season_id }]  (starred defaults)
// onToggleFavourite: (group) => void  — omit to hide stars

export default function TeamSeasonFilter({ myGroups, value, onChange, hideLabel = false, favourites = [], onToggleFavourite }) {
  if (!myGroups.length) return null

  const sorted = [...myGroups].sort((a, b) => {
    const l = (a.label || '').localeCompare(b.label || '')
    return l !== 0 ? l : String(a.year || '').localeCompare(String(b.year || ''))
  })

  const selKeys = new Set(value.map(v => `${v.team_id}:${v.season_id}`))
  const favKeys = new Set(favourites.map(f => `${f.team_id}:${f.season_id}`))

  function toggle(g) {
    const key = `${g.team_id}:${g.season_id}`
    const next = selKeys.has(key)
      ? value.filter(v => !(v.team_id === g.team_id && v.season_id === g.season_id))
      : [...value, { team_id: g.team_id, season_id: g.season_id }]
    onChange(next.length ? next : myGroups.map(g => ({ team_id: g.team_id, season_id: g.season_id })))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {!hideLabel && <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>Team</span>}
      {sorted.map(g => {
        const key   = `${g.team_id}:${g.season_id}`
        const label = g.year ? `${g.label} ${g.year}` : g.label
        const isFav = favKeys.has(key)
        return (
          <button
            key={key}
            className={selKeys.has(key) ? 'pill active' : 'pill'}
            onClick={() => toggle(g)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            {label}
            {onToggleFavourite && (
              <Star
                size={11}
                fill={isFav ? '#f9a825' : 'none'}
                stroke={isFav ? '#f9a825' : 'currentColor'}
                strokeWidth={2}
                style={{ flexShrink: 0, opacity: isFav ? 1 : 0.45 }}
                title={isFav ? 'Remove default filter' : 'Set as default filter'}
                onClick={e => { e.stopPropagation(); onToggleFavourite(g) }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
