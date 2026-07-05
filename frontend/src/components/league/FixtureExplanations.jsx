import { shortTeam } from '../../utils/cricket'

function formatPct(p) {
  return p == null ? 'no data' : `${p}%`
}

function h2hLabel(h2hNudge, homeTeam, awayTeam) {
  if (!h2hNudge) return null
  if (h2hNudge === 'homeWin') return `${shortTeam(homeTeam)} won their last meeting`
  if (h2hNudge === 'awayWin') return `${shortTeam(awayTeam)} won their last meeting`
  if (h2hNudge === 'tie') return 'their last meeting was a tie'
  return 'their last meeting had no result (abandoned/cancelled)'
}

function FixtureExplanationRow({ explanation }) {
  const {
    homeTeam,
    awayTeam,
    homeSeasonWinPct,
    homeRecentWinPct,
    awaySeasonWinPct,
    awayRecentWinPct,
    h2hNudge,
    homeWinProbability,
    awayWinProbability,
    tieProbability
  } = explanation

  return (
    <li
      style={{
        marginBottom: '0.85rem',
        paddingBottom: '0.85rem',
        borderBottom: '1px solid var(--border)'
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>
        {shortTeam(homeTeam)} vs {shortTeam(awayTeam)}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>
        {shortTeam(homeTeam)} season win rate: {formatPct(homeSeasonWinPct)}
        {homeRecentWinPct != null && `, last 10: ${formatPct(homeRecentWinPct)}`}
        {' · '}
        {shortTeam(awayTeam)} season win rate: {formatPct(awaySeasonWinPct)}
        {awayRecentWinPct != null && `, last 10: ${formatPct(awayRecentWinPct)}`}
        {h2hNudge && ` · ${h2hLabel(h2hNudge, homeTeam, awayTeam)}`}
      </div>
      <div style={{ fontSize: '0.8rem', marginTop: 2 }}>
        Estimated odds: {shortTeam(homeTeam)} {homeWinProbability}% · {shortTeam(awayTeam)}{' '}
        {awayWinProbability}% · tie {tieProbability}%
      </div>
    </li>
  )
}

// Lists the reasoning behind each simulated fixture's odds — season/recent-form win rates
// for both sides plus any head-to-head nudge — so the position probabilities above aren't
// an unexplained black box.
export default function FixtureExplanations({ fixtures }) {
  if (!fixtures?.length) return null
  return (
    <div className="card">
      <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>How these odds were calculated</h2>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {fixtures.map((f, i) => (
          <FixtureExplanationRow key={i} explanation={f} />
        ))}
      </ul>
    </div>
  )
}
