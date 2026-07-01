export function downloadCsv(filename, rows) {
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s
  }
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function n0(v) {
  return v == null ? 0 : v
}

export function exportBatCsv(players, show) {
  const header = [
    'Name',
    'Mat',
    'Inn',
    'NO',
    'Runs',
    'HS',
    'Avg',
    'SR',
    'Balls',
    ...(show.dot_balls ? ['Dots'] : []),
    '4s',
    '6s',
    ...(show.total_minutes ? ['Mins', 'Min/I'] : []),
    'Out',
    ...(show.dis_bowled ? ['Bowled'] : []),
    ...(show.dis_caught ? ['Caught'] : []),
    ...(show.dis_lbw ? ['LBW'] : []),
    ...(show.dis_runout ? ['Run out'] : []),
    ...(show.dis_stumped ? ['Stumped'] : []),
    ...(show.captain_count ? ['Capt'] : []),
    ...(show.wk_count ? ['WK'] : [])
  ]
  const data = players.map((p) => [
    p.name,
    n0(p.games_attended),
    n0(p.innings),
    n0(p.not_outs),
    n0(p.runs),
    n0(p.high_score),
    p.bat_avg_per_game ?? '',
    p.bat_sr ?? '',
    n0(p.balls_faced),
    ...(show.dot_balls ? [n0(p.dot_balls)] : []),
    n0(p.fours),
    n0(p.sixes),
    ...(show.total_minutes ? [n0(p.total_minutes), p.avg_minutes ?? ''] : []),
    n0(p.times_out),
    ...(show.dis_bowled ? [n0(p.dis_bowled)] : []),
    ...(show.dis_caught ? [n0(p.dis_caught)] : []),
    ...(show.dis_lbw ? [n0(p.dis_lbw)] : []),
    ...(show.dis_runout ? [n0(p.dis_runout)] : []),
    ...(show.dis_stumped ? [n0(p.dis_stumped)] : []),
    ...(show.captain_count ? [n0(p.captain_count)] : []),
    ...(show.wk_count ? [n0(p.wk_count)] : [])
  ])
  downloadCsv('players-batting.csv', [header, ...data])
}

export function exportBowlCsv(players, show) {
  const header = [
    'Name',
    'Mat',
    'Inn',
    'Overs',
    ...(show.maidens ? ['M'] : []),
    ...(show.wicket_maidens ? ['WM'] : []),
    ...(show.bowl_dot_balls ? ['Dots'] : []),
    'R',
    'W',
    'Avg',
    'Econ',
    'W/O',
    ...(show.three_fers ? ['3W'] : []),
    ...(show.four_fers ? ['4W'] : []),
    ...(show.five_fers ? ['5W'] : []),
    ...(show.six_fers ? ['6W'] : []),
    'Wd',
    'NB',
    ...(show.wkt_bowled ? ['Wkt Bowled'] : []),
    ...(show.wkt_caught ? ['Wkt Caught'] : []),
    ...(show.wkt_lbw ? ['Wkt LBW'] : []),
    ...(show.wkt_stumped ? ['Wkt Stumped'] : []),
    ...(show.catches ? ['Catches'] : []),
    ...(show.stumpings ? ['Stumpings'] : []),
    ...(show.run_outs ? ['Run outs'] : [])
  ]
  const data = players.map((p) => [
    p.name,
    n0(p.games_attended),
    n0(p.games_bowled),
    p.overs,
    ...(show.maidens ? [n0(p.maidens)] : []),
    ...(show.wicket_maidens ? [n0(p.wicket_maidens)] : []),
    ...(show.bowl_dot_balls ? [n0(p.bowl_dot_balls)] : []),
    n0(p.runs_conceded),
    n0(p.wickets),
    p.bowl_avg ?? '',
    p.bowl_econ ?? '',
    p.wkts_per_over ?? '',
    ...(show.three_fers ? [n0(p.three_fers)] : []),
    ...(show.four_fers ? [n0(p.four_fers)] : []),
    ...(show.five_fers ? [n0(p.five_fers)] : []),
    ...(show.six_fers ? [n0(p.six_fers)] : []),
    n0(p.wides),
    n0(p.no_balls),
    ...(show.wkt_bowled ? [n0(p.wkt_bowled)] : []),
    ...(show.wkt_caught ? [n0(p.wkt_caught)] : []),
    ...(show.wkt_lbw ? [n0(p.wkt_lbw)] : []),
    ...(show.wkt_stumped ? [n0(p.wkt_stumped)] : []),
    ...(show.catches ? [n0(p.catches)] : []),
    ...(show.stumpings ? [n0(p.stumpings)] : []),
    ...(show.run_outs ? [n0(p.run_outs)] : [])
  ])
  downloadCsv('players-bowling.csv', [header, ...data])
}
