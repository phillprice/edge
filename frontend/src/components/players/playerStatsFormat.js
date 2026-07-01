export function dash(v) {
  return v == null || v === '' ? '–' : v
}
export function n0(v) {
  return v == null ? 0 : v
}

export function heatRange(rows, key) {
  const vals = rows
    .map((r) => r[key])
    .filter((v) => v != null && v !== '' && !isNaN(Number(v)))
    .map(Number)
  if (vals.length < 2) return null
  const mn = Math.min(...vals),
    mx = Math.max(...vals)
  return mn < mx ? { mn, mx } : null
}
export function heatBg(value, range, isNeg) {
  if (!range || value == null || value === '') return undefined
  const v = Number(value)
  if (isNaN(v)) return undefined
  const t = Math.min(1, Math.max(0, (v - range.mn) / (range.mx - range.mn)))
  if (t <= 0) return undefined
  const a = t * 0.45
  return isNeg ? `rgba(255,167,38,${a})` : `rgba(76,175,80,${a})`
}
