import { Info } from 'lucide-react'

export default function LeagueHeaderCard({ trials, tieBreakNote }) {
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>League Predictor</h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '0.5rem' }}>
        Simulated over {trials.toLocaleString()} random outcomes of the division's remaining
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
        <span>{tieBreakNote}</span>
      </div>
    </div>
  )
}
