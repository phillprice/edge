import { isOurTeam, shortTeam } from '../../utils/cricket'

function StandingsRow({ team }) {
  const highlight = isOurTeam(team.teamName)
  return (
    <tr
      style={
        highlight
          ? {
              fontWeight: 700,
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)'
            }
          : undefined
      }
    >
      <td>{team.currentPos}</td>
      <td>{shortTeam(team.teamName) || team.teamName}</td>
      <td style={{ textAlign: 'right' }}>{team.currentPts}</td>
      <td style={{ textAlign: 'right' }}>
        {team.pointsHistogram.p10}–{team.pointsHistogram.p90}
      </td>
    </tr>
  )
}

export default function StandingsTable({ teams }) {
  return (
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
          {teams.map((t) => (
            <StandingsRow key={t.teamId} team={t} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
