import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, shortTeam, formatDateShort } from '../utils/cricket'
import { useGroups } from '../GroupContext'
import TeamSeasonFilter from '../components/TeamSeasonFilter'

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Compact bar-per-match form strip; bar height ∝ WHCC score, colour by result.
function FormSparkline({ data, colours, labels, onSelect }) {
  const max = Math.max(1, ...data.map(d => d.score || 0))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
      {data.map(d => (
        <div key={d.fixture_id}
          onClick={() => onSelect(d.fixture_id)}
          title={`${d.label}: ${d.score ?? '–'} · ${labels[d.result] || '–'}`}
          style={{
            width: 7,
            height: `${d.score != null ? Math.max(12, (d.score / max) * 100) : 12}%`,
            background: colours[d.result] || 'var(--accent)',
            opacity: d.score != null ? 1 : 0.35,
            borderRadius: 2, cursor: 'pointer',
          }} />
      ))}
    </div>
  )
}

// Clickable headline stat for the hero highlight strip.
function HighlightChip({ label, value, sub, onClick }) {
  return (
    <div onClick={onClick}
      style={{
        flex: '1 1 130px', minWidth: 120,
        background: 'var(--bg3)', borderRadius: 8, padding: '0.5rem 0.7rem',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
      <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text3)' }}>{label}</span>
      <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>{value}</span>
      {sub && <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{sub}</span>}
    </div>
  )
}

// One discipline (Batting/Bowling): three headline numbers + a ranked player list.
function DisciplineCard({ title, stats, players, playerLabel, onPlayer }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <h3 style={{ marginBottom: '0.75rem' }}>{title}</h3>
      <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: players.length ? '1rem' : 0 }}>
        {stats.map(s => (
          <div key={s.label}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.1 }}>{s.value ?? '–'}</div>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text3)' }}>{s.label}</div>
          </div>
        ))}
      </div>
      {players.length > 0 && players.map((p, i) => (
        <div key={p.player_id} onClick={() => onPlayer(p.player_id)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
            padding: '0.35rem 0', borderTop: i ? '1px solid var(--border)' : 'none', fontSize: '0.85rem' }}>
          <span><span style={{ color: 'var(--text3)', marginRight: 8 }}>{i + 1}</span>{dn(p.name)}</span>
          <span style={{ color: 'var(--text2)' }}>{playerLabel(p)}</span>
        </div>
      ))}
    </div>
  )
}

const COLOURS_LIGHT = { won: '#2e7d32', lost: '#c62828', tied: '#757575', nr: '#757575' }
const COLOURS_DARK  = { won: '#66bb6a', lost: '#ef5350', tied: '#9e9e9e', nr: '#9e9e9e' }
const RESULT_LABEL  = { won: 'W', lost: 'L', tied: 'T', nr: 'NR' }

