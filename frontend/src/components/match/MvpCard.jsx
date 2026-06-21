import { useState } from 'react'
import MvpTopRow from './MvpTopRow'
import MvpFormulaRow from './MvpFormulaRow'

function mvpMeta(meta) {
  const {
    wicketVal: wv = 1.8,
    maidensPerWicket: mpw = 2,
    srPct = 0.08,
    teamSR = null,
    matchType = 'T20'
  } = meta || {}
  return { wv, mpw, srPct, teamSR, matchType }
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
            <MvpFormulaRow
              key={p.playerId}
              p={p}
              i={i}
              mvpLength={mvp.length}
              dn={dn}
              teamSR={teamSR}
            />
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

export default function MvpCard({ mvp, meta, dn, jerseyNumbers = {} }) {
  const [showFormula, setShowFormula] = useState(false)
  if (!mvp?.length) return null

  const { wv, mpw, srPct, teamSR, matchType } = mvpMeta(meta)

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Match MVP</h3>
      {mvp.slice(0, 3).map((p, i, arr) => (
        <MvpTopRow
          key={p.playerId}
          p={p}
          i={i}
          borderBottom={i < arr.length - 1 ? '1px solid var(--border)' : 'none'}
          jerseyNumbers={jerseyNumbers}
          dn={dn}
        />
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
