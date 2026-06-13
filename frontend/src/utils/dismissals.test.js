import { formatDismissalDesc, formatDismissalLabel } from './dismissals'

describe('formatDismissalLabel', () => {
  it('formats CaughtAndBowled', () => {
    expect(formatDismissalLabel('CaughtAndBowled')).toBe('Caught and Bowled')
  })
  it('formats RunOut', () => {
    expect(formatDismissalLabel('RunOut')).toBe('Run out')
  })
  it('passes through other types', () => {
    expect(formatDismissalLabel('Bowled')).toBe('Bowled')
    expect(formatDismissalLabel('LBW')).toBe('LBW')
    expect(formatDismissalLabel(undefined)).toBeUndefined()
  })
})

describe('formatDismissalDesc', () => {
  it('formats Caught with fielder and bowler', () => {
    expect(formatDismissalDesc('Caught', 'Jones', 'Smith')).toBe('ct Jones b Smith')
  })
  it('formats Caught with bowler only', () => {
    expect(formatDismissalDesc('Caught', null, 'Smith')).toBe('caught b Smith')
  })
  it('formats Caught with neither', () => {
    expect(formatDismissalDesc('Caught', null, null)).toBe('caught')
  })
  it('formats CaughtAndBowled', () => {
    expect(formatDismissalDesc('CaughtAndBowled', null, 'Smith')).toBe('c&b Smith')
  })
  it('formats Bowled', () => {
    expect(formatDismissalDesc('Bowled', null, 'Smith')).toBe('b Smith')
  })
  it('formats LBW', () => {
    expect(formatDismissalDesc('LBW', null, 'Smith')).toBe('lbw b Smith')
  })
  it('formats Stumped', () => {
    expect(formatDismissalDesc('Stumped', 'Jones', 'Smith')).toBe('st Jones b Smith')
  })
  it('formats RunOut with fielder', () => {
    expect(formatDismissalDesc('RunOut', 'Jones')).toBe('run out (Jones)')
  })
  it('formats RunOut without fielder', () => {
    expect(formatDismissalDesc('RunOut', null)).toBe('run out')
  })
  it('formats Run out (space variant)', () => {
    expect(formatDismissalDesc('Run out', 'Jones')).toBe('run out (Jones)')
  })
  it('falls back to type for unknown dismissals', () => {
    expect(formatDismissalDesc('Retired', null, null)).toBe('Retired')
  })
  it('falls back to out when type is empty', () => {
    expect(formatDismissalDesc('', null, null)).toBe('out')
  })
})
