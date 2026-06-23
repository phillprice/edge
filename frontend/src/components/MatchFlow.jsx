import { Trophy, Award, Flag, ArrowLeftRight } from 'lucide-react'
import { shortTeam } from '../utils/cricket'

// ── Match flow ────────────────────────────────────────────────────────────────

const FLOW_ICONS = {
  team_milestone: { Icon: Trophy, cls: 'flow-team-milestone' },
  bowling_milestone: { Icon: Trophy, cls: 'flow-team-milestone' },
  batter_milestone: { imgSrc: '/cricket-bat.png', cls: 'flow-batter' },
  wicket: { Icon: null, cls: 'flow-wicket' },
  pairs_out: { Icon: null, cls: 'flow-wicket' },
  bowler_haul: { Icon: Award, cls: 'flow-haul' },
  innings_end: { Icon: Flag, cls: 'flow-end' },
  keeper_change: { Icon: ArrowLeftRight, cls: 'flow-keeper' },
  retirement: { imgSrc: '/cricket-bat.png', imgFilter: 'hue-rotate(180deg)', cls: 'flow-batter' },
  maiden: { Icon: null, cls: 'flow-maiden' },
  wicket_maiden: { Icon: null, cls: 'flow-maiden' },
  double_wicket_maiden: { Icon: null, cls: 'flow-maiden' }
}

function ordSuffix(n) {
  if (n === 1) return '1st'
  if (n === 2) return '2nd'
  if (n === 3) return '3rd'
  return `${n}th`
}

function dismissalShortDesc(method, fielder, bowler, dn) {
  const f = fielder ? dn(fielder) : null
  const b = bowler ? dn(bowler) : null
  switch (method) {
    case 'Caught':
      return f && b ? `ct ${f} b ${b}` : b ? `c&b ${b}` : 'caught'
    case 'CaughtAndBowled':
      return b ? `c&b ${b}` : 'c&b'
    case 'Bowled':
      return b ? `b ${b}` : 'bowled'
    case 'LBW':
      return b ? `lbw b ${b}` : 'lbw'
    case 'Stumped':
      return f && b ? `st ${f} b ${b}` : b ? `st b ${b}` : 'stumped'
    case 'RunOut':
      return f ? `run out (${f})` : 'run out'
    default:
      return b ? `b ${b}` : 'out'
  }
}