function getIsDark() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark') return true
  if (attr === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function Season() {
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const { myGroups } = useGroups()

  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [dark, setDark]       = useState(getIsDark)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('summary')
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  const comp = searchParams.get('comp') || ''

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  // Two-level Team → Season(s) selection (see MatchList). Scoped users default to their first
  // team (all seasons); super admins default to "All".
  const defaultGroups = (!isSuperAdmin && myGroups.length)
    ? myGroups.map(g => ({ team_id: g.team_id, season_id: g.season_id }))
    : []
  const groupsParam = searchParams.get('groups')
  const selectedGroups = groupsParam != null
    ? groupsParam.split(',').filter(Boolean).map(tok => { const [t, s] = tok.split(':').map(Number); return { team_id: t, season_id: s } })
    : defaultGroups
  const selectedKey = selectedGroups.map(g => `${g.team_id}:${g.season_id}`).join(',')
  const setGroups = pairs => updateFilter('groups', pairs.map(g => `${g.team_id}:${g.season_id}`).join(','), '')

  useEffect(() => {
    const update = () => setDark(getIsDark())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => { observer.disconnect(); mq.removeEventListener('change', update) }
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedKey) params.set('groups', selectedKey)
    if (comp) params.set('comp', comp)
    apiFetch(`/api/matches/season?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, comp])

  const RESULT_COLOUR = dark ? COLOURS_DARK : COLOURS_LIGHT

  const record = data?.record
  const winPct = record && record.played > 0
    ? ((record.won / record.played) * 100).toFixed(0) + '%'
    : null

  const matchScores = data?.match_scores || []
  const chartData = matchScores.map(m => ({
    label: formatDateShort(m.date) || m.date,
    score: m.whcc_score != null ? Number(m.whcc_score) : null,
    result: m.result,
    fixture_id: m.fixture_id,
  }))

  const resultsDesc = [...matchScores].reverse()

  return (
    <div className="page">
      <h1>Season summary</h1>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {myGroups.length > 1 && (
          <TeamSeasonFilter myGroups={myGroups} value={selectedGroups} onChange={setGroups} />
        )}
        <FilterPills
          label="Type"
          options={[
            { value: '', label: 'All' },
            { value: 'league', label: 'League' },
            { value: 'cup', label: 'Cup' },
            { value: 'friendly', label: 'Friendly' },
          ]}
          value={comp}
          onChange={v => updateFilter('comp', v, '')}
        />
      </div>

      {loading ? (
        <div className="loading">Loading season summary…</div>
      ) : !data ? (
        <div className="empty">No data available.</div>
      ) : (
        <>
          <div className="tabs">
            {[
              { key: 'summary', label: 'Summary' },
              { key: 'charts',  label: 'Charts' },
              { key: 'history', label: 'Match History' },
            ].map(({ key, label }) => (
              <button
                key={key}
                className={activeTab === key ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'summary' && (
            <>
              {/* Hero: record + recent-form strip + highlight chips */}
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '1.7rem', fontWeight: 700 }}>
                      <span style={{ color: RESULT_COLOUR.won }}>{record.won}W</span>{' '}
                      <span style={{ color: RESULT_COLOUR.lost }}>{record.lost}L</span>
                      {record.tied > 0 && <>{' '}<span style={{ color: RESULT_COLOUR.tied }}>{record.tied}T</span></>}
                      {record.nrd > 0 && <>{' '}<span style={{ color: 'var(--text3)' }}>{record.nrd}NR</span></>}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginTop: 2 }}>
                      {record.played} played{winPct ? ` · ${winPct} win rate` : ''}
                    </div>
                  </div>
                  {chartData.length > 0 && (
                    <div style={{ textAlign: 'right' }}>
                      <FormSparkline data={chartData} colours={RESULT_COLOUR} labels={RESULT_LABEL}
                        onSelect={fid => navigate(`/match/${fid}`)} />
                      <div style={{ fontSize: '0.66rem', color: 'var(--text3)', marginTop: 5 }}>recent form</div>
                    </div>
                  )}
                </div>

                {(data.highlights?.high_score || data.highlights?.best_bowling || data.highlights?.best_mvp) && (
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                    {data.highlights.high_score && (
                      <HighlightChip label="Highest score"
                        value={`${data.highlights.high_score.score}${data.highlights.high_score.not_out ? '*' : ''}`}
                        sub={dn(data.highlights.high_score.name)}
                        onClick={() => navigate(`/player/${data.highlights.high_score.player_id}`)} />
                    )}
                    {data.highlights.best_bowling && (() => {
                      const bb = data.highlights.best_bowling
                      const overs = bb.balls != null ? `${Math.floor(bb.balls / 6)}.${bb.balls % 6}` : null
                      return <HighlightChip label="Best bowling" value={`${bb.wickets}/${bb.runs}`}
                        sub={`${dn(bb.name)}${overs ? ` · ${overs} ov` : ''}`}
                        onClick={() => navigate(`/player/${bb.player_id}`)} />
                    })()}
                    {data.highlights.best_mvp && (
                      <HighlightChip label="Best MVP" value={`${data.highlights.best_mvp.pts} pts`}
                        sub={dn(data.highlights.best_mvp.name)}
                        onClick={data.highlights.best_mvp.player_id ? () => navigate(`/player/${data.highlights.best_mvp.player_id}`) : undefined} />
                    )}
                  </div>
                )}
              </div>

              {/* Discipline grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <DisciplineCard title="Batting"
                  stats={[
                    { label: 'Runs', value: data.batting.total_runs },
                    { label: 'Average', value: data.batting.bat_avg },
                    { label: 'Run rate', value: data.batting.run_rate },
                  ]}
                  players={data.top_batters || []}
                  playerLabel={p => `${p.runs} runs${p.average ? ` · ${p.average}` : ''}`}
                  onPlayer={id => navigate(`/player/${id}`)} />
                <DisciplineCard title="Bowling"
                  stats={[
                    { label: 'Wickets', value: data.bowling.total_wickets },
                    { label: 'Average', value: data.bowling.bowl_avg },
                    { label: 'Economy', value: data.bowling.economy },
                  ]}
                  players={data.top_bowlers || []}
                  playerLabel={p => `${p.wickets} wkts${p.economy ? ` · ${p.economy}` : ''}`}
                  onPlayer={id => navigate(`/player/${id}`)} />
              </div>
            </>
          )}

          {activeTab === 'charts' && chartData.length === 0 && (
            <div className="empty">No match score data available for charts.</div>
          )}

          {activeTab === 'charts' && chartData.length > 0 && (
            <>
              <h2 style={{ marginBottom: '1rem' }}>Form</h2>
              <div style={{ marginBottom: '2rem', background: 'var(--bg3)', borderRadius: 10, padding: '1rem 0.5rem 0.75rem' }}>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -16 }} barCategoryGap="25%">
                    <XAxis dataKey="label" tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }} />
                    <Tooltip
                      cursor={{ fill: 'rgba(128,128,128,0.12)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '8px 12px', fontSize: '0.85rem', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{d.label}</div>
                            <div style={{ color: 'var(--text2)' }}>
                              {d.score != null ? <><strong style={{ color: 'var(--text)' }}>{d.score}</strong> runs · </> : '– · '}
                              <strong style={{ color: RESULT_COLOUR[d.result] }}>{RESULT_LABEL[d.result] || '–'}</strong>
                            </div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry) => (
                        <Cell key={entry.fixture_id} fill={RESULT_COLOUR[entry.result] || 'var(--accent)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {activeTab === 'history' && resultsDesc.length === 0 && (
            <div className="empty">No match history available.</div>
          )}

          {activeTab === 'history' && resultsDesc.length > 0 && (
            <>
              <h2 style={{ marginBottom: '1rem' }}>Match history</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: 400 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border2)', color: 'var(--text2)' }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px 6px 0', fontWeight: 500 }}>Date</th>
                      <th style={{ textAlign: 'left', padding: '4px 8px 6px 0', fontWeight: 500 }}>Opponent</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px 6px 0', fontWeight: 500 }}>Score</th>
                      <th style={{ textAlign: 'center', padding: '4px 0 6px 0', fontWeight: 500 }}>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultsDesc.map(m => (
                      <tr key={m.fixture_id} style={{ borderBottom: '1px solid var(--border2)' }}>
                        <td style={{ padding: '5px 8px 5px 0', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          {formatDateShort(m.date) || m.date}
                        </td>
                        <td style={{ padding: '5px 8px 5px 0' }}>
                          <Link to={`/match/${m.fixture_id}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                            {shortTeam(m.opp_team) || 'Unknown'}
                          </Link>
                        </td>
                        <td style={{ padding: '5px 8px 5px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {m.whcc_score ?? '–'}
                          {m.whcc_wickets != null ? `/${m.whcc_wickets}` : ''}
                        </td>
                        <td style={{ padding: '5px 0 5px 0', textAlign: 'center', fontWeight: 700, color: RESULT_COLOUR[m.result] }}>
                          {RESULT_LABEL[m.result] || '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
