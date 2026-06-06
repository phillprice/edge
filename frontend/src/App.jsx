import { useState, useEffect, useMemo } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react'
import { BarChart2, Moon, Sun } from 'lucide-react'
import { setPlayerNames } from './utils/cricket'
import { useApiFetch } from './hooks/useApiFetch'
import { GroupContext } from './GroupContext'
import MatchList     from './pages/MatchList'
import MatchDetail   from './pages/MatchDetail'
import PlayerList    from './pages/PlayerList'
import PlayerDetail  from './pages/PlayerDetail'
import Admin         from './pages/Admin'
import ManualEntry   from './pages/ManualEntry'
import BallEntry     from './pages/BallEntry'
import Season        from './pages/Season'
import Notifications from './pages/Notifications'

function getInitialDark() {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [dark, setDark]               = useState(getInitialDark)
  const [pendingCount, setPendingCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [myGroups, setMyGroups]         = useState([])
  const { user } = useUser()
  const apiFetch = useApiFetch()

  const canUpload    = user?.publicMetadata?.canUpload    === true
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const isClubAdmin  = user?.publicMetadata?.isClubAdmin  === true
  const canAdmin     = isSuperAdmin || isClubAdmin
  const groups       = user?.publicMetadata?.accessGroups ?? []
  const hasAccess    = isSuperAdmin || groups.length > 0

  const groupCtx = useMemo(() => ({ myGroups }), [myGroups])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    fetch('/api/players/names', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPlayerNames)
      .catch(() => {})
  }, [])

  // Load this user's access groups with labels (for group-based filtering)
  useEffect(() => {
    if (!user) return
    apiFetch('/api/access-requests/my-groups')
      .then(r => r.ok ? r.json() : [])
      .then(setMyGroups)
      .catch(() => {})
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load pending request count for badge (admins only)
  useEffect(() => {
    if (!user || !canAdmin) return
    apiFetch('/api/access-requests/count')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => setPendingCount(d.count ?? 0))
      .catch(() => {})
  }, [user?.id, canAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load unread notification count
  useEffect(() => {
    if (!user) return
    apiFetch('/api/notifications/unread-count')
      .then(r => r.ok ? r.json() : { count: 0 })
      .then(d => setUnreadNotifications(d.count ?? 0))
      .catch(() => {})
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GroupContext.Provider value={groupCtx}>
    <>
      <nav>
        <span className="brand"><BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />EDGE</span>
        {hasAccess && <NavLink to="/" end>Matches</NavLink>}
        {hasAccess && <NavLink to="/players">Players</NavLink>}
        {hasAccess && <NavLink to="/season">Season</NavLink>}
        <NavLink to="/notifications" style={{ position: 'relative' }}>
          Notifications
          {unreadNotifications > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -8,
              background: 'var(--hotpink)', color: '#fff',
              borderRadius: '50%', width: 16, height: 16,
              fontSize: '0.65rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</span>
          )}
        </NavLink>
        {(canUpload || canAdmin) && (
          <NavLink to="/admin" style={{ position: 'relative' }}>
            Admin
            {pendingCount > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -8,
                background: 'var(--hotpink)', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.65rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{pendingCount > 9 ? '9+' : pendingCount}</span>
            )}
          </NavLink>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--nav-dim)', display: 'flex', alignItems: 'center' }}>{dark ? <Moon size={14} /> : <Sun size={14} />}</span>
          <label className="toggle">
            <input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
          <SignedIn><UserButton /></SignedIn>
        </div>
      </nav>
      <SignedIn>
        <Routes>
          <Route path="/"              element={hasAccess ? <MatchList />   : <div className="page"><div className="empty">You don&rsquo;t have access yet — contact your team admin.</div></div>} />
          <Route path="/match/:id"     element={hasAccess ? <MatchDetail /> : <Navigate to="/" replace />} />
          <Route path="/players"       element={hasAccess ? <PlayerList />  : <Navigate to="/" replace />} />
          <Route path="/player/:id"    element={hasAccess ? <PlayerDetail /> : <Navigate to="/" replace />} />
          <Route path="/season"        element={hasAccess ? <Season />      : <Navigate to="/" replace />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/admin"             element={(canUpload || canAdmin) ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="/ingest"            element={<Navigate to="/admin" replace />} />
          <Route path="/admin/users"       element={<Navigate to="/admin" replace />} />
          <Route path="/manual"            element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />} />
          <Route path="/manual/:fixtureId" element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />} />
          <Route path="/ball-entry"            element={canUpload ? <BallEntry />   : <Navigate to="/" replace />} />
          <Route path="/ball-entry/:fixtureId" element={canUpload ? <BallEntry />   : <Navigate to="/" replace />} />
        </Routes>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <footer className="app-footer">
        Enhanced Data for Game Evolution
        <span style={{ marginLeft: '1rem', fontSize: '0.7rem', opacity: 0.6 }}>
          {'Icons by '}
          <a href="https://www.flaticon.com/free-icons/bat" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Kiranshastry</a>
          {', '}
          <a href="https://www.flaticon.com/authors/fach" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>FACH</a>
          {', '}
          <a href="https://www.flaticon.com/authors/candy-design" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Candy Design</a>
          {', '}
          <a href="https://www.flaticon.com/authors/maniprasanth" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Maniprasanth</a>
          {', '}
          <a href="https://www.flaticon.com/free-icons/coin" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>redempticon</a>
          {', '}
          <a href="https://www.freepik.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Freepik</a>
          {', '}
          <a href="https://www.flaticon.com/authors/amethyst-prime" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Amethyst prime</a>
          {', '}
          <a href="https://www.flaticon.com/authors/andinur" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>andinur</a>
          {' – '}
          <a href="https://www.flaticon.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Flaticon</a>
        </span>
      </footer>
    </>
    </GroupContext.Provider>
  )
}
