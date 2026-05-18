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

// Classify a dismissal from ball description strings. sDesc is optional fallback.
function classifyDismissal(lDesc, sDesc) {
  const s = (lDesc || sDesc || '').toLowerCase();
  if (s.includes('run out'))                        return 'Run out';
  if (s.includes('lbw'))                            return 'LBW';
  if (s.includes('ct ') || s.includes('caught'))    return 'Caught';
  if (s.includes('stumped') || s.includes('st '))   return 'Stumped';
  if (s.includes('bowled') || /\bb\s+[A-Z]/.test(lDesc || '')) return 'Bowled';
  return 'Other';
}

module.exports = { oversToLegalBalls, ballsToOvers, classifyDismissal }
