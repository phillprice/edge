import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine
} from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'

// Compute running batting and bowling averages across chronologically sorted matches
function computeSeries(matches) {
  let cumRuns = 0,
    cumBalls = 0,
    cumDismissals = 0
  let cumWkts = 0,
    cumBowlRuns = 0,
    cumBowlBalls = 0
  return matches.map((m, i) => {
    if (m.bat_runs !== null) {
      cumRuns += m.bat_runs
      cumBalls += m.bat_balls ?? 0
      if (m.bat_dismissed) cumDismissals++
    }
    if (m.bowl_wickets !== null) {
      cumWkts += m.bowl_wickets
      cumBowlRuns += m.bowl_runs ?? 0
      cumBowlBalls += m.bowl_legal_balls ?? 0
    }
    return {
      ...m,
      idx: i + 1,
      runningAvg: cumDismissals > 0 ? +(cumRuns / cumDismissals).toFixed(1) : null,
      runningSR: cumBalls > 0 ? +((cumRuns / cumBalls) * 100).toFixed(1) : null,
      runningEcon: cumBowlBalls > 0 ? +((cumBowlRuns / cumBowlBalls) * 6).toFixed(2) : null,
      runningBowlAvg: cumWkts > 0 ? +(cumBowlRuns / cumWkts).toFixed(1) : null
    }
  })
}

function matchLabel(m) {
  if (!m) return ''
  const home = (m.home_team || '').replace(/^WHCC?\s*/i, '').replace(/Woking.*$/i, 'WHCC')
  const away = (m.away_team || '').replace(/^WHCC?\s*/i, '').replace(/Woking.*$/i, 'WHCC')
  return `${home} v ${away}`
}

function CustomTooltip({ active, payload, label, mode, series }) {
  if (!active || !payload?.length) return null
  const m = mode === 'game' ? series[label - 1] : series.find((s) => s.match_date_iso === label)
  if (!m) return null
  return (
    <div
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: '0.78rem',
        maxWidth: 220
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{matchLabel(m)}</div>
      {m.match_date_iso && (
        <div style={{ color: 'var(--text2)', marginBottom: 4 }}>
          {m.match_date_iso.slice(0, 10)}
        </div>
      )}
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: <strong>{p.value ?? '–'}</strong>
        </div>
      ))}
      {m.highlighted && (
        <div style={{ marginTop: 4, color: 'var(--yellow, #f5a623)' }}>
          ★ {m.highlight_note || 'Highlighted'}
        </div>
      )}
    </div>
  )
}

function StarDot(props) {
  const { cx, cy, payload } = props
  if (!payload?.highlighted || cx == null || cy == null) return null
  return (
    <text x={cx} y={cy - 10} textAnchor="middle" fontSize={13} fill="var(--yellow, #f5a623)">
      ★
    </text>
  )
}

