import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadCsv, exportBatCsv, exportBowlCsv } from './csvExport.js'

describe('downloadCsv', () => {
  let mockAnchor

  beforeEach(() => {
    mockAnchor = { href: '', download: '', click: vi.fn() }

    vi.stubGlobal('document', {
      createElement: vi.fn(() => mockAnchor)
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn()
    })
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        constructor(parts, opts) {
          this.text = parts[0]
          this.type = opts?.type
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('triggers a download with the given filename', () => {
    downloadCsv('test.csv', [
      ['a', 'b'],
      ['1', '2']
    ])
    expect(document.createElement).toHaveBeenCalledWith('a')
    expect(mockAnchor.download).toBe('test.csv')
    expect(mockAnchor.click).toHaveBeenCalled()
  })

  it('produces correct CSV for simple rows', () => {
    downloadCsv('out.csv', [
      ['Name', 'Runs'],
      ['Alice', '42']
    ])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('Name,Runs\nAlice,42')
  })

  it('escapes values containing commas', () => {
    downloadCsv('out.csv', [['Smith, Joe', '10']])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('"Smith, Joe",10')
  })

  it('escapes values containing double quotes', () => {
    downloadCsv('out.csv', [['say "hi"', '5']])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe('"say ""hi""",5')
  })

  it('handles null and undefined values as empty string', () => {
    downloadCsv('out.csv', [[null, undefined, 0]])
    const blob = URL.createObjectURL.mock.calls[0][0]
    expect(blob.text).toBe(',,0')
  })

  it('revokes the object URL after click', () => {
    downloadCsv('out.csv', [['a']])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})

const SHOW_NONE = {
  dot_balls: false,
  total_minutes: false,
  dis_bowled: false,
  dis_caught: false,
  dis_lbw: false,
  dis_runout: false,
  dis_stumped: false,
  captain_count: false,
  wk_count: false,
  maidens: false,
  wicket_maidens: false,
  bowl_dot_balls: false,
  three_fers: false,
  four_fers: false,
  five_fers: false,
  six_fers: false,
  wkt_bowled: false,
  wkt_caught: false,
  wkt_lbw: false,
  wkt_stumped: false,
  catches: false,
  stumpings: false,
  run_outs: false
}
const SHOW_ALL = Object.fromEntries(Object.keys(SHOW_NONE).map((k) => [k, true]))

const BAT_PLAYER = {
  name: 'Alice',
  games_attended: 5,
  innings: 4,
  not_outs: 1,
  runs: 120,
  high_score: 50,
  bat_avg_per_game: '24.00',
  bat_sr: '80.0',
  balls_faced: 150,
  dot_balls: 40,
  fours: 10,
  sixes: 2,
  total_minutes: 200,
  avg_minutes: 50,
  times_out: 3,
  dis_bowled: 1,
  dis_caught: 1,
  dis_lbw: 0,
  dis_runout: 0,
  dis_stumped: 1,
  captain_count: 2,
  wk_count: 1
}

const BOWL_PLAYER = {
  name: 'Bob',
  games_attended: 5,
  games_bowled: 4,
  overs: '12.3',
  maidens: 1,
  wicket_maidens: 0,
  bowl_dot_balls: 20,
  runs_conceded: 60,
  wickets: 8,
  bowl_avg: '7.50',
  bowl_econ: '4.80',
  wkts_per_over: '0.65',
  three_fers: 1,
  four_fers: 0,
  five_fers: 1,
  six_fers: 0,
  wides: 3,
  no_balls: 1,
  wkt_bowled: 2,
  wkt_caught: 4,
  wkt_lbw: 1,
  wkt_stumped: 1,
  catches: 3,
  stumpings: 1,
  run_outs: 0
}

describe('exportBatCsv', () => {
  let mockAnchor

  beforeEach(() => {
    mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => mockAnchor) })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        constructor(parts, opts) {
          this.text = parts[0]
          this.type = opts?.type
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads players-batting.csv with the minimal column set when all show flags are off', () => {
    exportBatCsv([BAT_PLAYER], SHOW_NONE)
    expect(mockAnchor.download).toBe('players-batting.csv')
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [header] = blob.text.split('\n')
    expect(header).toBe('Name,Mat,Inn,NO,Runs,HS,Avg,SR,Balls,4s,6s,Out')
  })

  it('includes every optional column when all show flags are on', () => {
    exportBatCsv([BAT_PLAYER], SHOW_ALL)
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [header, row] = blob.text.split('\n')
    expect(header).toBe(
      'Name,Mat,Inn,NO,Runs,HS,Avg,SR,Balls,Dots,4s,6s,Mins,Min/I,Out,Bowled,Caught,LBW,Run out,Stumped,Capt,WK'
    )
    expect(row).toBe('Alice,5,4,1,120,50,24.00,80.0,150,40,10,2,200,50,3,1,1,0,0,1,2,1')
  })

  it('defaults missing numeric fields to 0', () => {
    exportBatCsv([{ name: 'Empty' }], SHOW_NONE)
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [, row] = blob.text.split('\n')
    expect(row).toBe('Empty,0,0,0,0,0,,,0,0,0,0')
  })
})

describe('exportBowlCsv', () => {
  let mockAnchor

  beforeEach(() => {
    mockAnchor = { href: '', download: '', click: vi.fn() }
    vi.stubGlobal('document', { createElement: vi.fn(() => mockAnchor) })
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() })
    vi.stubGlobal(
      'Blob',
      class MockBlob {
        constructor(parts, opts) {
          this.text = parts[0]
          this.type = opts?.type
        }
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads players-bowling.csv with the minimal column set when all show flags are off', () => {
    exportBowlCsv([BOWL_PLAYER], SHOW_NONE)
    expect(mockAnchor.download).toBe('players-bowling.csv')
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [header] = blob.text.split('\n')
    expect(header).toBe('Name,Mat,Inn,Overs,R,W,Avg,Econ,W/O,Wd,NB')
  })

  it('includes every optional column when all show flags are on', () => {
    exportBowlCsv([BOWL_PLAYER], SHOW_ALL)
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [header, row] = blob.text.split('\n')
    expect(header).toBe(
      'Name,Mat,Inn,Overs,M,WM,Dots,R,W,Avg,Econ,W/O,3W,4W,5W,6W,Wd,NB,Wkt Bowled,Wkt Caught,Wkt LBW,Wkt Stumped,Catches,Stumpings,Run outs'
    )
    expect(row).toBe('Bob,5,4,12.3,1,0,20,60,8,7.50,4.80,0.65,1,0,1,0,3,1,2,4,1,1,3,1,0')
  })

  it('defaults missing numeric fields to 0', () => {
    exportBowlCsv([{ name: 'Empty' }], SHOW_NONE)
    const blob = URL.createObjectURL.mock.calls[0][0]
    const [, row] = blob.text.split('\n')
    expect(row).toBe('Empty,0,0,,0,0,,,,0,0')
  })
})
