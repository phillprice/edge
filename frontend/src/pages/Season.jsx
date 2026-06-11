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

function StatCard({ label, value, sub }) {
  return (
    <div className="stat-box" style={{ minWidth: 110, maxWidth: 160, flex: '1 1 110px' }}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '–'}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
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
              <h2 style={{ marginBottom: '1rem' }}>Match record</h2>
              <div className="stat-row" style={{ marginBottom: '2rem' }}>
                <StatCard label="Played"  value={record.played} />
                <StatCard label="Won"     value={record.won}  sub={winPct} />
                <StatCard label="Lost"    value={record.lost} />
                {record.tied > 0  && <StatCard label="Tied"    value={record.tied} />}
                {record.nrd > 0   && <StatCard label="No result" value={record.nrd} />}
              </div>

              {(data.highlights?.high_score || data.highlights?.best_bowling) && (
                <>
                  <h2 style={{ marginBottom: '1rem' }}>Highlights</h2>
                  <div className="stat-row" style={{ marginBottom: '2rem' }}>
                    {data.highlights.high_score && (
                      <div className="stat-box" style={{ minWidth: 110, maxWidth: 200, flex: '1 1 110px', cursor: 'pointer' }}
                        onClick={() => navigate(`/player/${data.highlights.high_score.player_id}`)}>
                        <div className="label">Highest score</div>
                        <div className="value" style={{ fontSize: '1.2rem' }}>
                          {data.highlights.high_score.score}{data.highlights.high_score.not_out ? '*' : ''}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>
                          {dn(data.highlights.high_score.name)}
                        </div>
                      </div>
                    )}
                    {data.highlights.best_bowling && (() => {
                      const bb = data.highlights.best_bowling
                      const overs = bb.balls != null ? `${Math.floor(bb.balls / 6)}.${bb.balls % 6}` : null
                      return (
                        <div className="stat-box" style={{ minWidth: 110, maxWidth: 200, flex: '1 1 110px', cursor: 'pointer' }}
                          onClick={() => navigate(`/player/${bb.player_id}`)}>
                          <div className="label">Best bowling</div>
                          <div className="value" style={{ fontSize: '1.2rem' }}>{bb.wickets}/{bb.runs}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>
                            {dn(bb.name)}{overs ? ` · ${overs} ov` : ''}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </>
              )}

              <h2 style={{ marginBottom: '1rem' }}>Batting</h2>
              <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
                <StatCard label="Total runs"  value={data.batting.total_runs} />
                <StatCard label="Bat avg"     value={data.batting.bat_avg} />
                <StatCard label="Run rate"    value={data.batting.run_rate} />
              </div>
              {data.top_batters?.length > 0 && (
                <div className="stat-row" style={{ marginBottom: '2rem' }}>
                  {data.top_batters.map((b, i) => (
                    <div key={b.player_id} className="stat-box" style={{ minWidth: 110, maxWidth: 200, flex: '1 1 110px', cursor: 'pointer' }}
                      onClick={() => navigate(`/player/${b.player_id}`)}>
                      <div className="label">{i === 0 ? 'Top scorer' : `#${i + 1} batter`}</div>
                      <div className="value" style={{ fontSize: '1rem' }}>{dn(b.name)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>
                        {b.runs} runs{b.average ? ` · avg ${b.average}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h2 style={{ marginBottom: '1rem' }}>Bowling</h2>
              <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
                <StatCard label="Wickets"    value={data.bowling.total_wickets} />
                <StatCard label="Bowl avg"   value={data.bowling.bowl_avg} />
                <StatCard label="Economy"    value={data.bowling.economy} />
              </div>
              {data.top_bowlers?.length > 0 && (
                <div className="stat-row" style={{ marginBottom: '2rem' }}>
                  {data.top_bowlers.map((b, i) => (
                    <div key={b.player_id} className="stat-box" style={{ minWidth: 110, maxWidth: 200, flex: '1 1 110px', cursor: 'pointer' }}
                      onClick={() => navigate(`/player/${b.player_id}`)}>
                      <div className="label">{i === 0 ? 'Top wickets' : `#${i + 1} bowler`}</div>
                      <div className="value" style={{ fontSize: '1rem' }}>{dn(b.name)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>
                        {b.wickets} wkts{b.economy ? ` · econ ${b.economy}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
