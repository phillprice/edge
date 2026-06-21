import { AlertTriangle, Trophy, Award, Flag } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'
import { JerseyIcon, jerseyInitials } from './JerseyIcon'
import { contrastRatio, lightenForDark } from '../utils/colour'

export const SWATCHES = [
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Slate', value: '#2e4057' },
  { label: 'Brown', value: '#4a2000' },
  { label: 'Claret', value: '#690028' },
  { label: 'Maroon', value: '#7a0000' },
  { label: 'Red', value: '#cc0000' },
  { label: 'Raspberry', value: '#cc0055' },
  { label: 'Orange', value: '#c85000' },
  { label: 'Amber', value: '#b06000' },
  { label: 'Bronze', value: '#7a4a00' },
  { label: 'Olive', value: '#4a5c00' },
  { label: 'Forest', value: '#1a5c2a' },
  { label: 'Teal', value: '#005f6e' },
  { label: 'Sky', value: '#0070c0' },
  { label: 'Royal', value: '#1a52cc' },
  { label: 'Indigo', value: '#1a0060' },
  { label: 'Purple', value: '#4b0082' },
  { label: 'Violet', value: '#7800aa' }
]

const PREVIEW_MANHATTAN = [
  { over: 1, inn1: 8, inn2: 5 },
  { over: 2, inn1: 4, inn2: 9 },
  { over: 3, inn1: 11, inn2: 6 },
  { over: 4, inn1: 7, inn2: 12 },
  { over: 5, inn1: 13, inn2: 4 },
  { over: 6, inn1: 6, inn2: 8 },
  { over: 7, inn1: 9, inn2: 11 },
  { over: 8, inn1: 5, inn2: 7 },
  { over: 9, inn1: 14, inn2: 3 },
  { over: 10, inn1: 7, inn2: 6 },
  { over: 11, inn1: 3, inn2: 10 },
  { over: 12, inn1: 8, inn2: 2 }
]

export function colourPreview(primary, secondary, kit) {
  const chips = [primary, secondary, kit].filter(Boolean)
  return (
    <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>
      {chips.map((c) => (
        <span
          key={c}
          title={c}
          style={{
            width: 16,
            height: 16,
            borderRadius: 3,
            background: c,
            display: 'inline-block',
            border: '1px solid var(--border)'
          }}
        />
      ))}
    </span>
  )
}

export function ColourField({ label, value, onChange }) {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(value)
  const ratio = isValid ? contrastRatio(value) : null
  const lowContrast = ratio !== null && ratio < 3

  return (
    <div>
      <label
        style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4, display: 'block' }}
      >
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="color"
          value={isValid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 36,
            height: 28,
            padding: 1,
            border: '1px solid var(--border)',
            borderRadius: 3,
            cursor: 'pointer',
            flexShrink: 0
          }}
        />
        <input
          style={{
            width: 90,
            fontSize: '0.85rem',
            padding: '4px 7px',
            fontFamily: 'monospace',
            border: lowContrast ? '1px solid var(--orange, #f90)' : '1px solid var(--border)',
            borderRadius: 4
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SWATCHES.map((s) => (
            <button
              key={s.value}
              title={s.label}
              onClick={() => onChange(s.value)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                background: s.value,
                border: value === s.value ? '2px solid var(--hotpink)' : '1px solid var(--border)',
                padding: 0,
                cursor: 'pointer',
                flexShrink: 0
              }}
            />
          ))}
        </div>
      </div>
      {lowContrast && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 4,
            fontSize: '0.75rem',
            color: 'var(--orange, #c77700)'
          }}
        >
          <AlertTriangle size={12} />
          Low contrast with white nav text ({ratio.toFixed(1)}:1 — min 3:1). Text may be hard to
          read.
        </div>
      )}
    </div>
  )
}

