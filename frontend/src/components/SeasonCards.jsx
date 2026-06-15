import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { dn, shortTeam, formatDateShort } from '../utils/cricket'

// Compact bar-per-match form strip; bar height ∝ WHCC score, colour by result.
export function FormSparkline({ data, colours, labels, onSelect, height = 40 }) {
  const max = Math.max(1, ...data.map((d) => d.score || 0))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }}>
      {data.map((d) => (
        <div
          key={d.fixture_id}
          onClick={() => onSelect(d.fixture_id)}
          title={`${d.label}: ${d.score ?? '–'} · ${labels[d.result] || '–'}`}
          style={{
            width: 7,
            height: `${d.score != null ? Math.max(12, (d.score / max) * 100) : 12}%`,
            background: colours[d.result] || 'var(--accent)',
            opacity: d.score != null ? 1 : 0.35,
            borderRadius: 2,
            cursor: 'pointer'
          }}
        />
      ))}
    </div>
  )
}

// Clickable headline stat for the hero highlight strip.
export function HighlightChip({ label, value, sub, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: '1 1 130px',
        minWidth: 120,
        background: 'var(--bg3)',
        borderRadius: 8,
        padding: '0.5rem 0.7rem',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 1
      }}
    >
      <span
        style={{
          fontSize: '0.66rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text3)'
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>{value}</span>
      {sub && <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{sub}</span>}
    </div>
  )
}

function StatHeadline({ value, label }) {
  return (
    <div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>
        {value ?? '–'}
      </div>
      <div
        style={{
          fontSize: '0.7rem',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text3)'
        }}
      >
        {label}
      </div>
    </div>
  )
}

function PlayerRankRow({ rank, name, detail, first, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        padding: '0.35rem 0',
        borderTop: first ? 'none' : '1px solid var(--border)',
        fontSize: '0.85rem'
      }}
    >
      <span>
        <span style={{ color: 'var(--text3)', marginRight: 8 }}>{rank}</span>
        {name}
      </span>
      <span style={{ color: 'var(--text2)' }}>{detail}</span>
    </div>
  )
}

// One discipline (Batting/Bowling): three headline numbers + a ranked player list.
function DisciplineCard({ title, stats, players, playerLabel, onPlayer }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3 style={{ marginBottom: '0.75rem' }}>{title}</h3>
      <div
        style={{
          display: 'flex',
          gap: '1.5rem',
          flexWrap: 'wrap',
          marginBottom: players.length ? '1rem' : 0
        }}
      >
        {stats.map((s) => (
          <StatHeadline key={s.label} value={s.value} label={s.label} />
        ))}
      </div>
      {players.map((p, i) => (
        <PlayerRankRow
          key={p.player_id}
          rank={i + 1}
          first={i === 0}
          name={dn(p.name)}
          detail={playerLabel(p)}
          onClick={() => onPlayer(p.player_id)}
        />
      ))}
    </div>
  )
}

function bowlingFigure(bb) {
  const overs = bb.balls != null ? `${Math.floor(bb.balls / 6)}.${bb.balls % 6}` : null
  return `${dn(bb.name)}${overs ? ` · ${overs} ov` : ''}`
}

function notOutMark(b) {
  return b.not_out ? '*' : ''
}

// The Highest score / Best bowling / Best MVP chip row.
function HighlightStrip({ highlights, navigate }) {
  const hl = highlights || {}
  const toPlayer = (id) => () => navigate(`/player/${id}`)
  const chips = []
  if (hl.high_score)
    chips.push(
      <HighlightChip
        key="hs"
        label="Highest score"
        value={`${hl.high_score.score}${notOutMark(hl.high_score)}`}
        sub={dn(hl.high_score.name)}
        onClick={toPlayer(hl.high_score.player_id)}
      />
    )
  if (hl.best_bowling)
    chips.push(
      <HighlightChip
        key="bb"
        label="Best bowling"
        value={`${hl.best_bowling.wickets}/${hl.best_bowling.runs}`}
        sub={bowlingFigure(hl.best_bowling)}
        onClick={toPlayer(hl.best_bowling.player_id)}
      />
    )
  if (hl.best_mvp)
    chips.push(
      <HighlightChip
        key="mvp"
        label="Best MVP"
        value={`${hl.best_mvp.pts} pts`}
        sub={dn(hl.best_mvp.name)}
        onClick={hl.best_mvp.player_id ? toPlayer(hl.best_mvp.player_id) : undefined}
      />
    )
  if (!chips.length) return null
  return (
    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
      {chips}
    </div>
  )
}

