import { JerseyIcon, jerseyInitials } from './JerseyIcon'
import { dn } from '../utils/cricket'

function numColor(_v, _isGc) {
  return '#fff'
}

function StatRow({ label, value, isGc, isOverall }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: isOverall ? '0.55rem 0.9rem' : '0.35rem 0.9rem',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        background: isOverall ? 'rgba(105,0,40,0.35)' : undefined
      }}
    >
      <span
        style={{
          fontSize: isOverall ? '0.72rem' : '0.68rem',
          fontWeight: isOverall ? 700 : 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: isOverall ? '#fff' : 'rgba(255,255,255,0.7)'
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: isOverall ? '1.35rem' : '1.1rem',
          fontWeight: 700,
          color: isOverall ? '#ffd700' : numColor(value, isGc),
          minWidth: '2.5ch',
          textAlign: 'right'
        }}
      >
        {value}
      </span>
    </div>
  )
}

function CardHeader({ p }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #690028 0%, #232346 100%)',
        padding: '0.75rem 0.9rem 0.6rem',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.7rem'
      }}
    >
      <JerseyIcon size={44} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: '0.9rem',
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {dn(p.name)}
        </div>
        <div style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>
          {p.matches} {p.matches === 1 ? 'match' : 'matches'}
        </div>
      </div>
    </div>
  )
}

function CardStats({ p }) {
  if (!p.qualified) {
    return (
      <div
        style={{
          padding: '1rem 0.9rem',
          fontSize: '0.75rem',
          color: 'var(--text3)',
          textAlign: 'center',
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        Min 5 matches needed
      </div>
    )
  }
  return (
    <>
      <StatRow label="Batting" value={p.batting} />
      <StatRow label="Bowling" value={p.bowling} />
      <StatRow label="Fielding" value={p.fielding} />
      <StatRow label="Gamechanger" value={p.gamechanger} isGc />
      <StatRow label="Top Trumps Rating" value={p.overall} isOverall />
    </>
  )
}

export function TopTrumpsCard({ p, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: '#111',
        border: '2px solid #690028',
        borderRadius: '10px',
        cursor: onClick ? 'pointer' : 'default',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <CardHeader p={p} />
      <CardStats p={p} />
    </div>
  )
}
