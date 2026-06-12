import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Trophy } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { isWhccTeam, netScore, formatDate, parseMatchDate, computeResultPhrase, shortTeam, dn } from '../utils/cricket'
import { FormSparkline } from '../components/SeasonCards'
import { useGroups } from '../GroupContext'
import { Skeleton } from '../components/Skeleton'
import TeamSeasonFilter from '../components/TeamSeasonFilter'
import { useFavouriteGroups } from '../hooks/useFavouriteGroups'

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}


function formatScore(score, wickets, overs, format, startingScore) {
  if (!score) return null
  if (format === 'pairs') {
    const net = netScore(score, wickets, startingScore)
    return `Net ${net} (${overs} ov)`
  }
  const wkt = wickets ? `/${wickets}` : ' a/o'
  return `${score}${wkt} (${overs} ov)`
}

const LIMIT = 50

const FORM_COLOURS = { won: '#4caf50', lost: '#ef5350', tied: '#ff9800' }
const FORM_LABELS  = { won: 'Won', lost: 'Lost', tied: 'Tied' }

function whccResult(m) {
  const phrase = computeResultPhrase(m) || ''
  const lower  = phrase.toLowerCase()
  if (lower.includes(' won '))  return 'won'
  if (lower.includes(' lost ')) return 'lost'
  if (/\btied?\b/.test(lower)) return 'tied'
  if (/\bwon\b/.test(lower))   return isWhccTeam(phrase.split(' - ')[0]) ? 'won' : 'lost'
  return null
}

