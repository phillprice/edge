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

  // Parse URL param when provided (supports both 'none'/'' sentinels for empty)
  const groupsParam = searchParams ? searchParams.get('groups') : null

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
    // No URL param: shared context, fallback to defaults
    return ctxGroups !== null ? ctxGroups : defaultGroups
  }, [groupsParam, ctxGroups, defaultGroups])

  // For pill display: null/default state shows all groups active
  const pillValue = useMemo(
    () =>
      groupsParam == null && ctxGroups === null
        ? myGroups.map((g) => ({ team_id: g.team_id, season_id: g.season_id }))
        : selectedGroups,
    [groupsParam, ctxGroups, myGroups, selectedGroups]
  )

  const selectedKey = selectedGroups.map((g) => `${g.team_id}:${g.season_id}`).join(',')

  function setGroups(pairs) {
    // null = "reset to defaults"
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
    // whether the user has explicitly chosen (for badge/border styling on the button)
    isExplicit: ctxGroups !== null || groupsParam != null
  }
}
