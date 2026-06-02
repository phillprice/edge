'use strict'
const { fetchTeamLabel } = require('./resultsvault')

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
