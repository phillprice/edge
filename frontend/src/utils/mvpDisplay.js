export function srColor(batSR, teamSR) {
  return batSR != null && teamSR != null && batSR > teamSR ? 'var(--green)' : 'inherit'
}

export const fmtVal = (v) => (v > 0 ? v : '—')

export const fmtSR = (v) => (v != null ? v : '—')

export const fmtBonus = (v) => (v > 0 ? `+${v}` : '—')

export function fmtBowlBase(p) {
  return p.bowl > 0 ? +(p.bowl - p.bowlHaulBonus - p.bowlMaidenBonus).toFixed(1) : '—'
}
