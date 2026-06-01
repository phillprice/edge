import { createContext, useContext } from 'react'
import { isWhccTeam } from './utils/cricket'

export const ClubContext = createContext({
  clubConfig: null,
  isMyTeam: isWhccTeam,
})

export function useClub() {
  return useContext(ClubContext)
}
