import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { JerseyIcon, jerseyInitials } from '../JerseyIcon'

function PlayerLink({ playerId, name, dn }) {
  const navigate = useNavigate()
  if (playerId > 0)
    return (
      <span className="player-link" onClick={() => navigate(`/player/${playerId}`)}>
        {dn(name)}
      </span>
    )
  return dn(name)
}

function MvpFormulaPanel({ mvp, dn, wv, mpw, srPct, teamSR, matchType }) {
  return (
    <div
      style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text3)', lineHeight: 1.7 }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
        <thead>
          <tr style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 4 }}>Player</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>Bat</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>SR</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>SR+</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>Bowl</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>Haul+</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>Mdn+</th>
            <th style={{ textAlign: 'right', fontWeight: 400 }}>Field</th>
            <th style={{ textAlign: 'right', fontWeight: 600 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {mvp.map((p, i) => (
            <tr
              key={p.playerId}
              style={{
                borderBottom: i < mvp.length - 1 ? '1px solid var(--border)' : 'none',
                opacity: i >= 3 ? 0.7 : 1
              }}
            >
              <td style={{ paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>
                <PlayerLink playerId={p.playerId} name={p.name} dn={dn} />
              </td>
              <td style={{ textAlign: 'right' }}>{p.batBase > 0 ? p.batBase : '—'}</td>
              <td
                style={{
                  textAlign: 'right',
                  color:
                    p.batSR != null && teamSR != null && p.batSR > teamSR
                      ? 'var(--green)'
                      : 'inherit'
                }}
              >
                {p.batSR != null ? p.batSR : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                {p.batSRBonus > 0 ? `+${p.batSRBonus}` : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {p.bowl > 0 ? +(p.bowl - p.bowlHaulBonus - p.bowlMaidenBonus).toFixed(1) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                {p.bowlHaulBonus > 0 ? `+${p.bowlHaulBonus}` : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                {p.bowlMaidenBonus > 0 ? `+${p.bowlMaidenBonus}` : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>{p.field > 0 ? p.field : '—'}</td>
              <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text1)' }}>
                {p.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.4rem' }}>
        <div>
          <strong>Batting</strong> · 10 runs = 1 pt
          {teamSR != null ? ` · team SR: ${teamSR}` : ''} · SR bonus: base pts × (yourSR ÷ teamSR −
          1) × {Math.round(srPct * 100)}% when faster than team
        </div>
        <div>
          <strong>Bowling</strong> · {wv} pts/wkt ({matchType}) · 3-fer +0.5, 5-fer +1.0 ·{' '}
          {+(wv / mpw).toFixed(2)} pts/maiden
        </div>
        <div>
          <strong>Fielding</strong> · {+(wv * 0.2).toFixed(2)} pts per catch, stumping or run out
        </div>
        <div style={{ marginTop: '0.2rem' }}>
          Based on the{' '}
          <a
            href="https://blog.cricheroes.com/most-valuable-player-mvp-by-cricheroes/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)' }}
          >
            CricHeroes MVP algorithm
          </a>
        </div>
      </div>
    </div>
  )
}

function scoreBreakdown(p) {
  return [
    p.bat > 0 && `bat ${p.bat}`,
    p.bowl > 0 && `bowl ${p.bowl}`,
    p.field > 0 && `field ${p.field}`
  ]
    .filter(Boolean)
    .join(' · ')
}

export default function MvpCard({ mvp, meta, dn, jerseyNumbers = {} }) {
  const navigate = useNavigate()
  const [showFormula, setShowFormula] = useState(false)
  if (!mvp?.length) return null

  const wv = meta?.wicketVal ?? 1.8
  const mpw = meta?.maidensPerWicket ?? 2
  const srPct = meta?.srPct ?? 0.08
  const teamSR = meta?.teamSR ?? null
  const matchType = meta?.matchType ?? 'T20'

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Match MVP</h3>
      {mvp.slice(0, 3).map((p, i) => (
        <div
          key={p.playerId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 0',
            borderBottom: i < Math.min(mvp.length, 3) - 1 ? '1px solid var(--border)' : 'none'
          }}
        >
          <span
            style={{
              width: 18,
              fontWeight: 700,
              color: i === 0 ? '#f9a825' : 'var(--text3)',
              fontSize: '0.9rem'
            }}
          >
            {i + 1}
          </span>
          <JerseyIcon
            size={24}
            initials={jerseyInitials(p.name)}
            number={jerseyNumbers[p.playerId]}
          />
          <span style={{ flex: 1, fontWeight: i === 0 ? 600 : 400 }}>
            <PlayerLink playerId={p.playerId} name={p.name} dn={dn} />
          </span>
          <span
            className={`tag ${i === 0 ? 'tag-green' : ''}`}
            style={{ minWidth: 52, textAlign: 'center' }}
          >
            {p.total} pts
          </span>
          <span
            style={{
              fontSize: '0.78rem',
              color: 'var(--text2)',
              minWidth: 120,
              textAlign: 'right'
            }}
          >
            {scoreBreakdown(p)}
          </span>
        </div>
      ))}
      <div style={{ marginTop: '0.75rem' }}>
        <button
          onClick={() => setShowFormula((v) => !v)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: '0.75rem',
            color: 'var(--text3)'
          }}
        >
          {showFormula ? '▲' : '▼'} How is this calculated?
        </button>
        {showFormula && (
          <MvpFormulaPanel
            mvp={mvp}
            dn={dn}
            wv={wv}
            mpw={mpw}
            srPct={srPct}
            teamSR={teamSR}
            matchType={matchType}
          />
        )}
      </div>
    </div>
  )
}