// Hero: W/L/T record + win rate, a recent-form strip, and the highlight chips.
export function SeasonHero({ record, winPct, chartData, highlights, colours, labels, navigate }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1.5rem',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <div style={{ fontSize: '1.7rem', fontWeight: 700 }}>
            <span style={{ color: colours.won }}>{record.won}W</span>{' '}
            <span style={{ color: colours.lost }}>{record.lost}L</span>
            {record.tied > 0 && (
              <>
                {' '}
                <span style={{ color: colours.tied }}>{record.tied}T</span>
              </>
            )}
            {record.nrd > 0 && (
              <>
                {' '}
                <span style={{ color: 'var(--text3)' }}>{record.nrd}NR</span>
              </>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 2 }}>
            {record.played} played{winPct ? ` · ${winPct} win rate` : ''}
          </div>
        </div>
        {chartData.length > 0 && (
          <div style={{ textAlign: 'right' }}>
            <FormSparkline
              data={chartData}
              colours={colours}
              labels={labels}
              onSelect={(fid) => navigate(`/match/${fid}`)}
            />
            <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginTop: 5 }}>
              recent form
            </div>
          </div>
        )}
      </div>
      <HighlightStrip highlights={highlights} navigate={navigate} />
    </div>
  )
}

// Side-by-side Batting and Bowling cards.
export function DisciplineGrid({ data, navigate }) {
  const onPlayer = (id) => navigate(`/player/${id}`)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '1rem'
      }}
    >
      <DisciplineCard
        title="Batting"
        stats={[
          { label: 'Runs', value: data.batting.total_runs },
          { label: 'Average', value: data.batting.bat_avg },
          { label: 'Run rate', value: data.batting.run_rate }
        ]}
        players={data.top_batters || []}
        playerLabel={(p) => `${p.runs} runs${p.average ? ` · ${p.average}` : ''}`}
        onPlayer={onPlayer}
      />
      <DisciplineCard
        title="Bowling"
        stats={[
          { label: 'Wickets', value: data.bowling.total_wickets },
          { label: 'Average', value: data.bowling.bowl_avg },
          { label: 'Economy', value: data.bowling.economy }
        ]}
        players={data.top_bowlers || []}
        playerLabel={(p) => `${p.wickets} wkts${p.economy ? ` · ${p.economy}` : ''}`}
        onPlayer={onPlayer}
      />
    </div>
  )
}

// Tooltip body for the form bar chart.
function FormTooltip({ active, payload, colours, labels }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: '0.85rem',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{d.label}</div>
      <div style={{ color: 'var(--text2)' }}>
        {d.score != null ? (
          <>
            <strong style={{ color: 'var(--text)' }}>{d.score}</strong> runs ·{' '}
          </>
        ) : (
          '– · '
        )}
        <strong style={{ color: colours[d.result] }}>{labels[d.result] || '–'}</strong>
      </div>
    </div>
  )
}

// Charts tab: bar-per-match form chart.
export function SeasonForm({ chartData, colours, labels }) {
  if (!chartData.length)
    return <div className="empty">No match score data available for charts.</div>
  return (
    <>
      <h2 style={{ marginBottom: '1rem' }}>Form</h2>
      <div
        style={{
          marginBottom: '2rem',
          background: 'var(--bg3)',
          borderRadius: 10,
          padding: '1rem 0.5rem 0.75rem',
          overflowX: 'auto'
        }}
      >
        <div style={{ minWidth: Math.max(400, chartData.length * 44) }}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 8, bottom: 4, left: 8 }}
              barCategoryGap="25%"
            >
              <XAxis
                dataKey="label"
                tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }}
                interval={0}
              />
              <YAxis tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }} />
              <Tooltip
                cursor={{ fill: 'rgba(128,128,128,0.12)' }}
                content={(props) => <FormTooltip {...props} colours={colours} labels={labels} />}
              />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.fixture_id} fill={colours[entry.result] || 'var(--accent)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  )
}

function HistoryRow({ m, colours, labels }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border2)' }}>
      <td style={{ padding: '5px 8px 5px 0', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(m.date) || m.date}
      </td>
      <td style={{ padding: '5px 8px 5px 0' }}>
        <Link
          to={`/match/${m.fixture_id}`}
          style={{ color: 'var(--accent)', textDecoration: 'none' }}
        >
          {shortTeam(m.opp_team) || 'Unknown'}
        </Link>
      </td>
      <td
        style={{ padding: '5px 8px 5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
      >
        {m.whcc_score ?? '–'}
        {m.whcc_wickets != null ? `/${m.whcc_wickets}` : ''}
      </td>
      <td
        style={{ padding: '5px 0', textAlign: 'center', fontWeight: 700, color: colours[m.result] }}
      >
        {labels[m.result] || '–'}
      </td>
    </tr>
  )
}

// Match History tab: results table, newest first.
export function SeasonHistory({ results, colours, labels }) {
  if (!results.length) return <div className="empty">No match history available.</div>
  return (
    <>
      <h2 style={{ marginBottom: '1rem' }}>Match history</h2>
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 400 }}
        >
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text2)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 6px 0', fontWeight: 500 }}>Date</th>
              <th style={{ textAlign: 'left', padding: '4px 8px 6px 0', fontWeight: 500 }}>
                Opponent
              </th>
              <th style={{ textAlign: 'right', padding: '4px 8px 6px 0', fontWeight: 500 }}>
                Score
              </th>
              <th style={{ textAlign: 'center', padding: '4px 0 6px 0', fontWeight: 500 }}>
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {results.map((m) => (
              <HistoryRow key={m.fixture_id} m={m} colours={colours} labels={labels} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
