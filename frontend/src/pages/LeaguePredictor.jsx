import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Breadcrumbs from '../components/Breadcrumbs'
import { Skeleton } from '../components/Skeleton'
import { useApiFetch } from '../hooks/useApiFetch'
import { isOurTeam } from '../utils/cricket'
import LeagueHeaderCard from '../components/league/LeagueHeaderCard'
import StandingsTable from '../components/league/StandingsTable'
import PositionDistributionChart from '../components/league/PositionDistributionChart'

function useLeaguePrediction(fixtureId) {
  const apiFetch = useApiFetch()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(`/api/leagues/${fixtureId}/prediction`)
      .then(async (res) => {
        if (cancelled) return
        if (res.status === 404) {
          setError('This fixture is not a league fixture with a resolvable division.')
          return
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Request failed (${res.status})`)
        }
        setData(await res.json())
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false))
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
      <LeagueHeaderCard trials={data.trials} tieBreakNote={data.tieBreakNote} />
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