function PreviewPanel({ nav, acc, kitColour, dark }) {
  const bg = dark ? '#0c0b18' : '#f4f3f8'
  const bg2 = dark ? '#1a1830' : '#fff'
  const border = dark ? '#2d2a4a' : '#e0ddf0'
  const text = dark ? '#f0eeff' : '#1a1830'
  const dim = dark ? '#a4a0cc' : '#706e86'
  const scope = {
    '--nav-bg': nav,
    '--secondary-colour': acc,
    '--kit-colour': kitColour || nav,
    '--bg': bg,
    '--bg2': bg2,
    '--border': border,
    '--text': text,
    '--text2': dim,
    '--text3': dim,
    '--nav-dim': 'rgba(255,255,255,0.65)'
  }
  const axisStyle = { fontSize: 9, fill: dim }
  const gridColor = border
  return (
    <div
      style={{
        border: `1px solid ${border}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: bg,
        ...scope
      }}
    >
      <nav
        style={{
          background: nav,
          padding: '5px 10px',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          fontSize: '0.72rem'
        }}
      >
        <span style={{ color: '#fff', fontWeight: 600 }}>App</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Matches</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Players</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Season</span>
      </nav>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div
          className="match-card"
          style={{
            pointerEvents: 'none',
            cursor: 'default',
            fontSize: '0.78rem',
            background: bg2,
            borderColor: border,
            color: text
          }}
        >
          <div>
            <div className="match-teams" style={{ color: text }}>
              <span style={{ fontWeight: 700 }}>Your Club</span>
              <span style={{ color: dim }}> vs </span>
              <span>Opponents</span>
            </div>
            <div className="match-meta" style={{ fontSize: '0.72rem', color: dim }}>
              <span>14 Jun 2026 · Home</span>
            </div>
          </div>
          <div className="match-score">
            <span className="tag tag-green" style={{ fontSize: '0.68rem' }}>
              Won
            </span>
            <div style={{ fontSize: '0.78rem', color: dim }}>89/3 v 62/7</div>
          </div>
        </div>
        <div
          style={{
            background: bg2,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '5px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.78rem'
          }}
        >
          <JerseyIcon size={22} initials={jerseyInitials('Leo Brown')} />
          <span style={{ fontWeight: 600, color: text, flex: 1 }}>Leo Brown</span>
          <span style={{ color: text }}>
            47<span style={{ color: dim }}>*</span>
          </span>
          <span style={{ fontSize: '0.72rem', color: dim }}>32b · SR 146</span>
        </div>
        <div
          style={{
            background: bg2,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '6px 8px'
          }}
        >
          <div style={{ fontSize: '0.68rem', color: dim, marginBottom: 2 }}>Manhattan</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart
              data={PREVIEW_MANHATTAN}
              margin={{ top: 2, right: 2, bottom: 0, left: -28 }}
              barCategoryGap="15%"
            >
              <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="over" tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Bar
                dataKey="inn1"
                fill={dark ? lightenForDark(nav) : nav}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="inn2"
                fill={dark ? lightenForDark(acc) : acc}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div
          style={{
            background: bg2,
            border: `1px solid ${border}`,
            borderRadius: 6,
            padding: '6px 8px'
          }}
        >
          <div style={{ fontSize: '0.68rem', color: dim, marginBottom: 4 }}>Match Flow</div>
          <div className="flow-list">
            <div className="flow-event flow-team-milestone">
              <span className="flow-icon">
                <Trophy size={13} />
              </span>
              <span className="flow-text" style={{ color: dim }}>
                50 up — 1 down — ov 5
              </span>
            </div>
            <div className="flow-event flow-batter">
              <span className="flow-icon">
                <img
                  src="/cricket-bat.png"
                  style={{ width: 13, height: 13, objectFit: 'contain' }}
                  alt=""
                />
              </span>
              <span className="flow-text" style={{ color: dim }}>
                L Brown 25* (18b) — ov 6
              </span>
            </div>
            <div className="flow-event flow-wicket">
              <span className="flow-icon">
                <span className="flow-dot" />
              </span>
              <span className="flow-text" style={{ color: text, fontWeight: 500 }}>
                J Smith out caught 32(28) · 2nd wkt for 51 · ov 6.3
              </span>
            </div>
            <div className="flow-event flow-haul">
              <span className="flow-icon">
                <Award size={13} />
              </span>
              <span className="flow-text" style={{ color: dim }}>
                A Jones takes 2nd wicket — ov 8
              </span>
            </div>
            <div className="flow-event flow-maiden">
              <span className="flow-icon">
                <span className="flow-dot" style={{ width: 9, height: 9 }} />
              </span>
              <span className="flow-text" style={{ color: dim, fontWeight: 500 }}>
                Maiden — T Green — ov 9
              </span>
            </div>
            <div className="flow-event flow-end">
              <span className="flow-icon">
                <Flag size={13} />
              </span>
              <span className="flow-text" style={{ color: dim, fontStyle: 'italic' }}>
                Innings ends: 89/3 (12 overs)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ClubColourPreview({ primary, secondary, kit }) {
  const nav = primary || '#690028'
  const acc = secondary || '#a00040'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <PreviewPanel nav={nav} acc={acc} kitColour={kit} dark={false} />
      <PreviewPanel nav={nav} acc={acc} kitColour={kit} dark />
    </div>
  )
}
