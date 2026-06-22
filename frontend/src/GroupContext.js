import { createContext, useContext } from 'react'

// myGroups: [{ team_id, season_id, label, year, display }] | []
// playCricketDomain: string | null
// selectedGroups: [{team_id, season_id}] | null  (null = "use defaults / unset")
// setSelectedGroups: (pairs | null) => void
export const GroupContext = createContext({
  myGroups: [],
  playCricketDomain: null,
  selectedGroups: null,
  setSelectedGroups: () => {}
})
export const useGroups = () => useContext(GroupContext)
