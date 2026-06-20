import { createContext, useContext } from 'react'

// myGroups: [{ team_id, season_id, label, year, display }] | []
// playCricketDomain: string | null
export const GroupContext = createContext({ myGroups: [], playCricketDomain: null })
export const useGroups = () => useContext(GroupContext)
