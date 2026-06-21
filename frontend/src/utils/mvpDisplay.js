export function srColor(batSR, teamSR) {
  return batSR != null && teamSR != null && batSR > teamSR ? 'var(--green)' : 'inherit'
}

export function fmtVal(v) {
  return v > 0 ? v : '—'
}

export function fmtSR(v) {
  return v != null ? v : '—'
}

export function fmtBonus(v) {
  return v > 0 ? `+${v}` : '—'
}

export function fmtBowlBase(p) {
  return p.bowl > 0 ? +(p.bowl - p.bowlHaulBonus - p.bowlMaidenBonus).toFixed(1) : '—'
}
