// Shared FilterPills option arrays for the "Type" and "Format" fixture filters,
// used identically across MatchList, PlayerList, and Season.

export const MATCH_TYPE_OPTIONS = [
  { value: 'league', label: 'League' },
  { value: 'cup', label: 'Cup' },
  { value: 'friendly', label: 'Friendly' },
  { value: 'internal', label: 'Internal' },
  { value: 'indoor', label: 'Indoor' }
]

export const FORMAT_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'no-pairs', label: 'Hide pairs' },
  { value: 'pairs', label: 'Pairs only' }
]
