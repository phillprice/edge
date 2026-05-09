function oversToLegalBalls(oversStr) {
  const parts = String(oversStr || '0').split('.')
  const full = parseInt(parts[0]) || 0
  const rem  = Math.min(parseInt(parts[1]) || 0, 5)
  return full * 6 + rem
}

function ballsToOvers(balls) {
  if (!balls) return '0.0'
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

module.exports = { oversToLegalBalls, ballsToOvers }
