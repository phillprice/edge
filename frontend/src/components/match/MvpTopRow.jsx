import { useNavigate } from 'react-router-dom'
import { JerseyIcon, jerseyInitials } from '../JerseyIcon'

const SCORE_STYLE = {
  fontSize: '0.78rem',
  color: 'var(--text2)',
  minWidth: 120,
  textAlign: 'right'
}
const TOP_RANK_STYLE = { width: 18, fontWeight: 700, color: '#f9a825', fontSize: '0.9rem' }
const OTHER_RANK_STYLE = { width: 18, fontWeight: 700, color: 'var(--text3)', fontSize: '0.9rem' }

function scoreBreakdown(p) {
  return [
    p.bat > 0 && `bat ${p.bat}`,
    p.bowl > 0 && `bowl ${p.bowl}`,
    p.field > 0 && `field ${p.field}`
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function MvpTopRow({ p, i, borderBottom, jerseyNumbers, dn }) {
  const navigate = useNavigate()
  const tagClass = `tag${i === 0 ? ' tag-green' : ''}`
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom }}>
      <span style={i === 0 ? TOP_RANK_STYLE : OTHER_RANK_STYLE}>{i + 1}</span>
      <JerseyIcon size={24} initials={jerseyInitials(p.name)} number={jerseyNumbers[p.playerId]} />
      <span style={{ flex: 1, fontWeight: i === 0 ? 600 : 400 }}>
        {p.playerId > 0 ? (
          <span className="player-link" onClick={() => navigate(`/player/${p.playerId}`)}>
            {dn(p.name)}
          </span>
        ) : (
          dn(p.name)
        )}
      </span>
      <span className={tagClass} style={{ minWidth: 52, textAlign: 'center' }}>
        {p.total} pts
      </span>
      <span style={SCORE_STYLE}>{scoreBreakdown(p)}</span>
    </div>
  )
}
