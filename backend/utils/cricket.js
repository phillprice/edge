const MONTH_NUM = {
  january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
  july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
  jan:'01', feb:'02', mar:'03', apr:'04', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
}

// Parse any known match_date format to YYYY-MM-DD. Returns null if unrecognised.
function toIsoDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);         // YYYY-MM-DD
  let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;                              // DD/MM/YYYY
  // "Weekday Dth Month YYYY" e.g. "Sunday 17th May 2025"
  m = raw.match(/(\d{4})$/);
  if (m) {
    const year = m[1];
    const lo = raw.toLowerCase();
    for (const [name, num] of Object.entries(MONTH_NUM)) {
      if (lo.includes(name)) {
        const dayM = raw.match(/(\d{1,2})(?:st|nd|rd|th)/i);
        if (dayM) return `${year}-${num}-${dayM[1].padStart(2, '0')}`;
      }
    }
  }
  return null;
}

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
  // C&B must be checked before generic 'caught' to avoid misclassification
  if (s.includes('c&b') || /ct\s*&\s*b/.test(s) || /\bct and b\b/.test(s) || s.includes('caught and bowled')) return 'CaughtAndBowled';
  if (s.includes('ct ') || s.includes('caught'))    return 'Caught';
  if (s.includes('stumped') || s.includes('st '))   return 'Stumped';
  if (s.includes('bowled') || /\bb\s+[A-Z]/.test(lDesc || '')) return 'Bowled';
  return 'Other';
}

module.exports = { toIsoDate, oversToLegalBalls, ballsToOvers, classifyDismissal }