export default function MatchList() {
  const [allMatches, setAllMatches] = useState([])
  const [total, setTotal]           = useState(0)
  const [offset, setOffset]         = useState(0)
  const [loading, setLoading]       = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  const compFilter = searchParams.get('comp') || 'all'
  const sortOrder  = searchParams.get('sort') || 'newest'

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const { myGroups } = useGroups()
  const { favourites, toggleFavourite } = useFavouriteGroups(myGroups)

  // Two-level Team × Season selection persisted in the `groups` URL param.
  // Default priority: starred favourites → all accessible groups → none (super admins).
  const baseDefault = (!isSuperAdmin && myGroups.length)
    ? myGroups.map(g => ({ team_id: g.team_id, season_id: g.season_id }))
    : []
  const defaultGroups  = favourites.length ? favourites : baseDefault
  const groupsParam    = searchParams.get('groups')
  const selectedGroups = groupsParam != null
    ? groupsParam.split(',').filter(Boolean).map(tok => { const [t, s] = tok.split(':').map(Number); return { team_id: t, season_id: s } })
    : defaultGroups
  const selectedKey = selectedGroups.map(g => `${g.team_id}:${g.season_id}`).join(',')

  function setGroups(pairs) {
    updateFilter('groups', pairs.map(g => `${g.team_id}:${g.season_id}`).join(','), '')
  }

  // Fetch first page whenever the selection changes (server-side filter)
  useEffect(() => {
    setLoading(true)
    setOffset(0)
    const params = new URLSearchParams({ limit: LIMIT, offset: 0 })
    if (selectedKey) params.set('groups', selectedKey)
    apiFetch(`/api/matches?${params}`)
      .then(r => r.json())
      .then(d => { setAllMatches(d.matches); setTotal(d.total); setLoading(false) })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey])

  function handleLoadMore() {
    const nextOffset = offset + LIMIT
    setLoadingMore(true)
    apiFetch(`/api/matches?limit=${LIMIT}&offset=${nextOffset}`)
      .then(r => r.json())
      .then(d => {
        setAllMatches(prev => [...prev, ...d.matches])
        setTotal(d.total)
        setOffset(nextOffset)
        setLoadingMore(false)
      })
      .catch(() => setLoadingMore(false))
  }

  if (loading) return (
    <div className="page">
      <h1>Matches</h1>
      <div className="match-list">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="match-card" style={{ padding: '0.75rem 1rem' }}>
            <Skeleton height="1.1rem" width="60%" />
            <div style={{ marginTop: '0.4rem' }}><Skeleton height="0.85rem" width="40%" /></div>
          </div>
        ))}
      </div>
    </div>
  )

  // Team/season scoping is applied server-side via the group filter (effectiveGroupKey).
  // Only the competition Type filter and sort remain client-side on the loaded page(s).
  const matches = allMatches

  function getCompType(competition) {
    if (!competition) return 'league'
    const l = competition.toLowerCase()
    if (l.includes('cup')) return 'cup'
    if (l === 'friendly') return 'friendly'
    return 'league'
  }

  const sorted = [...matches].sort((a, b) => {
    const byDate = (x, y) => parseMatchDate(y.match_date) - parseMatchDate(x.match_date)
    if (sortOrder === 'oldest') return -byDate(a, b)
    return byDate(a, b)
  })
  const filtered = sorted.filter(m =>
    compFilter === 'all' || getCompType(m.competition) === compFilter
  )

  const canLoadMore = allMatches.length < total

  // A filter is "active" if the user has narrowed by team/season or competition. We must keep
  // the filter bar visible while a filter is active even when it returns nothing — otherwise the
  // user is stranded with no way to clear it (#136).
  const hasFilter = !!selectedKey || compFilter !== 'all'
  const canFilter = myGroups.length > 1 || allMatches.length > 0 || hasFilter

  return (
    <div className="page">
      <h1>Matches</h1>

      {canFilter && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {myGroups.length > 1 && (
            <details style={{ display: 'inline-block' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text2)', padding: '0.4rem 0.8rem', borderRadius: 4, border: '1px solid var(--border2)', userSelect: 'none', fontWeight: 500 }}>
                Teams {selectedKey && `(${selectedGroups.length})`}
              </summary>
              <div style={{ position: 'absolute', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginTop: '0.5rem', zIndex: 200, minWidth: '280px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                <TeamSeasonFilter myGroups={myGroups} value={selectedGroups} onChange={setGroups} hideLabel
                  favourites={favourites} onToggleFavourite={toggleFavourite} />
              </div>
            </details>
          )}
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <FilterPills
              label="Type"
              options={[
                { value: 'all',      label: 'All' },
                { value: 'league',   label: 'League' },
                { value: 'cup',      label: 'Cup' },
                { value: 'friendly', label: 'Friendly' },
              ]}
              value={compFilter}
              onChange={v => updateFilter('comp', v, 'all')}
            />
            <FilterPills
              label="Sort"
              options={[
                { value: 'newest', label: 'Newest' },
                { value: 'oldest', label: 'Oldest' },
              ]}
              value={sortOrder}
              onChange={v => updateFilter('sort', v, 'newest')}
            />
          </div>
        </div>
      )}

      {allMatches.length >= 3 && (() => {
        const recent = [...allMatches]
          .sort((a, b) => parseMatchDate(b.match_date) - parseMatchDate(a.match_date))
          .slice(0, 10)
          .reverse()
        const formData = recent.map(m => {
          const whccHome = isWhccTeam(m.home_team)
          const raw = whccHome ? parseInt(m.home_score) : parseInt(m.away_score)
          return {
            fixture_id: m.fixture_id,
            label: `${formatDate(m.match_date)} vs ${shortTeam(whccHome ? m.away_team : m.home_team)}`,
            score: isNaN(raw) ? null : raw,
            result: whccResult(m),
          }
        })
        return (
          <div style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text3)', marginBottom: 4 }}>Recent form — last {recent.length} matches</div>
            <FormSparkline data={formData} colours={FORM_COLOURS} labels={FORM_LABELS} onSelect={fid => navigate(`/match/${fid}`)} />
          </div>
        )
      })()}

      {allMatches.length === 0 ? (
        <div className="card">
          <div className="empty">{hasFilter
            ? 'No matches for the selected filters.'
            : 'No matches yet for your team — check back later or contact your team admin.'
          }</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No matches for the selected filters.</div></div>
      ) : (
        <div className="match-list">
          {filtered.map(m => {
            const isManual = m.total_deliveries === 0 && m.manual_runs !== null
            return (
              <div key={m.fixture_id} className="match-card" onClick={() => navigate(`/match/${m.fixture_id}`)}>
                <div>
                  <div className="match-teams">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                      <span style={{ fontWeight: isWhccTeam(m.home_team) ? 700 : 400 }}>{shortTeam(m.home_team) || 'Home'}</span>
                      {' '}<span className="dim">vs</span>{' '}
                      <span style={{ fontWeight: isWhccTeam(m.away_team) ? 700 : 400 }}>{shortTeam(m.away_team) || 'Away'}</span>
                    </div>
                  </div>
                  <div className="match-meta">
                    {m.match_date && <span>{formatDate(m.match_date)}</span>}
                    {m.ground && <span> · {m.ground}</span>}
                  </div>
                  {/* #lizard forgive */}
                  {(() => {
                    const bat = isManual ? m.manual_top_bat : m.ing_top_bat
                    const batR = isManual ? m.manual_top_bat_runs : m.ing_top_bat_runs
                    const batB = isManual ? m.manual_top_bat_balls : m.ing_top_bat_balls
                    const bowl = isManual ? m.manual_top_bowl : m.ing_top_bowl
                    const bowlW = isManual ? m.manual_top_bowl_wkts : m.ing_top_bowl_wkts
                    const bowlR = isManual ? m.manual_top_bowl_runs : m.ing_top_bowl_runs
                    if (!bat && !bowl && !m.ing_top_mvp) return null
                    const iconStyle = { verticalAlign: 'middle', marginRight: 3, marginBottom: 1 }
                    return (
                      <div className="match-meta" style={{ marginTop: '0.1rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 0.6rem' }}>
                        {bat && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <img src="/cricket-bat.png" style={{ width: 13, height: 13, objectFit: 'contain', ...iconStyle }} alt="" />
                          {dn(bat)} {batR}{batB ? ` (${batB}b)` : ''}
                        </span>}
                        {bowl && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--hotpink)', marginRight: 5, flexShrink: 0 }} />
                          {dn(bowl)} {bowlW}/{bowlR}
                        </span>}
                        {m.ing_top_mvp && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Trophy size={12} color="#f9a825" style={iconStyle} />
                          {dn(m.ing_top_mvp)} <span style={{ color: 'var(--text3)', marginLeft: 2 }}>{m.ing_top_mvp_pts}pts</span>
                        </span>}
                      </div>
                    )
                  })()}
                </div>
                <div className="match-score">
                  {isManual ? (() => {
                    const isPairs = m.format === 'pairs'
                    const ss = m.starting_score || (isPairs ? 200 : 0)
                    const rawWr = m.manual_runs, rawOr = m.manual_opp_runs
                    if (rawWr === null) return null
                    const wr = isPairs ? ss + rawWr - (m.manual_wkts || 0) * 5 : rawWr
                    const or = rawOr !== null ? (isPairs ? ss + rawOr - (m.manual_bowl_wkts || 0) * 5 : rawOr) : null
                    const won = or !== null && wr > or, lost = or !== null && wr < or
                    const diff = Math.abs(wr - (or ?? 0))
                    const whccTeam = shortTeam(isWhccTeam(m.home_team) ? m.home_team : m.away_team)
                    const label = or === null ? null
                      : won  ? `${whccTeam} won by ${diff} run${isPairs ? 's (net)' : diff === 1 ? '' : 's'}`
                      : lost ? `${whccTeam} lost by ${diff} run${isPairs ? 's (net)' : diff === 1 ? '' : 's'}`
                      : 'Tied'
                    return (
                      <div className="match-score-inner">
                        {label && <span className={`tag ${won ? 'tag-green' : lost ? 'tag-red' : ''}`}>{label}</span>}
                        <div className="dim">
                          <span style={{ fontWeight: won ? 700 : undefined }}>
                            {isPairs ? wr : `${rawWr}/${m.manual_wkts}`}{m.manual_whcc_overs ? ` (${m.manual_whcc_overs} ov)` : ''}
                          </span>
                          {or !== null && <span style={{ marginLeft: '0.75rem', fontWeight: lost ? 700 : undefined }}>
                            {isPairs ? or : `${rawOr}/${m.manual_bowl_wkts ?? 0}`}{m.manual_opp_overs ? ` (${m.manual_opp_overs} ov)` : ''}
                          </span>}
                        </div>
                      </div>
                    )
                  })() : (() => {
                    const phrase = computeResultPhrase(m)
                    const lower = (phrase || '').toLowerCase()
                    // "won by N"/"lost by N" → WHCC-relative computed phrase; "<team> - Won"
                    // → raw result naming the winner, so colour by whether WHCC is that winner.
                    const cls = lower.includes(' won ') ? 'tag-green'
                      : lower.includes(' lost ') ? 'tag-red'
                      : /\bwon\b/.test(lower) ? (isWhccTeam(phrase) ? 'tag-green' : 'tag-red')
                      : ''
                    const s1 = formatScore(m.away_score, m.away_wickets, m.away_overs, m.format, m.starting_score)
                    const s2 = formatScore(m.home_score, m.home_wickets, m.home_overs, m.format, m.starting_score)
                    const hr = parseInt(m.home_score), ar = parseInt(m.away_score)
                    const s1Bold = !isNaN(ar) && !isNaN(hr) && ar > hr
                    const s2Bold = !isNaN(hr) && !isNaN(ar) && hr > ar
                    return (
                      <div className="match-score-inner">
                        {phrase && <span className={`tag ${cls}`}>{phrase}</span>}
                        {(s1 || s2) && <div className="dim">
                          {s1 && <span style={{ fontWeight: s1Bold ? 700 : undefined }}>{s1}</span>}
                          {s2 && <span style={{ marginLeft: '0.75rem', fontWeight: s2Bold ? 700 : undefined }}>{s2}</span>}
                        </div>}
                      </div>
                    )
                  })()}
                  <div className="match-tags">
                    {m.competition && (
                      <span className="tag tag-meta" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>
                        {m.competition.includes('Cup') ? 'Cup' : m.competition === 'Friendly' ? 'Friendly' : 'League'}
                      </span>
                    )}
                    {isManual && <span className="tag tag-orange" style={{ fontSize: '0.68rem', padding: '1px 6px' }}>Manual</span>}
                    {m.format === 'pairs' && <span className="tag" style={{ fontSize: '0.68rem', padding: '1px 6px', background: 'var(--blue-bg)', color: 'var(--blue)' }}>Pairs</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canLoadMore && (
        <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
          <button onClick={handleLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
