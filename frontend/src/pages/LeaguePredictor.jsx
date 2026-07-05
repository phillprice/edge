import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import { Skeleton } from '../components/Skeleton'
import { useApiFetch } from '../hooks/useApiFetch'
import { isOurTeam } from '../utils/cricket'
import LeagueHeaderCard from '../components/league/LeagueHeaderCard'
import StandingsTable from '../components/league/StandingsTable'
import PositionDistributionChart from '../components/league/PositionDistributionChart'

// Reads the prediction response, returning either { data } or { error } — a single
// awaited request with no branching promise chain.
async function readPredictionResponse(res) {
  if (res.status === 404) {
    return { error: 'This fixture is not a league fixture with a resolvable division.' }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { error: body.error || `Request failed (${res.status})` }
  }
  return { data: await res.json() }
}

function useLeaguePrediction(fixtureId) {
  const apiFetch = useApiFetch()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`/api/leagues/${fixtureId}/prediction`)
        const result = await readPredictionResponse(res)
        if (cancelled) return
        if (result.error) setError(result.error)
        else setData(result.data)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fixtureId, apiFetch])

  return { data, error, loading }
}

function breadcrumbItems(fixtureId) {
  return [{ label: 'Match', href: `/match/${fixtureId}` }, { label: 'League Predictor' }]
}

export default function LeaguePredictor() {
  const { fixtureId } = useParams()
  const { data, error, loading } = useLeaguePrediction(fixtureId)

  if (loading) {
    return (
      <div className="page">
        <Breadcrumbs items={breadcrumbItems(fixtureId)} />
        <div className="card">
          <Skeleton width="60%" height="1.5rem" style={{ marginBottom: '1rem' }} />
          <Skeleton width="100%" height="12rem" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <Breadcrumbs items={breadcrumbItems(fixtureId)} />
        <div className="card">
          <p style={{ color: 'var(--text2)' }}>{error}</p>
        </div>
      </div>
    )
  }

  const teamsByPosition = [...data.teams].sort((a, b) => a.currentPos - b.currentPos)

  return (
    <div className="page">
      <Breadcrumbs items={breadcrumbItems(fixtureId)} />
      <LeagueHeaderCard tieBreakNote={data.tieBreakNote} />
      <StandingsTable teams={teamsByPosition} />
      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Finishing position probability</h2>
        <PositionDistributionChart
          teams={teamsByPosition}
          highlightTeamId={teamsByPosition.find((t) => isOurTeam(t.teamName))?.teamId}
        />
      </div>
    </div>
  )
}
