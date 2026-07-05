import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Info } from 'lucide-react'
import Breadcrumbs from '../components/Breadcrumbs'
import { Skeleton } from '../components/Skeleton'
import { useApiFetch } from '../hooks/useApiFetch'
import { isOurTeam, shortTeam } from '../utils/cricket'
import PositionDistributionChart from '../components/league/PositionDistributionChart'

export default function LeaguePredictor() {
  const { fixtureId } = useParams()
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

  if (loading) {
    return (
      <div className="page">
        <Breadcrumbs
          items={[{ label: 'Match', href: `/match/${fixtureId}` }, { label: 'League Predictor' }]}
        />
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
        <Breadcrumbs
          items={[{ label: 'Match', href: `/match/${fixtureId}` }, { label: 'League Predictor' }]}
        />
        <div className="card">
          <p style={{ color: 'var(--text2)' }}>{error}</p>
        </div>
      </div>
    )
  }

  const teamsByPosition = [...data.teams].sort((a, b) => a.currentPos - b.currentPos)

  return (
    <div className="page">
      <Breadcrumbs
        items={[{ label: 'Match', href: `/match/${fixtureId}` }, { label: 'League Predictor' }]}
      />
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: '0.25rem' }}>League Predictor</h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '0.5rem' }}>
          Simulated over {data.trials.toLocaleString()} random outcomes of the division's remaining
          fixtures.
        </p>
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            fontSize: '0.78rem',
            color: 'var(--text3)',
            alignItems: 'flex-start'
          }}
        >
          <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{data.tieBreakNote}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <table style={{ width: '100%', fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Pos</th>
              <th style={{ textAlign: 'left' }}>Team</th>
              <th style={{ textAlign: 'right' }}>Pts</th>
              <th style={{ textAlign: 'right' }}>Projected (p10–p90)</th>
            </tr>
          </thead>
          <tbody>
            {teamsByPosition.map((t) => (
              <tr
                key={t.teamId}
                style={
                  isOurTeam(t.teamName)
                    ? {
                        fontWeight: 700,
                        background: 'color-mix(in srgb, var(--accent) 12%, transparent)'
                      }
                    : undefined
                }
              >
                <td>{t.currentPos}</td>
                <td>{shortTeam(t.teamName) || t.teamName}</td>
                <td style={{ textAlign: 'right' }}>{t.currentPts}</td>
                <td style={{ textAlign: 'right' }}>
                  {t.pointsHistogram.p10}–{t.pointsHistogram.p90}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