function FlowEvent({ event, dn, isOursBatting }) {
  const meta = FLOW_ICONS[event.type] || {}
  const { Icon, imgSrc, cls = '' } = meta

  const playerName = event.player ? dn(event.player) : ''

  let content
  if (event.type === 'powerplay') {
    content = `Powerplay: ${event.score}/${event.wickets} after 6 overs`
  } else if (event.type === 'team_milestone') {
    content = `${event.runs} up — ${event.wickets} down — ov ${event.over}`
  } else if (event.type === 'bowling_milestone') {
    content = `${event.wickets} down for ${event.runs} — ov ${event.over}`
  } else if (event.type === 'batter_milestone') {
    content = `${playerName} ${event.runs}${event.runs >= 10 ? '*' : ''} (${event.balls}b) — ov ${event.over}`
  } else if (event.type === 'wicket') {
    if (isOursBatting) {
      const rb = `${event.runs}(${event.balls})`
      const isRunOut = event.dismissalMethod === 'RunOut'
      const methodWord = {
        Bowled: 'bowled',
        Caught: 'caught',
        CaughtAndBowled: 'caught & bowled',
        LBW: 'lbw',
        Stumped: 'stumped'
      }[event.dismissalMethod]
      const after = isRunOut
        ? ` run out · ${rb}`
        : `${methodWord ? ` out ${methodWord}` : ' out'} ${rb}`
      const suffix = ` · ${ordSuffix(event.wickets)} wkt for ${event.score}${event.partnership > 0 ? ` · p'ship ${event.partnership}` : ''} · ov ${event.over}`
      content = `${playerName}${after}${suffix}`
    } else {
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      const parts = [disDesc, `${ordSuffix(event.wickets)} wkt for ${event.score}`]
      if (event.partnership > 0) parts.push(`p'ship ${event.partnership}`)
      parts.push(`ov ${event.over}`)
      content = parts.join(' · ')
    }
  } else if (event.type === 'bowler_haul') {
    content = `${playerName} takes ${ordSuffix(event.wickets)} wicket — ov ${event.over}`
  } else if (event.type === 'pairs_out') {
    if (isOursBatting) {
      content = `${playerName} out — ${ordSuffix(event.wickets)} dismissal · ${event.score} raw · ov ${event.over}`
    } else {
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      content = `${disDesc} — ${ordSuffix(event.wickets)} dismissal · ${event.score} raw · ov ${event.over}`
    }
  } else if (event.type === 'innings_end') {
    content =
      event.netScore != null
        ? `Innings ends: ${event.score} raw · ${event.wickets} out · net ${event.netScore} (${event.overs} overs)`
        : `Innings ends: ${event.score}/${event.wickets} (${event.overs} overs)`
  } else if (event.type === 'keeper_change') {
    content = `Keeper: ${dn(event.player)} — ov ${event.over}`
  } else if (event.type === 'retirement') {
    content = `${playerName} retired not out ${event.runs}(${event.balls}b) — ov ${event.over}`
  } else if (
    event.type === 'maiden' ||
    event.type === 'wicket_maiden' ||
    event.type === 'double_wicket_maiden'
  ) {
    const label =
      event.type === 'double_wicket_maiden'
        ? 'Double wicket maiden'
        : event.type === 'wicket_maiden'
          ? 'Wicket maiden'
          : 'Maiden'
    content = `${label} — ${playerName} — ov ${Math.floor(Number(event.over))}`
  }

  return (
    <div className={`flow-event ${cls}`}>
      <span className="flow-icon">
        {imgSrc ? (
          <img
            src={imgSrc}
            style={{ width: 13, height: 13, objectFit: 'contain', filter: meta.imgFilter }}
            alt=""
          />
        ) : Icon ? (
          <Icon size={13} />
        ) : (
          <span className="flow-dot" />
        )}
      </span>
      <span className="flow-text">{content}</span>
    </div>
  )
}

function MatchFlow({ scorecards, roles, dn, isOurs, fixture }) {
  const flowScs = scorecards.filter((sc) => sc.flow?.length > 1)
  if (!flowScs.length) return null

  const sideBySide = flowScs.length > 1
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>
        Match Flow:
        {fixture.toss_winner && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '2px 10px 2px 6px',
              borderRadius: 999,
              fontSize: '0.8rem',
              fontWeight: 500
            }}
          >
            Toss · {shortTeam(fixture.toss_winner)} · {fixture.toss_decision}
            {fixture.toss_decision === 'bat' ? (
              <img src="/cricket-bat.png" height="13" style={{ opacity: 0.85, marginLeft: 1 }} />
            ) : (
              <span className="flow-dot"></span>
            )}
          </span>
        )}
      </h3>
      <div
        style={sideBySide ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } : {}}
      >
        {flowScs.map((sc) => {
          const team = roles?.[sc.inningsOrder]?.batting_team
          const isOursBatting = team ? isOurs(team) : sc.isManual ? sc.inningsOrder === 1 : true
          return (
            <div key={sc.inningsOrder}>
              {sideBySide && (
                <div
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'var(--text2)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    marginBottom: '0.5rem'
                  }}
                >
                  {team ? shortTeam(team) : `Innings ${sc.inningsOrder}`} batting
                </div>
              )}
              <div className="flow-list">
                {sc.flow
                  .filter((event) => isOursBatting || event.type !== 'batter_milestone')
                  .map((event, j) => (
                    <FlowEvent key={j} event={event} dn={dn} isOursBatting={isOursBatting} />
                  ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default MatchFlow
