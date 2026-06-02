import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, shortTeam, formatDate } from '../utils/cricket'
import { useGroups } from '../GroupContext'

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
    <div className="stat-box" style={{ minWidth: 100, flex: 1 }}>
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
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  // Group filter: key is "team_id:season_id", or '' for super-admin "all"
  const groupKey  = searchParams.get('group') || ''
  const year      = searchParams.get('year')  || ''
  const comp      = searchParams.get('comp')  || ''

  // For regular users, auto-select the first group when none is in the URL.
  // For super admins, default to '' (no group restriction).
  const effectiveGroupKey = !isSuperAdmin && myGroups.length > 0 && !groupKey
    ? `${myGroups[0].team_id}:${myGroups[0].season_id}`
    : groupKey

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

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
    if (effectiveGroupKey) {
      const [tid, sid] = effectiveGroupKey.split(':')
      params.set('team_id',   tid)
      params.set('season_id', sid)
    } else if (isSuperAdmin) {
      // Super admin: use year+team filters instead of group
      if (year) params.set('year', year)
    }
    if (comp) params.set('comp', comp)
    apiFetch(`/api/matches/season?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGroupKey, year, comp])

  const RESULT_COLOUR = dark ? COLOURS_DARK : COLOURS_LIGHT

  const yearOptions = [{ value: '', label: 'All' }, ...(data?.years || []).map(y => ({ value: y, label: y }))]

  const record = data?.record
  const winPct = record && record.played > 0
    ? ((record.won / record.played) * 100).toFixed(0) + '%'
    : null

  const matchScores = data?.match_scores || []
  const chartData = matchScores.map(m => ({
    label: formatDate(m.date)?.replace(/^[A-Za-z]+ /, '') || m.date,
    score: m.whcc_score != null ? Number(m.whcc_score) : null,
    result: m.result,
    fixture_id: m.fixture_id,
  }))

  const resultsDesc = [...matchScores].reverse()

  return (
    <div className="page">
      <h1>Season summary</h1>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Group selector for regular users with multiple teams/seasons */}
        {!isSuperAdmin && myGroups.length > 1 && (
          <FilterPills
            label="Team"
            options={myGroups.map(g => ({ value: `${g.team_id}:${g.season_id}`, label: g.display }))}
            value={effectiveGroupKey}
            onChange={v => updateFilter('group', v, '')}
          />
        )}
        {/* Year filter for super admins only */}
        {isSuperAdmin && (
          <FilterPills label="Year" options={yearOptions} value={year} onChange={v => updateFilter('year', v, '')} />
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
          <h2 style={{ marginBottom: '0.5rem' }}>Match record</h2>
          <div className="stat-row" style={{ marginBottom: '2rem' }}>
            <StatCard label="Played"  value={record.played} />
            <StatCard label="Won"     value={record.won}  sub={winPct} />
            <StatCard label="Lost"    value={record.lost} />
            {record.tied > 0  && <StatCard label="Tied"    value={record.tied} />}
            {record.nrd > 0   && <StatCard label="No result" value={record.nrd} />}
          </div>

          <h2 style={{ marginBottom: '0.5rem' }}>Batting</h2>
          <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
            <StatCard label="Total runs"  value={data.batting.total_runs} />
            <StatCard label="Bat avg"     value={data.batting.bat_avg} />
            <StatCard label="Run rate"    value={data.batting.run_rate} />
          </div>
          {data.top_batters?.length > 0 && (
            <div className="stat-row" style={{ marginBottom: '2rem' }}>
              {data.top_batters.map((b, i) => (
                <div key={b.player_id} className="stat-box" style={{ minWidth: 100, flex: 1, cursor: 'pointer' }}
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

          <h2 style={{ marginBottom: '0.5rem' }}>Bowling</h2>
          <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
            <StatCard label="Wickets"    value={data.bowling.total_wickets} />
            <StatCard label="Bowl avg"   value={data.bowling.bowl_avg} />
            <StatCard label="Economy"    value={data.bowling.economy} />
          </div>
          {data.top_bowlers?.length > 0 && (
            <div className="stat-row" style={{ marginBottom: '2rem' }}>
              {data.top_bowlers.map((b, i) => (
                <div key={b.player_id} className="stat-box" style={{ minWidth: 100, flex: 1, cursor: 'pointer' }}
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

          {chartData.length > 0 && (
            <>
              <h2 style={{ marginBottom: '0.5rem' }}>Form</h2>
              <div style={{ marginBottom: '2rem' }}>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="20%">
                    <XAxis dataKey="label" tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: '0.7rem', fill: 'var(--text2)' }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '6px 10px', fontSize: '0.82rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.label}</div>
                            <div>{d.score ?? '–'} runs · <span style={{ color: RESULT_COLOUR[d.result] }}>{RESULT_LABEL[d.result] || '–'}</span></div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="score" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry) => (
                        <Cell key={entry.fixture_id} fill={RESULT_COLOUR[entry.result] || 'var(--accent)'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {resultsDesc.length > 0 && (
            <>
              <h2 style={{ marginBottom: '0.5rem' }}>Results</h2>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginBottom: '2rem' }}>
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
                        {formatDate(m.date)?.replace(/^[A-Za-z]+ /, '') || m.date}
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
            </>
          )}
        </>
      )}
    </div>
  )
}
