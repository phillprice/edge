'use strict'
const { parseDivisionResults } = require('./divisionResultsParser')

// Trimmed but structurally faithful excerpt of a real "last_10_results" tab page — each
// match's results id appears 3 times (onclick wrapper, mobile link, desktop link) with the
// same value, and points-l/points-r/team each render once or twice with identical values.
const HTML = `
  <div class="col-sm-12 text-center text-md-left title2">Thursday 02 July 2026</div>
  <div class="card-table rcard card-table-last2" onclick="window.open('/website/results/7448964', '_self');">
    <div class='col-sm-12 d-md-none match-status-mobile'>
      ESHER CC WON  BY 125 RUNS
      <a href='/website/results/7448964' class='link-scorecard rounded-circle'></a>
    </div>
    <table class='table'><tbody>
      <tr><td>
        <p class='club-badge-card d-md-none'><span class='points points-l bg2'> 1 <span>pts</span></span></p>
        <p class='txt1'>Epsom CC <span> - U11 T1</span></p>
        <p class='club-badge-card club-badge-card-left'><span class='points points-l bg2'> 1 <span>pts</span></span></p>
        <p class='club-badge-card club-badge-card-right'><span class='points points-r bg1'> 4 <span>pts</span></span></p>
      </td><td>
        <p class='club-badge-card d-md-none'><span class='points points-r bg1'> 4 <span>pts</span></span></p>
        <p class='txt1'>Esher CC <span> - Under 10 Eagles</span></p>
      </td></tr>
    </tbody></table>
    <a href='/website/results/7448964' class='link-scorecard d-none d-md-inline-block rounded-circle'></a>
  </div>
  <div class="col-sm-12 text-center text-md-left title2">Wednesday 01 July 2026</div>
  <div class="card-table rcard card-table-last2" onclick="window.open('/website/results/7448954', '_self');">
    <div class='col-sm-12 d-md-none match-status-mobile'>
      EPSOM CC WON  BY 5 WICKETS
      <a href='/website/results/7448954' class='link-scorecard rounded-circle'></a>
    </div>
    <table class='table'><tbody>
      <tr><td>
        <p class='club-badge-card d-md-none'><span class='points points-l bg1'> 4 <span>pts</span></span></p>
        <p class='txt1'>Epsom CC <span> - U11 T1</span></p>
      </td><td>
        <p class='club-badge-card d-md-none'><span class='points points-r bg2'> 1 <span>pts</span></span></p>
        <p class='txt1'>East Molesey CC <span> - Under 11 A - Midweek</span></p>
      </td></tr>
    </tbody></table>
    <a href='/website/results/7448954' class='link-scorecard d-none d-md-inline-block rounded-circle'></a>
  </div>
`

describe('divisionResultsParser — parseDivisionResults', () => {
  it('parses one entry per match, deduping the 3x-repeated results id', () => {
    const results = parseDivisionResults(HTML)
    expect(results).toHaveLength(2)
  })

  it('extracts home/away teams and points correctly', () => {
    const [first, second] = parseDivisionResults(HTML)
    expect(first).toEqual({
      playCricketId: 7448964,
      matchDateIso: '2026-07-02T12:00:00',
      homeTeam: 'Epsom CC - U11 T1',
      awayTeam: 'Esher CC - Under 10 Eagles',
      homePts: 1,
      awayPts: 4
    })
    expect(second).toEqual({
      playCricketId: 7448954,
      matchDateIso: '2026-07-01T12:00:00',
      homeTeam: 'Epsom CC - U11 T1',
      awayTeam: 'East Molesey CC - Under 11 A - Midweek',
      homePts: 4,
      awayPts: 1
    })
  })

  it('returns an empty array when there are no results', () => {
    expect(parseDivisionResults('<html><body>no results</body></html>')).toEqual([])
  })
})
