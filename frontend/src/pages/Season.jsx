import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { formatDateShort } from '../utils/cricket'
import { useGroups } from '../GroupContext'
import TeamSeasonFilter from '../components/TeamSeasonFilter'
import FilterPills from '../components/FilterPills'
import { SeasonHero, DisciplineGrid, SeasonForm, SeasonHistory } from '../components/SeasonCards'

const COLOURS_LIGHT = { won: '#2e7d32', lost: '#c62828', tied: '#757575', nr: '#757575' }
const COLOURS_DARK = { won: '#66bb6a', lost: '#ef5350', tied: '#9e9e9e', nr: '#9e9e9e' }
const RESULT_LABEL = { won: 'W', lost: 'L', tied: 'T', nr: 'NR' }

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

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dark, setDark] = useState(getIsDark)
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('summary')
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  const comp = searchParams.get('comp') || ''
  const format = searchParams.get('format') || ''

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  // Two-level Team → Season(s) selection (see MatchList). Scoped users default to their first
  // team (all seasons); super admins default to "All".
  const defaultGroups =
    !isSuperAdmin && myGroups.length
      ? myGroups.map((g) => ({ team_id: g.team_id, season_id: g.season_id }))
      : []
  const groupsParam = searchParams.get('groups')
  const selectedGroups =
    groupsParam != null
      ? groupsParam
          .split(',')
          .filter(Boolean)
          .map((tok) => {
            const [t, s] = tok.split(':').map(Number)
            return { team_id: t, season_id: s }
          })
      : defaultGroups
  const selectedKey = selectedGroups.map((g) => `${g.team_id}:${g.season_id}`).join(',')
  const setGroups = (pairs) =>
    updateFilter('groups', pairs.map((g) => `${g.team_id}:${g.season_id}`).join(','), '')

  useEffect(() => {
    const update = () => setDark(getIsDark())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedKey) params.set('groups', selectedKey)
    if (comp) params.set('comp', comp)
    if (format) params.set('format', format)
    apiFetch(`/api/matches/season?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, comp, format])

  const RESULT_COLOUR = dark ? COLOURS_DARK : COLOURS_LIGHT

  const record = data?.record
  const winPct =
    record && record.played > 0 ? ((record.won / record.played) * 100).toFixed(0) + '%' : null

  const matchScores = data?.match_scores || []
  const chartData = matchScores.map((m) => ({
    label: formatDateShort(m.date) || m.date,
    score: m.whcc_score != null ? Number(m.whcc_score) : null,
    result: m.result,
    fixture_id: m.fixture_id
  }))

  const resultsDesc = [...matchScores].reverse()

  return (
    <div className="page">
      <h1>Season summary</h1>

      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          alignItems: 'flex-start'
        }}
      >
        {myGroups.length > 1 && (
          <TeamSeasonFilter myGroups={myGroups} value={selectedGroups} onChange={setGroups} />
        )}
        <FilterPills
          label="Type"
          options={[
            { value: '', label: 'All' },
            { value: 'league', label: 'League' },
            { value: 'cup', label: 'Cup' },
            { value: 'friendly', label: 'Friendly' }
          ]}
          value={comp}
          onChange={(v) => updateFilter('comp', v, '')}
        />
        <FilterPills
          label="Format"
          options={[
            { value: '', label: 'All' },
            { value: 'no-pairs', label: 'Hide pairs' },
            { value: 'pairs', label: 'Pairs only' }
          ]}
          value={format}
          onChange={(v) => updateFilter('format', v, '')}
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
              { key: 'charts', label: 'Charts' },
              { key: 'history', label: 'Match History' }
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
              <SeasonHero
                record={record}
                winPct={winPct}
                chartData={chartData}
                highlights={data.highlights}
                colours={RESULT_COLOUR}
                labels={RESULT_LABEL}
                navigate={navigate}
              />
              <DisciplineGrid data={data} navigate={navigate} />
            </>
          )}

          {activeTab === 'charts' && (
            <SeasonForm chartData={chartData} colours={RESULT_COLOUR} labels={RESULT_LABEL} />
          )}

          {activeTab === 'history' && (
            <SeasonHistory results={resultsDesc} colours={RESULT_COLOUR} labels={RESULT_LABEL} />
          )}
        </>
      )}
    </div>
  )
}
