import React, { useState } from 'react'
import { HandCoins, HelpCircle, Lock } from 'lucide-react'

const RunOutIcon = ({ size = 18 }) => (
  <img
    src="/runer-silhouette-running-fast.png"
    alt="run out"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const CatchingIcon = ({ size = 18 }) => (
  <img
    src="/catching.png"
    alt="caught"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const BowledPngIcon = ({ size = 18 }) => (
  <img
    src="/cricket.png"
    alt="bowled"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const LBWIcon = ({ size = 18 }) => (
  <img
    src="/pads.png"
    alt="lbw"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)

const DISMISSAL_ICONS = {
  Bowled: BowledPngIcon,
  Caught: CatchingIcon,
  CaughtAndBowled: HandCoins,
  LBW: LBWIcon,
  'Run out': RunOutIcon,
  RunOut: RunOutIcon,
  Stumped: Lock,
  Other: HelpCircle,
}

const EXTRAS_TYPE_HANDLERS = {
  2: (ball) => {
    const r = ball.runs_extra > 1 ? ball.runs_extra : ''
    return { type: 'wide', label: r ? `${r}wd` : 'wd' }
  },
  1: (ball) => {
    const r = ball.runs_bat > 0 ? `${ball.runs_bat}nb` : 'nb'
    return { type: 'noball', label: r }
  },
  3: (ball) => {
    const p = 'b'
    return { type: 'bye', label: ball.runs_extra > 1 ? `${ball.runs_extra}${p}` : p }
  },
  4: (ball) => {
    const p = 'lb'
    return { type: 'bye', label: ball.runs_extra > 1 ? `${ball.runs_extra}${p}` : p }
  },
}

function parseBallSymbol(ball) {
  const s = (ball.s_desc || '').trim().toUpperCase()
  if (ball.wicket) return { type: 'wicket', label: 'W' }
  if (s === '.' || s === '') return { type: 'dot', label: '·' }
  if (EXTRAS_TYPE_HANDLERS[ball.extras_type]) return EXTRAS_TYPE_HANDLERS[ball.extras_type](ball)
  if (ball.runs_bat === 6) return { type: 'six', label: '6' }
  if (ball.runs_bat === 4) return { type: 'four', label: '4' }
  if (ball.runs_bat > 0) return { type: 'run', label: String(ball.runs_bat) }
  return { type: 'dot', label: '·' }
}

function BallCircle({ ball }) {
  const { type, label } = parseBallSymbol(ball)
  return <span className={`ball ball-${type}`}>{label}</span>
}

const DISMISSAL_TEMPLATES = {
  Caught: (f, b) => (f && b ? `ct ${f} b ${b}` : b ? `caught b ${b}` : 'caught'),
  CaughtAndBowled: (f, b) => (b ? `c&b ${b}` : 'c&b'),
  Bowled: (f, b) => (b ? `b ${b}` : 'bowled'),
  LBW: (f, b) => (b ? `lbw b ${b}` : 'lbw'),
  Stumped: (f, b) => (f && b ? `st ${f} b ${b}` : 'stumped'),
  RunOut: (f) => (f ? `run out (${f})` : 'run out'),
  'Run out': (f) => (f ? `run out (${f})` : 'run out'),
}

function formatDismissalDesc(type, fielder, bowler) {
  const tpl = DISMISSAL_TEMPLATES[type]
  return tpl ? tpl(fielder, bowler) : type || 'out'
}

function BattingTable({ batting, navigate, isPairs, dn = (x) => x, matchId }) {
  if (!batting.length) return <div className="empty">No batting data</div>
  const showDotPct = !isPairs && batting[0]?.fours !== undefined
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Batter</th>
            {isPairs ? (
              <>
                <th className="num">R</th>
                <th className="num">Out</th>
                <th className="num">Net</th>
                <th className="num">B</th>
              </>
            ) : (
              <>
                <th>How out</th>
                <th className="num">R</th>
                <th className="num">B</th>
                <th className="num">4s</th>
                <th className="num">6s</th>
                <th className="num">SR</th>
                {showDotPct && <th className="num">Dot%</th>}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {batting.map((b) => (
            <tr key={b.player_id} style={b.did_not_bat ? { opacity: 0.45 } : {}}>
              <td className="bold">
                {b.player_id != null ? (
                  <span
                    className="player-link"
                    onClick={() =>
                      navigate(`/player/${b.player_id}`, { state: { from: `/match/${matchId}` } })
                    }
                  >
                    {dn(b.name)}
                  </span>
                ) : (
                  dn(b.name)
                )}
              </td>
              {isPairs ? (
                <>
                  <td className="num bold">{b.did_not_bat ? '–' : b.runs}</td>
                  <td className="num">{b.did_not_bat ? '–' : b.timesOut}</td>
                  <td className={`num bold ${b.netScore < 0 ? 'dismissed' : ''}`}>
                    {b.did_not_bat ? '–' : b.netScore}
                  </td>
                  <td className="num dim">{b.did_not_bat ? '–' : b.balls}</td>
                </>
              ) : (
                <>
                  <td
                    className={b.did_not_bat ? 'muted' : b.dismissed ? 'dismissed' : 'dim'}
                    style={{ fontSize: '0.82rem' }}
                  >
                    {'dismissalFielder' in b
                      ? formatDismissalDesc(
                          b.dismissalType,
                          dn(b.dismissalFielder),
                          dn(b.dismissalBowler)
                        )
                      : b.dismissalDesc || (b.dismissed ? 'out' : 'not out')}
                  </td>
                  <td className="num bold">{b.did_not_bat ? '–' : b.runs}</td>
                  <td className="num dim">{b.did_not_bat ? '–' : b.balls}</td>
                  <td className="num">{b.did_not_bat ? '' : b.fours}</td>
                  <td className="num">{b.did_not_bat ? '' : b.sixes}</td>
                  <td className="num dim">
                    {b.did_not_bat || b.balls === 0 ? '–' : ((b.runs / b.balls) * 100).toFixed(0)}
                  </td>
                  {showDotPct && (
                    <td className="num dim">
                      {b.did_not_bat || b.dot_pct == null ? '–' : `${b.dot_pct}%`}
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function spellFigures(spell) {
  const total = spell.balls + (spell.wides || 0) + (spell.noBalls || 0)
  const overs = Math.floor(total / 6)
  const rem = total % 6
  const oversStr = rem > 0 ? `${overs}.${rem}` : String(overs)
  return `${oversStr}-${spell.maidens}-${spell.runs}-${spell.wickets}`
}

function BowlingTable({ bowling, navigate, dn = (x) => x, matchId = null }) {
  const [expandedSpells, setExpandedSpells] = useState({})
  if (!bowling.length) return <div className="empty">No bowling data</div>
  const rows = bowling
  const showDotPct = rows[0]?.dot_pct !== undefined

  function toggleSpells(playerId) {
    setExpandedSpells((prev) => ({ ...prev, [playerId]: !prev[playerId] }))
  }

  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Bowler</th>
            <th className="num">O</th>
            <th className="num">M</th>
            <th className="num">R</th>
            <th className="num">W</th>
            <th className="num">Wd</th>
            <th className="num">NB</th>
            <th className="num">Econ</th>
            {showDotPct && <th className="num">Dot%</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const hasMultipleSpells = b.spells?.length > 1
            const isExpanded = !!expandedSpells[b.player_id]
            return (
              <React.Fragment key={b.player_id}>
                <tr>
                  <td className="bold">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {b.player_id != null ? (
                        <span
                          className="player-link"
                          onClick={() =>
                            navigate(`/player/${b.player_id}`, {
                              state: { from: matchId ? `/match/${matchId}` : null },
                            })
                          }
                        >
                          {dn(b.name)}
                        </span>
                      ) : (
                        dn(b.name)
                      )}
                      {hasMultipleSpells && (
                        <button
                          onClick={() => toggleSpells(b.player_id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: '0 2px',
                            cursor: 'pointer',
                            fontSize: '0.7rem',
                            color: 'var(--text3)',
                            lineHeight: 1,
                          }}
                          title={isExpanded ? 'Hide spells' : 'Show spell breakdown'}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="num">{b.overs}</td>
                  <td className="num">{b.maidens}</td>
                  <td className="num">{b.runs}</td>
                  <td className={`num ${b.wickets > 0 ? 'bold' : ''}`}>{b.wickets}</td>
                  <td className="num dim">{b.wides}</td>
                  <td className="num dim">{b.noBalls}</td>
                  <td className="num dim">{b.economy || '–'}</td>
                  {showDotPct && (
                    <td className="num dim">{b.dot_pct != null ? `${b.dot_pct}%` : '–'}</td>
                  )}
                </tr>
                {hasMultipleSpells &&
                  isExpanded &&
                  b.spells.map((spell, idx) => (
                    <tr
                      key={`${b.player_id}-spell-${idx}`}
                      style={{ background: 'var(--bg2, var(--bg))' }}
                    >
                      <td
                        colSpan={showDotPct ? 9 : 8}
                        style={{
                          paddingLeft: '1.5rem',
                          fontSize: '0.78rem',
                          color: 'var(--text3)',
                          paddingTop: 2,
                          paddingBottom: 2,
                        }}
                      >
                        Spell {idx + 1}: overs {spell.from_over + 1}
                        {spell.from_over !== spell.to_over
                          ? `–${spell.to_over + 1}`
                          : ''} &nbsp; {spellFigures(spell)}
                      </td>
                    </tr>
                  ))}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function OversGrid({ overs, dn = (x) => x, onEditBall, onReassignPair, isPairs = false }) {
  if (!overs.length) return <div className="empty">No over data</div>

  // For pairs: detect 4-over blocks by grouping consecutive overs with the same pair
  const pairBlockStarts = new Set()
  if (isPairs && onReassignPair) {
    const BLOCK_SIZE = 4
    for (let i = 0; i < overs.length; i += BLOCK_SIZE) {
      pairBlockStarts.add(overs[i].over)
    }
  }

  return (
    <div className={`over-grid${isPairs ? ' over-grid-pairs' : ''}`}>
      {overs.map((o) => {
        const wides = o.balls.filter((b) => b.extras_type === 2).length
        const noBalls = o.balls.filter((b) => b.extras_type === 1).length
        const isBlockStart = pairBlockStarts.has(o.over)
        return (
          <div key={o.over} className="over-cell">
            <div className="over-header">
              <span className="over-num">
                Over {o.over}
                {isBlockStart &&
                  onReassignPair &&
                  (() => {
                    const blockEnd = Math.min(o.over + 3, overs[overs.length - 1].over)
                    const playerIds = [
                      ...new Set(
                        overs
                          .filter((x) => x.over >= o.over && x.over <= blockEnd)
                          .flatMap((x) =>
                            x.balls.flatMap((b) =>
                              [b.batter_id, b.batter_id_ns ?? null].filter(Boolean)
                            )
                          )
                      ),
                    ]
                    return (
                      <button
                        title={`Reassign pair (overs ${o.over}–${blockEnd})`}
                        onClick={() =>
                          onReassignPair({
                            overStart: o.over,
                            overEnd: blockEnd,
                            currentPlayerIds: playerIds,
                          })
                        }
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '0 2px',
                          fontSize: '0.65rem',
                          color: 'var(--text3)',
                          lineHeight: 1,
                        }}
                      >
                        ✎
                      </button>
                    )
                  })()}
              </span>
              <span className="over-runs">
                {o.runs}
                {o.wickets > 0 && (
                  <span style={{ color: 'var(--red)', marginLeft: 3 }}>·{o.wickets}W</span>
                )}
                {wides > 0 && (
                  <span style={{ color: 'var(--text3)', marginLeft: 3, fontSize: '0.7em' }}>
                    {wides}wd
                  </span>
                )}
                {noBalls > 0 && (
                  <span style={{ color: 'var(--text3)', marginLeft: 3, fontSize: '0.7em' }}>
                    {noBalls}nb
                  </span>
                )}
              </span>
            </div>
            <div className="over-balls">
              {o.balls.map((b, i) =>
                onEditBall ? (
                  <span
                    key={i}
                    className="ball-editable"
                    title="Edit delivery"
                    onClick={() => onEditBall(b)}
                  >
                    <BallCircle ball={b} />
                  </span>
                ) : (
                  <BallCircle key={i} ball={b} />
                )
              )}
            </div>
            <div className="over-bowler">{dn(o.bowler)}</div>
          </div>
        )
      })}
    </div>
  )
}

function OversTable({ overs, dn = (x) => x }) {
  if (!overs.length) return <div className="empty">No over data</div>
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th className="num">Ov</th>
            <th>Bowler</th>
            <th className="num">R</th>
            <th className="num">W</th>
            <th className="num">Econ</th>
          </tr>
        </thead>
        <tbody>
          {overs.map((o) => {
            const legalBalls = o.balls.filter(
              (b) => b.extras_type !== 2 && b.extras_type !== 1
            ).length
            const econ = legalBalls > 0 ? ((o.runs / legalBalls) * 6).toFixed(1) : '–'
            return (
              <tr key={o.over}>
                <td className="num dim">{o.over}</td>
                <td>{dn(o.bowler)}</td>
                <td className="num">{o.runs}</td>
                <td className={`num ${o.wickets > 0 ? 'bold' : 'dim'}`}>
                  {o.wickets > 0 ? o.wickets : '–'}
                </td>
                <td className="num dim">{econ}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function formatDismissalLabel(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  if (type === 'RunOut') return 'Run out'
  return type
}

export { BattingTable, BowlingTable, OversGrid, OversTable, formatDismissalLabel, DISMISSAL_ICONS }
