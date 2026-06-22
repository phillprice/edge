import { useMemo } from 'react'
import { useGroups } from '../GroupContext'
import { useFavouriteGroups } from './useFavouriteGroups'

/**
 * Unified team-group selection hook used by PlayerList, MatchList, and Admin PlayersTab.
 *
 * Pages with URL params pass { searchParams, setSearchParams } so the selection is
 * also bookmarkable. Admin pages omit them and get shared-context state only.
 *
 * Shared context (GroupContext.selectedGroups) persists the selection while the user
 * navigates between pages, so MatchList and PlayerList always start on the same teams.
 *
 * selectedGroups semantics:
 *   null  → use defaults (favourites if set, otherwise all)
 *   []    → explicitly none
 *   [...] → explicit subset
 *
 * selectedKey semantics:
 *   null  → explicitly none — callers should show empty results
 *   ''    → all groups (default / loading state — no groups filter applied)
 *   '...' → comma-joined "team_id:season_id" pairs for the explicit subset
 */
export function useGroupFilter({ searchParams, setSearchParams } = {}) {
  const { myGroups, selectedGroups: ctxGroups, setSelectedGroups: setCtxGroups } = useGroups()
  const { favourites, toggleFavourite } = useFavouriteGroups(myGroups)

  const defaultGroups = useMemo(
    () =>
      favourites.length
        ? favourites
        : myGroups.map((g) => ({ team_id: g.team_id, season_id: g.season_id })),
    [favourites, myGroups]
  )

  const groupsParam = searchParams ? searchParams.get('groups') : null

  // true when the user has made an explicit choice (vs. still on defaults)
  const isExplicit = ctxGroups !== null || groupsParam != null

  const selectedGroups = useMemo(() => {
    if (groupsParam === 'none' || groupsParam === '') return []
    if (groupsParam) {
      return groupsParam
        .split(',')
        .filter(Boolean)
        .map((tok) => {
          const [t, s] = tok.split(':').map(Number)
          return { team_id: t, season_id: s }
        })
    }
    return ctxGroups !== null ? ctxGroups : defaultGroups
  }, [groupsParam, ctxGroups, defaultGroups])

  // Pills show defaultGroups (favourites or all) in the default state so the
  // active pills match what's actually being fetched. Explicit selections show
  // the exact set the user chose.
  const pillValue = useMemo(
    () => (isExplicit ? selectedGroups : defaultGroups),
    [isExplicit, selectedGroups, defaultGroups]
  )

  // null  → explicitly none (callers must short-circuit and show empty)
  // ''    → all groups / loading state (no groups filter — backend returns all)
  // '...' → comma-joined subset
  const selectedKey =
    isExplicit && selectedGroups.length === 0
      ? null
      : selectedGroups.map((g) => `${g.team_id}:${g.season_id}`).join(',')

  function setGroups(pairs) {
    setCtxGroups(pairs)

    if (setSearchParams) {
      const next = new URLSearchParams(searchParams)
      if (pairs === null) {
        next.delete('groups')
      } else if (pairs.length === 0) {
        next.set('groups', 'none')
      } else {
        next.set('groups', pairs.map((g) => `${g.team_id}:${g.season_id}`).join(','))
      }
      setSearchParams(next, { replace: true })
    }
  }

  return {
    myGroups,
    favourites,
    toggleFavourite,
    defaultGroups,
    selectedGroups,
    selectedKey,
    pillValue,
    setGroups,
    isExplicit
  }
}
