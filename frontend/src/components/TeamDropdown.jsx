import { useState, useEffect, useRef } from 'react'
import TeamSeasonFilter from './TeamSeasonFilter'

function useClickAway(open, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, onClose])
  return ref
}

function DropdownPanel({ myGroups, value, onChange, favourites, onToggleFavourite }) {
  return (
    <div
      style={{
        position: 'absolute',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.75rem',
        marginTop: '0.5rem',
        zIndex: 200,
        minWidth: '280px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: '0.5rem',
          borderBottom: '1px solid var(--border2)',
          paddingBottom: '0.5rem'
        }}
      >
        <button
          className="pill active"
          style={{ fontSize: '0.72rem' }}
          onClick={() => onChange(null)}
        >
          All
        </button>
        <button className="pill" style={{ fontSize: '0.72rem' }} onClick={() => onChange([])}>
          None
        </button>
      </div>
      <TeamSeasonFilter
        myGroups={myGroups}
        value={value}
        onChange={onChange}
        hideLabel
        favourites={favourites}
        onToggleFavourite={onToggleFavourite}
      />
    </div>
  )
}

/**
 * Reusable "Teams" dropdown button used on PlayerList, MatchList, and Admin PlayersTab.
 *
 * value:    [{team_id, season_id}] to display as active pills. Pass allPairs when
 *           selection is null/default so all pills appear active.
 * onChange: called with [{team_id, season_id}] when a pill is toggled,
 *           or null when All is clicked (reset to defaults),
 *           or []  when None is clicked.
 */
export default function TeamDropdown({
  myGroups,
  value,
  onChange,
  favourites = [],
  onToggleFavourite,
  isExplicit = false
}) {
  const [open, setOpen] = useState(false)
  const ref = useClickAway(open, () => setOpen(false))
  const count = isExplicit && value ? value.length : null

  return (
    <div ref={ref} style={{ display: 'inline-block', position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          cursor: 'pointer',
          fontSize: '0.78rem',
          color: isExplicit ? 'var(--text)' : 'var(--text2)',
          padding: '0.4rem 0.8rem',
          borderRadius: 4,
          border: isExplicit ? '1px solid var(--accent)' : '1px solid var(--border2)',
          background: 'none',
          userSelect: 'none',
          fontWeight: 500
        }}
      >
        Teams{count !== null ? ` (${count})` : ''}
      </button>
      {open && (
        <DropdownPanel
          myGroups={myGroups}
          value={value}
          onChange={onChange}
          favourites={favourites}
          onToggleFavourite={onToggleFavourite}
        />
      )}
    </div>
  )
}
