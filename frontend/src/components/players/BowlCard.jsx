import { dn } from '../../utils/cricket'
import { JerseyIcon, jerseyInitials } from '../JerseyIcon'

function n0(v) {
  return v == null ? 0 : v
}

export function BowlCard({ p, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        borderRadius: '10px',
        padding: '0.85rem 1rem',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem'
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.92rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}
      >
        <JerseyIcon size={18} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
        {dn(p.name)}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{n0(p.games_attended)} mat</div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Wkts
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{n0(p.wickets)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Avg
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bowl_avg ?? '–'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Econ
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bowl_econ ?? '–'}</div>
        </div>
      </div>
    </div>
  )
}
