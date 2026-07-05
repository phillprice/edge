import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { shortTeam } from '../../utils/cricket'

// Green (1st place) → red (last place) gradient, used to colour each position segment
// of the stacked bar so a glance shows whether a team's mass sits toward the top or
// bottom of the table.
function positionColour(posIndex, teamCount) {
  const t = teamCount > 1 ? posIndex / (teamCount - 1) : 0
  const hue = 120 - t * 120 // 120=green .. 0=red
  return `hsl(${hue}, 65%, 45%)`
}

function PositionTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const entries = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
  return (
    <div
      style={{
        background: 'var(--bg2)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '0.5rem 0.75rem',
        fontSize: '0.8rem'
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {entries.map((p) => (
        <div key={p.dataKey}>
          {p.name}: {(p.value * 100).toFixed(1)}%
        </div>
      ))}
    </div>
  )
}

// One horizontal stacked bar per team — segments are the probability of finishing in
// each position (1st..Nth), coloured on a green→red gradient. WHCC's bar is bolded.
export default function PositionDistributionChart({ teams, highlightTeamId }) {
  if (!teams?.length) return null
  const teamCount = teams.length

  const data = teams.map((t) => {
    const row = { teamName: shortTeam(t.teamName) || t.teamName, teamId: t.teamId }
    t.positionProbabilities.forEach((p, i) => {
      row[`pos${i + 1}`] = p
    })
    return row
  })

  const rowHeight = 32
  const chartHeight = Math.max(120, teamCount * rowHeight + 40)

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 1]}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          fontSize={11}
        />
        <YAxis
          type="category"
          dataKey="teamName"
          width={140}
          fontSize={11}
          tick={({ x, y, payload }) => {
            const isHighlighted =
              data.find((d) => d.teamName === payload.value)?.teamId === highlightTeamId
            return (
              <text
                x={x}
                y={y}
                dy={4}
                textAnchor="end"
                fontWeight={isHighlighted ? 700 : 400}
                fill={isHighlighted ? 'var(--accent, #690028)' : 'var(--text2, #ccc)'}
                fontSize={11}
              >
                {payload.value}
              </text>
            )
          }}
        />
        <Tooltip content={<PositionTooltip />} />
        {Array.from({ length: teamCount }, (_, i) => (
          <Bar
            key={`pos${i + 1}`}
            dataKey={`pos${i + 1}`}
            name={`Position ${i + 1}`}
            stackId="positions"
            fill={positionColour(i, teamCount)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
