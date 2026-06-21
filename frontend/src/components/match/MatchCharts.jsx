import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart,
  Bar,
  LabelList,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts'
import { shortTeam, isWhccTeam as isWhcc } from '../../utils/cricket'

function lightenForDark(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  // Convert to HSL, ensure minimum lightness of 55% so bars are visible on dark bg
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
  let l = (max + min) / 2
  if (l < 0.55) {
    const s = max === min ? 0 : l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)
    const h = max === min ? 0
      : max === r / 255 ? ((g - b) / 255 / (max - min) + (g < b ? 6 : 0)) / 6
      : max === g / 255 ? ((b - r) / 255 / (max - min) + 2) / 6
      : ((r - g) / 255 / (max - min) + 4) / 6
    l = 0.55
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    const hue2rgb = (t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    r = Math.round(hue2rgb(h + 1 / 3) * 255)
    g = Math.round(hue2rgb(h) * 255)
    b = Math.round(hue2rgb(h - 1 / 3) * 255)
  }
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function getChartColours(isDark) {
  const root = document.documentElement
  const get = (v) => getComputedStyle(root).getPropertyValue(v).trim()
  const raw = { whcc: get('--nav-bg') || '#690028', opp: get('--secondary-colour') || '#3E14BA' }
  return isDark ? { whcc: lightenForDark(raw.whcc), opp: lightenForDark(raw.opp) } : raw
}

function WicketDotLabel({ x, y, width, value: over, inningsOrder, manhattanData }) {
  const row = manhattanData.find((r) => r.over === over)
  const val = row?.[`inn${inningsOrder}`]
  const wkts = row?.[`wkt${inningsOrder}`] || 0
  if (!wkts || val == null) return null
  const below = val < 0
  return (
    <g>
      {Array.from({ length: wkts }, (_, i) => (
        <circle
          key={i}
          cx={x + width / 2}
          cy={below ? y + 5 + i * 8 : y - 5 - i * 8}
          r={3}
          fill="#ff69b4"
        />
      ))}
    </g>
  )
}

function PartnershipChart({ partnerships, dn = (x) => x, dark }) {
  const navigate = useNavigate()
  const RED = getChartColours(dark).whcc
  const maxRuns = Math.max(...partnerships.map((p) => p.runs), 1)
  return (
    <div style={{ padding: '0.25rem 0' }}>
      {partnerships.map((p, i) => {
        const pct = Math.max((p.runs / maxRuns) * 88, p.runs > 0 ? 6 : 2)
        const rr = p.balls > 0 ? ((p.runs / p.balls) * 6).toFixed(1) : '–'
        return (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 2fr 1fr',
              gap: '0.5rem',
              alignItems: 'center',
              marginBottom: '0.75rem'
            }}
          >
            <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                {p.batter1_id > 0 ? (
                  <span className="player-link" onClick={() => navigate(`/player/${p.batter1_id}`)}>
                    {dn(p.batter1_name)}
                  </span>
                ) : (
                  dn(p.batter1_name)
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>
                {p.batter1_runs} ({p.batter1_balls})
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ position: 'relative', width: '100%', height: 28 }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: 0,
                    right: 0,
                    height: 14,
                    borderRadius: 99,
                    background: 'var(--bg2)'
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    left: `${(100 - pct) / 2}%`,
                    width: `${pct}%`,
                    height: 14,
                    borderRadius: 99,
                    background: p.dismissed_batter_id ? RED : `${RED}99`
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 1,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    minWidth: 28,
                    height: 26,
                    padding: '0 5px',
                    borderRadius: 99,
                    background: 'var(--bg)',
                    border: '1.5px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    zIndex: 1
                  }}
                >
                  {p.runs}
                </div>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>{rr} rpo</div>
            </div>
            <div style={{ textAlign: 'left', lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>
                {p.batter2_id > 0 ? (
                  <span className="player-link" onClick={() => navigate(`/player/${p.batter2_id}`)}>
                    {dn(p.batter2_name)}
                  </span>
                ) : (
                  dn(p.batter2_name)
                )}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>
                {p.batter2_runs} ({p.batter2_balls})
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function MatchCharts({
  scorecards,
  roles,
  fixture,
  partnerships = [],
  phases = [],
  dn = (x) => x,
  dark
}) {
  const charted = scorecards.filter((sc) => !sc.isManual && sc.overs?.length > 0)
  const whccPartnerships = partnerships.filter((p) =>
    isWhcc(roles?.[p.innings_order]?.batting_team)
  )
  const hasPartnerships = whccPartnerships.length > 0
  const defaultTab = charted.length > 0 ? 'manhattan' : hasPartnerships ? 'partnerships' : 'phases'
  const [tab, setTab] = useState(defaultTab)
  const [showNet, setShowNet] = useState(true)

  const hasPairs = charted.some((sc) => sc.isPairs)
  const startingScore = fixture?.starting_score || 0

  const CC = getChartColours(dark)
  const getColor = (sc) => {
    if (!sc) return CC.opp
    const team = roles?.[sc.inningsOrder]?.batting_team
    return isWhcc(team) ? CC.whcc : CC.opp
  }
  const getLabel = (sc) => {
    if (!sc) return ''
    const team = roles?.[sc.inningsOrder]?.batting_team
    if (!team) return `Inn ${sc.inningsOrder}`
    return shortTeam(team)
  }

  const maxOver =
    charted.length > 0 ? Math.max(...charted.flatMap((sc) => sc.overs.map((o) => o.over))) : 0

  const manhattanData = useMemo(
    () =>
      Array.from({ length: maxOver }, (_, i) => {
        const over = i + 1
        const row = { over }
        for (const sc of charted) {
          const o = sc.overs.find((x) => x.over === over)
          row[`inn${sc.inningsOrder}`] = o
            ? sc.isPairs && showNet
              ? o.runs - o.wickets * 5
              : o.runs
            : undefined
          row[`wkt${sc.inningsOrder}`] = o ? o.wickets : 0
        }
        return row
      }),
    [charted, showNet, maxOver]
  )

  const wormData = (() => {
    const overNums = [
      ...new Set([0, ...charted.flatMap((sc) => sc.overs.map((o) => o.over))])
    ].sort((a, b) => a - b)
    return overNums.map((over) => {
      const row = { over }
      for (const sc of charted) {
        const scMaxOver = sc.overs.length ? Math.max(...sc.overs.map((o) => o.over)) : 0
        if (over > scMaxOver) {
          row[`inn${sc.inningsOrder}`] = null
          row[`wkt${sc.inningsOrder}`] = 0
        } else {
          const cumRuns = sc.overs.filter((o) => o.over <= over).reduce((s, o) => s + o.runs, 0)
          const cumWkts = sc.overs.filter((o) => o.over <= over).reduce((s, o) => s + o.wickets, 0)
          row[`inn${sc.inningsOrder}`] =
            sc.isPairs && showNet ? startingScore + cumRuns - cumWkts * 5 : cumRuns
          const o = sc.overs.find((x) => x.over === over)
          row[`wkt${sc.inningsOrder}`] = o?.wickets || 0
        }
      }
      return row
    })
  })()

  const rrData = (() => {
    const overNums = [...new Set(charted.flatMap((sc) => sc.overs.map((o) => o.over)))].sort(
      (a, b) => a - b
    )
    return overNums.map((over) => {
      const row = { over }
      for (const sc of charted) {
        const scMaxOver = sc.overs.length ? Math.max(...sc.overs.map((o) => o.over)) : 0
        if (over > scMaxOver) {
          row[`inn${sc.inningsOrder}`] = null
          row[`wkt${sc.inningsOrder}`] = 0
        } else {
          const cumRuns = sc.overs.filter((o) => o.over <= over).reduce((s, o) => s + o.runs, 0)
          if (sc.isPairs && showNet) {
            const cumWkts = sc.overs
              .filter((o) => o.over <= over)
              .reduce((s, o) => s + o.wickets, 0)
            row[`inn${sc.inningsOrder}`] = +((cumRuns - cumWkts * 5) / over).toFixed(2)
          } else {
            row[`inn${sc.inningsOrder}`] = +(cumRuns / over).toFixed(2)
          }
          const o = sc.overs.find((x) => x.over === over)
          row[`wkt${sc.inningsOrder}`] = o?.wickets || 0
        }
      }
      return row
    })
  })()

  const wicketDotContent = useMemo(
    () =>
      charted.map((sc) => (props) => (
        <WicketDotLabel {...props} inningsOrder={sc.inningsOrder} manhattanData={manhattanData} />
      )),
    [manhattanData, charted]
  )

  if (charted.length === 0 && !hasPartnerships && phases.length === 0) return null

  const makeWormDot = (sc) => (props) => {
    const { cx, cy, payload } = props
    if (!payload || !payload[`wkt${sc.inningsOrder}`]) return null
    return (
      <circle
        key={`wdot-${sc.inningsOrder}-${props.index}`}
        cx={cx}
        cy={cy}
        r={4}
        fill="#ff69b4"
        stroke="#fff"
        strokeWidth={1.5}
      />
    )
  }

  const axisStyle = { fontSize: 11, fill: 'var(--text2)' }
  const gridProps = { strokeDasharray: '3 3', stroke: 'var(--border)' }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: '1rem',
          flexWrap: 'wrap'
        }}
      >
        {[
          ...(charted.length > 0 ? ['manhattan', 'worm', 'run rate'] : []),
          ...(hasPartnerships ? ['partnerships'] : []),
          ...(phases.length > 0 ? ['phases'] : [])
        ].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab !== t ? 'secondary' : ''}
            style={{ fontSize: '0.82rem', padding: '4px 12px', textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
        {hasPairs && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[
              { v: true, label: 'Net' },
              { v: false, label: 'Raw' }
            ].map(({ v, label }) => (
              <button
                key={label}
                onClick={() => setShowNet(v)}
                className={showNet !== v ? 'secondary' : ''}
                style={{ fontSize: '0.78rem', padding: '2px 10px' }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === 'manhattan' &&
        (() => {
          let manhattanMin = 0
          let maxWktsAtMin = 0
          for (const row of manhattanData) {
            for (const sc of charted) {
              const val = row[`inn${sc.inningsOrder}`]
              if (val != null && val < manhattanMin) {
                manhattanMin = val
                maxWktsAtMin = row[`wkt${sc.inningsOrder}`] || 0
              } else if (val != null && val === manhattanMin) {
                maxWktsAtMin = Math.max(maxWktsAtMin, row[`wkt${sc.inningsOrder}`] || 0)
              }
            }
          }
          const dotBuffer = maxWktsAtMin > 0 ? Math.ceil((5 + (maxWktsAtMin - 1) * 8) / 4) : 0
          const yDomainMin = manhattanMin < 0 ? manhattanMin - dotBuffer : 0
          return (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={manhattanData}
                margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
                barCategoryGap="20%"
              >
                <CartesianGrid {...gridProps} vertical={false} />
                <XAxis dataKey="over" tick={axisStyle} />
                <YAxis tick={axisStyle} domain={[yDomainMin, 'auto']} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div
                        style={{
                          background: 'var(--bg)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          fontSize: '0.82rem'
                        }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>Over {label}</div>
                        {payload
                          .filter((p) => p.value != null)
                          .map((p) => {
                            const sc = charted.find((s) => `inn${s.inningsOrder}` === p.dataKey)
                            const wkts =
                              manhattanData.find((d) => d.over === label)?.[
                                `wkt${sc?.inningsOrder}`
                              ] || 0
                            return (
                              <div key={p.dataKey} style={{ color: p.fill }}>
                                {getLabel(sc)}: {p.value} runs{wkts > 0 ? ` · ${wkts}W` : ''}
                              </div>
                            )
                          })}
                      </div>
                    )
                  }}
                />
                {charted.length > 1 && (
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    formatter={(_, entry) =>
                      getLabel(charted.find((sc) => `inn${sc.inningsOrder}` === entry.dataKey))
                    }
                  />
                )}
                {charted.map((sc, i) => (
                  <Bar
                    key={sc.inningsOrder}
                    dataKey={`inn${sc.inningsOrder}`}
                    name={getLabel(sc)}
                    fill={getColor(sc)}
                    radius={[2, 2, 0, 0]}
                    minPointSize={1}
                    isAnimationActive={false}
                  >
                    <LabelList dataKey="over" content={wicketDotContent[i]} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          )
        })()}

      {tab === 'worm' && (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={wormData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="over" tick={axisStyle} />
              <YAxis
                tick={axisStyle}
                domain={hasPairs && showNet ? ['auto', 'auto'] : [0, 'auto']}
              />
              <Tooltip
                formatter={(v, key) => {
                  const sc = charted.find((s) => `inn${s.inningsOrder}` === key)
                  return [v, getLabel(sc)]
                }}
              />
              {charted.length > 1 && (
                <Legend
                  formatter={(_, entry) =>
                    getLabel(charted.find((sc) => `inn${sc.inningsOrder}` === entry.dataKey))
                  }
                />
              )}
              {charted.map((sc) => (
                <Line
                  key={sc.inningsOrder}
                  type="linear"
                  dataKey={`inn${sc.inningsOrder}`}
                  stroke={getColor(sc)}
                  strokeWidth={2}
                  dot={makeWormDot(sc)}
                  activeDot={{ r: 4 }}
                  name={getLabel(sc)}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      {tab === 'run rate' && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rrData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} domain={[0, 'auto']} tickFormatter={(v) => v.toFixed(1)} />
            <Tooltip
              formatter={(v, key) => {
                const sc = charted.find((s) => `inn${s.inningsOrder}` === key)
                return [`${v} rpo`, getLabel(sc)]
              }}
            />
            {charted.length > 1 && (
              <Legend
                formatter={(_, entry) =>
                  getLabel(charted.find((sc) => `inn${sc.inningsOrder}` === entry.dataKey))
                }
              />
            )}
            {charted.map((sc) => (
              <Line
                key={sc.inningsOrder}
                type="linear"
                dataKey={`inn${sc.inningsOrder}`}
                stroke={getColor(sc)}
                strokeWidth={2}
                dot={makeWormDot(sc)}
                activeDot={{ r: 4 }}
                name={getLabel(sc)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {tab === 'partnerships' && (
        <PartnershipChart partnerships={whccPartnerships} dn={dn} dark={dark} />
      )}

      {tab === 'phases' &&
        (() => {
          const getPhaseColor = (inn) => {
            const team = roles?.[inn.innings_order]?.batting_team
            return isWhcc(team) ? CC.whcc : CC.opp
          }
          const getPhaseLabel = (inn) => {
            const sc = scorecards.find((s) => s.inningsOrder === inn.innings_order)
            const team = roles?.[inn.innings_order]?.batting_team
            if (team) return shortTeam(team)
            if (sc?.isManual)
              return inn.innings_order === 1
                ? shortTeam(fixture.home_team || 'WHCC')
                : shortTeam(fixture.away_team || 'Opp')
            return `Innings ${inn.innings_order}`
          }
          const PHASE_ORDER = ['Powerplay', 'Middle', 'Death']
          const chartData = PHASE_ORDER.map((phaseName) => {
            const row = { phase: phaseName }
            phases.forEach((inn) => {
              const sc = scorecards.find((s) => s.inningsOrder === inn.innings_order)
              const p = inn.phases.find((x) => x.phase === phaseName)
              if (p) {
                const k = `inn${inn.innings_order}`
                row[k] = sc?.isPairs && showNet ? p.runs - p.wickets * 5 : p.runs
                row[`${k}w`] = p.wickets
                row[`${k}rr`] = p.run_rate
                row[`${k}ov`] = p.from === p.to ? `Ov ${p.from}` : `Ov ${p.from}–${p.to}`
              }
            })
            return row
          }).filter((row) => phases.some((inn) => row[`inn${inn.innings_order}`] !== undefined))

          const PhaseTooltip = ({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return (
              <div
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: '0.82rem'
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                {payload.map((p) => {
                  const k = p.dataKey
                  return (
                    <div key={k} style={{ color: p.fill, lineHeight: 1.7 }}>
                      {p.name}: <strong>{p.value}r</strong> · {p.payload[`${k}w`]}w ·{' '}
                      {p.payload[`${k}rr`]} rpo
                      <span style={{ color: 'var(--text3)', marginLeft: 4 }}>
                        ({p.payload[`${k}ov`]})
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          }

          const WktsLabel = ({ x, y, width, height, value }) => {
            if (!value || height < 18) return null
            return (
              <text
                x={x + width / 2}
                y={y + Math.min(height - 6, 15)}
                textAnchor="middle"
                fontSize={10}
                fill="rgba(255,255,255,0.85)"
                fontWeight={500}
              >
                {value}w
              </text>
            )
          }

          return (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart
                data={chartData}
                barCategoryGap="28%"
                barGap={3}
                margin={{ top: 12, right: 8, bottom: 0, left: -18 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="phase" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<PhaseTooltip />} cursor={{ fill: 'var(--bg2)', opacity: 0.5 }} />
                {phases.length > 1 && (
                  <Legend
                    formatter={(_, entry) => {
                      const inn = phases.find((i) => `inn${i.innings_order}` === entry.dataKey)
                      return inn ? getPhaseLabel(inn) : entry.value
                    }}
                    wrapperStyle={{ fontSize: '0.78rem', paddingTop: 4 }}
                  />
                )}
                {phases.map((inn) => (
                  <Bar
                    key={inn.innings_order}
                    dataKey={`inn${inn.innings_order}`}
                    name={getPhaseLabel(inn)}
                    fill={getPhaseColor(inn)}
                    radius={[3, 3, 0, 0]}
                  >
                    <LabelList content={<WktsLabel />} dataKey={`inn${inn.innings_order}w`} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          )
        })()}
    </div>
  )
}
