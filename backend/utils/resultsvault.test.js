'use strict'
const {
  fetchTeamLabel,
  _test: { decodeHtmlEntities, parseClubTeams }
} = require('./resultsvault')

// These tests cover the regex-injection guard added to fetchTeamLabel. The validation
// runs before any network call, so non-numeric input rejects without hitting the network.
describe('resultsvault — fetchTeamLabel input validation', () => {
  it('rejects non-numeric team_id (regex-injection guard)', async () => {
    await expect(fetchTeamLabel('(.*)', '259')).rejects.toThrow(/numeric/)
  })

  it('rejects non-numeric season_id', async () => {
    await expect(fetchTeamLabel('35533', 'abc')).rejects.toThrow(/numeric/)
  })

  it('rejects purely non-numeric / metacharacter team_id', async () => {
    await expect(fetchTeamLabel('.*', '3')).rejects.toThrow(/numeric/)
  })

  it('rejects null/undefined ids', async () => {
    await expect(fetchTeamLabel(null, undefined)).rejects.toThrow(/numeric/)
  })
})

describe('resultsvault — decodeHtmlEntities', () => {
  it('decodes numeric entity &#39; to apostrophe', () => {
    expect(decodeHtmlEntities('WHCC Women&#39;s Hardball 2026')).toBe("WHCC Women's Hardball 2026")
  })
  it('decodes &amp; to &', () => {
    expect(decodeHtmlEntities('Woking &amp; Horsell CC')).toBe('Woking & Horsell CC')
  })
  it('decodes &quot; to double-quote', () => {
    expect(decodeHtmlEntities('Team &quot;A&quot;')).toBe('Team "A"')
  })
  it('decodes multiple entities in one string', () => {
    expect(decodeHtmlEntities('Tom&#39;s &amp; Jerry&#39;s')).toBe("Tom's & Jerry's")
  })
  it('leaves plain strings unchanged', () => {
    expect(decodeHtmlEntities('WHCC Whirlwinds 2026')).toBe('WHCC Whirlwinds 2026')
  })
})

describe('resultsvault — parseClubTeams', () => {
  function makeOption(value, label) {
    return `<option value="${value}">${label}</option>`
  }

  it('returns active teams sorted by name', () => {
    const html = [makeOption('10001', 'Zebra XI'), makeOption('10002', 'Alpha XI')].join('\n')
    const result = parseClubTeams(html)
    expect(result.map((t) => t.name)).toEqual(['Alpha XI', 'Zebra XI'])
    expect(result.every((t) => !t.archived)).toBe(true)
  })

  it('flags teams after sentinel as archived', () => {
    const html = [
      makeOption('10001', 'Active Team'),
      makeOption('Archived Teams', 'Archived Teams'),
      makeOption('10002', 'Old Team')
    ].join('\n')
    const result = parseClubTeams(html)
    expect(result.find((t) => t.name === 'Active Team').archived).toBe(false)
    expect(result.find((t) => t.name === 'Old Team').archived).toBe(true)
  })

  it('active teams appear before archived teams', () => {
    const html = [
      makeOption('10002', 'Beta XI'),
      makeOption('Archived Teams', 'Archived Teams'),
      makeOption('10001', 'Alpha XI')
    ].join('\n')
    const result = parseClubTeams(html)
    expect(result[0].archived).toBe(false)
    expect(result[result.length - 1].archived).toBe(true)
  })

  it('deduplicates teams that appear twice (mobile + desktop layouts)', () => {
    const block = [makeOption('10001', 'WHCC 1st XI'), makeOption('10002', 'WHCC 2nd XI')].join(
      '\n'
    )
    const html = block + '\n' + block
    const result = parseClubTeams(html)
    const ids = result.map((t) => t.team_id)
    expect(ids.filter((id) => id === 10001).length).toBe(1)
    expect(ids.filter((id) => id === 10002).length).toBe(1)
  })

  it('filters out month options (value 1–12)', () => {
    const html = [makeOption('6', 'June'), makeOption('10001', 'Real Team')].join('\n')
    const result = parseClubTeams(html)
    expect(result.every((t) => t.name !== 'June')).toBe(true)
    expect(result.some((t) => t.name === 'Real Team')).toBe(true)
  })

  it('filters out season IDs (value <= 5000)', () => {
    const html = [makeOption('259', 'Season 2025'), makeOption('10001', 'Real Team')].join('\n')
    const result = parseClubTeams(html)
    expect(result.length).toBe(1)
    expect(result[0].name).toBe('Real Team')
  })

  it('filters out year-only labels like "2025"', () => {
    const html = [makeOption('10003', '2025'), makeOption('10001', 'Real Team')].join('\n')
    const result = parseClubTeams(html)
    expect(result.every((t) => t.name !== '2025')).toBe(true)
  })

  it('decodes HTML entities in team names', () => {
    const html = makeOption('10001', 'Woking &amp; Horsell CC')
    const result = parseClubTeams(html)
    expect(result[0].name).toBe('Woking & Horsell CC')
  })

  it('returns empty array for HTML with no matching options', () => {
    const result = parseClubTeams('<html><body>nothing here</body></html>')
    expect(result).toEqual([])
  })
})