function HighlightsList({ playerId, series, onUpdate, canAdmin }) {
  const [open, setOpen] = useState(false)
  const [noteInputs, setNoteInputs] = useState({})
  const [saving, setSaving] = useState({})
  const apiFetch = useApiFetch()

  if (!canAdmin) return null

  async function toggle(m) {
    setSaving((s) => ({ ...s, [m.fixture_id]: true }))
    try {
      if (m.highlighted) {
        await apiFetch(`/api/players/${playerId}/highlights/${m.fixture_id}`, { method: 'DELETE' })
      } else {
        await apiFetch(`/api/players/${playerId}/highlights`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixture_id: m.fixture_id, note: noteInputs[m.fixture_id] || null })
        })
      }
      onUpdate()
    } finally {
      setSaving((s) => ({ ...s, [m.fixture_id]: false }))
    }
  }

  async function updateNote(m) {
    setSaving((s) => ({ ...s, [m.fixture_id]: true }))
    try {
      await apiFetch(`/api/players/${playerId}/highlights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fixture_id: m.fixture_id,
          note: noteInputs[m.fixture_id] ?? m.highlight_note
        })
      })
      onUpdate()
    } finally {
      setSaving((s) => ({ ...s, [m.fixture_id]: false }))
    }
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button
        className="secondary"
        style={{ fontSize: '0.75rem', padding: '2px 10px' }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide' : 'Manage highlights'}
      </button>
      {open && (
        <div
          style={{
            marginTop: '0.5rem',
            border: '1px solid var(--border2)',
            borderRadius: 6,
            overflowX: 'auto'
          }}
        >
          <table style={{ fontSize: '0.78rem', width: '100%' }}>
            <thead>
              <tr>
                {['Date', 'Match', 'Note', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '5px 8px' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((m) => (
                <tr key={m.fixture_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                    {m.match_date_iso?.slice(0, 10) ?? '–'}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{matchLabel(m)}</td>
                  <td style={{ padding: '4px 8px' }}>
                    {m.highlighted ? (
                      <input
                        style={{ fontSize: '0.78rem', width: '100%', minWidth: 120 }}
                        defaultValue={m.highlight_note ?? ''}
                        onBlur={(e) => {
                          setNoteInputs((n) => ({ ...n, [m.fixture_id]: e.target.value }))
                          if (e.target.value !== (m.highlight_note ?? '')) updateNote(m)
                        }}
                        onChange={(e) =>
                          setNoteInputs((n) => ({ ...n, [m.fixture_id]: e.target.value }))
                        }
                      />
                    ) : (
                      <input
                        style={{ fontSize: '0.78rem', width: '100%', minWidth: 120 }}
                        placeholder="Add note…"
                        value={noteInputs[m.fixture_id] ?? ''}
                        onChange={(e) =>
                          setNoteInputs((n) => ({ ...n, [m.fixture_id]: e.target.value }))
                        }
                      />
                    )}
                  </td>
                  <td style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>
                    <button
                      className="secondary"
                      style={{
                        fontSize: '0.72rem',
                        padding: '1px 8px',
                        color: m.highlighted ? 'var(--yellow, #f5a623)' : undefined
                      }}
                      disabled={saving[m.fixture_id]}
                      onClick={() => toggle(m)}
                    >
                      {saving[m.fixture_id] ? '…' : m.highlighted ? '★ Remove' : '☆ Highlight'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function PlayerCharts({ playerId, canAdmin }) {
  const [data, setData] = useState(null)
  const [mode, setMode] = useState('game') // 'game' | 'time'
  const apiFetch = useApiFetch()

  const load = useCallback(() => {
    apiFetch(`/api/players/${playerId}/series`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
  }, [playerId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load()
  }, [load])

  const series = useMemo(() => {
    if (!data?.matches?.length) return []
    return computeSeries(data.matches)
  }, [data])

  const batSeries = useMemo(() => series.filter((m) => m.bat_runs !== null), [series])
  const bowlSeries = useMemo(() => series.filter((m) => m.bowl_wickets !== null), [series])

  const hasBat = batSeries.length >= 2
  const hasBowl = bowlSeries.length >= 2

  if (!hasBat && !hasBowl) return null

  const xKey = mode === 'game' ? 'idx' : 'match_date_iso'
  const xProps =
    mode === 'game'
      ? {
          dataKey: 'idx',
          type: 'number',
          domain: ['dataMin', 'dataMax'],
          tickFormatter: (v) => `#${v}`
        }
      : {
          dataKey: 'match_date_iso',
          type: 'category',
          tickFormatter: (v) => v?.slice(0, 7) ?? ''
        }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}
      >
        <h3 style={{ margin: 0 }}>Performance over time</h3>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={`secondary${mode === 'game' ? ' active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '2px 10px' }}
            onClick={() => setMode('game')}
          >
            Game-by-game
          </button>
          <button
            className={`secondary${mode === 'time' ? ' active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '2px 10px' }}
            onClick={() => setMode('time')}
          >
            Calendar
          </button>
        </div>
      </div>

      {hasBat && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.8rem', color: 'var(--text2)', margin: '0 0 0.4rem' }}>
            Batting — runs (bars) and running average (line)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={batSeries} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis {...xProps} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="runs" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="avg" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip mode={mode} series={batSeries} />} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Bar
                yAxisId="runs"
                dataKey="bat_runs"
                name="Runs"
                fill="var(--hotpink, #e91e8c)"
                opacity={0.75}
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="avg"
                dataKey="runningAvg"
                name="Running avg"
                stroke="var(--blue, #2196f3)"
                dot={<StarDot />}
                activeDot={{ r: 4 }}
                strokeWidth={2}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
          <HighlightsList
            playerId={playerId}
            series={batSeries}
            onUpdate={load}
            canAdmin={canAdmin}
          />
        </div>
      )}

      {hasBowl && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text2)', margin: '0 0 0.4rem' }}>
            Bowling — wickets (bars) and running economy (line)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={bowlSeries} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis {...xProps} tick={{ fontSize: 10 }} />
              <YAxis yAxisId="wkts" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis yAxisId="econ" orientation="right" tick={{ fontSize: 10 }} />
              <Tooltip content={<CustomTooltip mode={mode} series={bowlSeries} />} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Bar
                yAxisId="wkts"
                dataKey="bowl_wickets"
                name="Wickets"
                fill="var(--green, #4caf50)"
                opacity={0.75}
                radius={[2, 2, 0, 0]}
              />
              <Line
                yAxisId="econ"
                dataKey="runningEcon"
                name="Running economy"
                stroke="var(--orange, #ff9800)"
                dot={<StarDot />}
                activeDot={{ r: 4 }}
                strokeWidth={2}
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
          <HighlightsList
            playerId={playerId}
            series={bowlSeries}
            onUpdate={load}
            canAdmin={canAdmin}
          />
        </div>
      )}
    </div>
  )
}
