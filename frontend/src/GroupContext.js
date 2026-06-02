import { createContext, useContext } from 'react'

// myGroups: [{ team_id, season_id, label, year, display }] | []
export const GroupContext = createContext({ myGroups: [] })
export const useGroups = () => useContext(GroupContext)
