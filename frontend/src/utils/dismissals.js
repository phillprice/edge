const DISMISSAL_TEMPLATES = {
  Caught: (f, b) => (f && b ? `ct ${f} b ${b}` : b ? `caught b ${b}` : 'caught'),
  CaughtAndBowled: (f, b) => (b ? `c&b ${b}` : 'c&b'),
  Bowled: (f, b) => (b ? `b ${b}` : 'bowled'),
  LBW: (f, b) => (b ? `lbw b ${b}` : 'lbw'),
  Stumped: (f, b) => (f && b ? `st ${f} b ${b}` : 'stumped'),
  RunOut: (f) => (f ? `run out (${f})` : 'run out'),
  'Run out': (f) => (f ? `run out (${f})` : 'run out')
}

export function formatDismissalDesc(type, fielder, bowler) {
  const tpl = DISMISSAL_TEMPLATES[type]
  return tpl ? tpl(fielder, bowler) : type || 'out'
}

export function formatDismissalLabel(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  if (type === 'RunOut') return 'Run out'
  return type
}
