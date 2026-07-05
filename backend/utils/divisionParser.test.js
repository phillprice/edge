'use strict'
const {
  extractDivisionId,
  parsePointsRules,
  parseStandingsRows,
  parseDivisionFixtures
} = require('./divisionParser')

describe('divisionParser — extractDivisionId', () => {
  it('extracts the division id from a results-page link', () => {
    const html =
      '<a class="btn" href="https://whcc.play-cricket.com/website/division/126766">League Table</a>'
    expect(extractDivisionId(html)).toBe(126766)
  })

  it('returns null when no division link is present (e.g. a friendly)', () => {
    expect(extractDivisionId('<html><body>no division link here</body></html>')).toBeNull()
  })
})

describe('divisionParser — parsePointsRules', () => {
  it('parses the points legend from header title attributes', () => {
    const html = `<thead><tr><th title='Won ( 4 )'>w</th><th title='Lost ( 1 )'>l</th>
      <th title='Tied ( 3 )'>t</th><th title='Cancelled ( 0 )'>Cancelled</th>
      <th title='Abandoned ( 2 )'>Abandoned</th><th title='Opposition Conceded ( 4 )'>wcn</th>
      <th title='Team Conceded ( 0 )'>lcn</th></tr></thead>`
    expect(parsePointsRules(html)).toEqual({
      won: 4,
      lost: 1,
      tied: 3,
      cancelled: 0,
      abandoned: 2,
      oppositionConceded: 4,
      teamConceded: 0
    })
  })

  it('ignores unrelated title attributes like Penalty Points / Head to Head / Points', () => {
    const html = `<th title='Penalty Points'>Pen</th><th title='Head to Head'>H2H</th><th title='Points'>Pts</th>`
    expect(parsePointsRules(html)).toEqual({})
  })
})

describe('divisionParser — parseStandingsRows', () => {
  const ROW = `<tr id= 'leg0' class='league_row '><td class='pos-num'><span class='d-none d-lg-block'></span><span class='d-block'>1</span></td><td class='text-left team-name'><a href="https://chiddingfold.play-cricket.com/Teams/274037">Chiddingfold CC - Under 11 Rockets</a></td><td class='d-lg-table-cell'> 10 </td><td class='d-none d-lg-table-cell'> 7 </td><td class='d-none d-lg-table-cell'> 2 </td><td class='d-none d-lg-table-cell'> 0 </td><td class='d-none d-lg-table-cell'> 0 </td><td class='d-none d-lg-table-cell'> 1 </td><td class='d-none d-lg-table-cell'> 0 </td><td class='d-none d-lg-table-cell'> 0 </td><td class='d-none d-lg-table-cell'> 0 </td><td class='d-lg-table-cell'> </td><td class='d-lg-table-cell'>32 </td><td class='d-lg-none text-right'><button></button></td></tr>`

  it('parses a standings row into its numeric fields', () => {
    const rows = parseStandingsRows(ROW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      teamId: 274037,
      teamName: 'Chiddingfold CC - Under 11 Rockets',
      played: 10,
      won: 7,
      lost: 2,
      tied: 0,
      cancelled: 0,
      abandoned: 1,
      oppConceded: 0,
      teamConceded: 0,
      pen: 0,
      h2h: 0,
      pts: 32
    })
  })

  it('does not pick up the collapsed mobile duplicate table as a standings row', () => {
    // The real page follows each league_row with a 'table-data-sm' block containing a
    // nested <table class="table table-striped"> — parseStandingsRows must not double-count it.
    const withMobileDup =
      ROW +
      `<tr class='table-data-sm d-lg-none'><td colspan='6'><table class='table table-striped'><tbody>
      <tr><td class='text-left'>Won</td><td class='text-right'>7</td></tr></tbody></table></td></tr>`
    expect(parseStandingsRows(withMobileDup)).toHaveLength(1)
  })

  it('returns an empty array when no rows match', () => {
    expect(parseStandingsRows('<table></table>')).toEqual([])
  })

  it('parses the viewing club\'s own row despite its extra "highlighted-row" class', () => {
    // On a club's own domain, their row is class='league_row highlighted-row' instead of
    // the plain class='league_row ' every other row gets — this previously caused the
    // viewing club's own team to silently disappear from the standings.
    const highlightedRow = ROW.replace(
      "class='league_row '",
      "class='league_row highlighted-row'"
    ).replace('274037', '35533')
    const rows = parseStandingsRows(highlightedRow)
    expect(rows).toHaveLength(1)
    expect(rows[0].teamId).toBe(35533)
  })
})

