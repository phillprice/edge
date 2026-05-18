import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn } from '../utils/cricket'

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
    <div className="stat-box" style={{ minWidth: 110 }}>
      <div className="label">{label}</div>
      <div className="value">{value ?? '–'}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

export default function Season() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  const year = searchParams.get('year') || ''
  const team = searchParams.get('team') || ''
  const comp = searchParams.get('comp') || ''

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (team) params.set('team', team)
    if (comp) params.set('comp', comp)
    apiFetch(`/api/matches/season?${params}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, team, comp])

  const yearOptions = [{ value: '', label: 'All' }, ...(data?.years || []).map(y => ({ value: y, label: y }))]

  const record = data?.record
  const winPct = record && record.played > 0
    ? ((record.won / record.played) * 100).toFixed(0) + '%'
    : null

  return (
    <div className="page">
      <h1>Season summary</h1>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <FilterPills label="Year" options={yearOptions} value={year} onChange={v => updateFilter('year', v, '')} />
        <FilterPills
          label="Team"
          options={[
            { value: '', label: 'All' },
            { value: 'whirlwind', label: 'Whirlwinds' },
            { value: 'hurricane', label: 'Hurricanes' },
          ]}
          value={team}
          onChange={v => updateFilter('team', v, '')}
        />
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
        <div className="empty">
          {year || team || comp
            ? `No data${team ? ` for ${team === 'whirlwind' ? 'Whirlwinds' : 'Hurricanes'}` : ''}${year ? ` in ${year}` : ''}${comp ? ` in ${comp}` : ''} — try removing the filter.`
            : 'No data available.'}
        </div>
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
          <div className="stat-row" style={{ marginBottom: '2rem' }}>
            <StatCard label="Total runs"  value={data.batting.total_runs} />
            <StatCard label="Bat avg"     value={data.batting.bat_avg} />
            <StatCard label="Run rate"    value={data.batting.run_rate} />
            {data.top_scorer && (
              <div className="stat-box" style={{ minWidth: 140, cursor: 'pointer' }}
                onClick={() => navigate(`/player/${data.top_scorer.player_id}`)}>
                <div className="label">Top scorer</div>
                <div className="value" style={{ fontSize: '1rem' }}>{dn(data.top_scorer.name)}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>{data.top_scorer.runs} runs</div>
              </div>
            )}
          </div>

          <h2 style={{ marginBottom: '0.5rem' }}>Bowling</h2>
          <div className="stat-row" style={{ marginBottom: '2rem' }}>
            <StatCard label="Wickets"    value={data.bowling.total_wickets} />
            <StatCard label="Bowl avg"   value={data.bowling.bowl_avg} />
            <StatCard label="Economy"    value={data.bowling.economy} />
            {data.top_wickets && (
              <div className="stat-box" style={{ minWidth: 140, cursor: 'pointer' }}
                onClick={() => navigate(`/player/${data.top_wickets.player_id}`)}>
                <div className="label">Top wickets</div>
                <div className="value" style={{ fontSize: '1rem' }}>{dn(data.top_wickets.name)}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>{data.top_wickets.wickets} wickets</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