describe('divisionParser — parseDivisionFixtures', () => {
  // Trimmed but structurally faithful excerpt of a real "next_10_fixtures" tab page —
  // each fixture is rendered twice (mobile + desktop) with the same match_details id.
  const HTML = `
    <div class="col-sm-12 text-center text-md-left title2">Sunday 05 July 2026</div>
    <div class='col-sm-12 d-md-none match-status-mobile'><div class='d-inline-block'>
      <p class='time'>09:30</p><p class='location'><a href='/grounds/1'><a href="/grounds/1">The Parks Community Centre</a></a></p>
    </div>
    <a href='/match_details?id=7451113' class='link-scorecard rounded-circle'><i class='material-icons'>search</i></a></div>
    <table class='table'><tr class='d-none d-md-table-row'><td><div class='d-inline-flex'>
      <p class='time mr-15'>09:30</p><p class='location'><a href='/grounds/1'><a href="/grounds/1">The Parks Community Centre</a></a></p>
    </div></td><td class='card-table-r'><p class='txt1'>Bracknell United<span class='d-block d-lg-inline'><span class='d-none d-lg-inline'>-</span> Under 10</span></p></td>
    <td class='card-table-r'><p class='txt1'>Valley End CC<span class='d-block d-lg-inline'><span class='d-none d-lg-inline'>-</span> Under 10 B</span></p></td>
    <td><a href='/match_details?id=7451113' class='link-scorecard d-none d-md-inline-block rounded-circle'><i class='material-icons'>search</i></a></td></tr></table>
    <div class="col-sm-12 text-center text-md-left title2">Saturday 11 July 2026</div>
    <div class='col-sm-12 d-md-none match-status-mobile'><div class='d-inline-block'>
      <p class='time'>11:00</p><p class='location'><a href='/grounds/2'><a href="/grounds/2">Eastwood Leisure Centre</a></a></p>
    </div>
    <a href='/match_details?id=7448555' class='link-scorecard rounded-circle'></a></div>
    <table class='table'><tr><td><p class='time mr-15'>11:00</p><p class='location'><a href='/grounds/2'><a href="/grounds/2">Eastwood Leisure Centre</a></a></p></td>
    <td class='card-table-r'><p class='txt1'>Woking &amp; Horsell CC<span class='d-block d-lg-inline'><span class='d-none d-lg-inline'>-</span> U10 Whirlwinds</span></p></td>
    <td class='card-table-r'><p class='txt1'>Pirbright CC<span class='d-block d-lg-inline'><span class='d-none d-lg-inline'>-</span> Pumas</span></p></td>
    <td><a href='/match_details?id=7448555' class='link-scorecard d-none d-md-inline-block rounded-circle'></a></td></tr></table>
  `

  it('parses one entry per fixture, deduping the mobile/desktop duplicate', () => {
    const fixtures = parseDivisionFixtures(HTML)
    expect(fixtures).toHaveLength(2)
  })

  it('associates each fixture with its date heading, time, ground and teams', () => {
    const [first, second] = parseDivisionFixtures(HTML)
    expect(first).toEqual({
      playCricketId: 7451113,
      matchDateIso: '2026-07-05T09:30:00',
      ground: 'The Parks Community Centre',
      homeTeam: 'Bracknell United - Under 10',
      awayTeam: 'Valley End CC - Under 10 B'
    })
    expect(second).toEqual({
      playCricketId: 7448555,
      matchDateIso: '2026-07-11T11:00:00',
      ground: 'Eastwood Leisure Centre',
      homeTeam: 'Woking & Horsell CC - U10 Whirlwinds',
      awayTeam: 'Pirbright CC - Pumas'
    })
  })

  it('returns an empty array when there are no fixtures', () => {
    expect(parseDivisionFixtures('<html><body>no fixtures</body></html>')).toEqual([])
  })
})
