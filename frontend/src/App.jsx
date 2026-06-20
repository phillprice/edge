import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react'
import { BarChart2, Moon, Sun } from 'lucide-react'
import { setPlayerNames } from './utils/cricket'
import { useApiFetch } from './hooks/useApiFetch'
import { GroupContext } from './GroupContext'
import MatchList from './pages/MatchList'
import PlayerList from './pages/PlayerList'
import PlayerDetail from './pages/PlayerDetail'
import Season from './pages/Season'
import Notifications from './pages/Notifications'
import InvitePage, { consumeInviteToken } from './pages/InvitePage'
import { Skeleton } from './components/Skeleton'

const MatchDetail = lazy(() => import('./pages/MatchDetail'))
const Admin = lazy(() => import('./pages/Admin'))
const ManualEntry = lazy(() => import('./pages/ManualEntry'))
const BallEntry = lazy(() => import('./pages/BallEntry'))

function PageFallback() {
  return (
    <div className="page">
      <Skeleton width="100%" height="2rem" style={{ marginBottom: '1rem' }} />
      <Skeleton width="80%" height="1.2rem" style={{ marginBottom: '0.5rem' }} />
      <Skeleton width="60%" height="1.2rem" />
    </div>
  )
}

function getInitialDark() {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [dark, setDark] = useState(getInitialDark)
  const [clubName, setClubName] = useState('Edge XI')
  const [pendingCount, setPendingCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [myGroups, setMyGroups] = useState([])
  const { user } = useUser()
  const apiFetch = useApiFetch()
  const userId = user?.id

  const canUpload = user?.publicMetadata?.canUpload === true
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const isClubAdmin = user?.publicMetadata?.isClubAdmin === true
  const canAdmin = isSuperAdmin || isClubAdmin
  const groups = user?.publicMetadata?.accessGroups ?? []
  const hasAccess = isSuperAdmin || groups.length > 0

  const groupCtx = useMemo(() => ({ myGroups }), [myGroups])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  useEffect(() => {
    fetch('/api/players/names', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPlayerNames)
      .catch(() => {})
  }, [])

  // Redeem any pending invite token stored before sign-in
  useEffect(() => {
    if (!userId) return
    const token = consumeInviteToken()
    if (!token) return
    apiFetch(`/api/invites/redeem/${token}`, { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.ok) user.reload()
      })
      .catch(() => {})
  }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load per-club branding and apply as CSS custom properties.
  // Also listens for 'club-config-updated' so ClubAdmin saves reflect immediately.
  useEffect(() => {
    if (!userId) return
    function fetchConfig() {
      apiFetch('/api/club/config')
        .then((r) => (r.ok ? r.json() : null))
        .then((cfg) => {
          if (!cfg) return
          const root = document.documentElement
          if (cfg.primaryColour) {
            root.style.setProperty('--nav-bg', cfg.primaryColour)
            root.style.setProperty('--toss-whcc-bg', cfg.primaryColour)
          }
          if (cfg.name) {
            document.title = cfg.name
            setClubName(cfg.name)
          }
        })
        .catch(() => {})
    }
    fetchConfig()
    window.addEventListener('club-config-updated', fetchConfig)
    return () => window.removeEventListener('club-config-updated', fetchConfig)
  }, [userId, apiFetch])

  // Load this user's access groups with labels (for group-based filtering)
  useEffect(() => {
    if (!userId) return
    apiFetch('/api/access-requests/my-groups')
      .then((r) => (r.ok ? r.json() : []))
      .then(setMyGroups)
      .catch(() => {})
  }, [userId, apiFetch])

  // Load pending request count for badge (admins only)
  useEffect(() => {
    if (!userId || !canAdmin) return
    apiFetch('/api/access-requests/count')
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setPendingCount(d.count ?? 0))
      .catch(() => {})
  }, [userId, canAdmin, apiFetch])

  // Load unread notification count
  useEffect(() => {
    if (!userId) return
    apiFetch('/api/notifications/unread-count')
      .then((r) => (r.ok ? r.json() : { count: 0 }))
      .then((d) => setUnreadNotifications(d.count ?? 0))
      .catch(() => {})
  }, [userId, apiFetch])

  return (
    <GroupContext.Provider value={groupCtx}>
      <>
        <nav>
          <span className="brand">
            <BarChart2
              size={16}
              style={{ verticalAlign: 'middle', marginRight: 6, marginTop: -4 }}
            />
            {clubName}
          </span>
          {hasAccess && (
            <NavLink to="/" end>
              Matches
            </NavLink>
          )}
          {hasAccess && <NavLink to="/players">Players</NavLink>}
          {hasAccess && <NavLink to="/season">Season</NavLink>}
          <NavLink to="/notifications" style={{ position: 'relative' }}>
            Notifications
            {unreadNotifications > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -8,
                  background: 'var(--hotpink)',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 16,
                  height: 16,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </span>
            )}
          </NavLink>
          {(canUpload || canAdmin) && (
            <NavLink to="/admin" style={{ position: 'relative' }}>
              Admin
              {pendingCount > 0 && (
                <span
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    background: 'var(--hotpink)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 16,
                    height: 16,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </NavLink>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--nav-dim)', display: 'flex', alignItems: 'center' }}>
              {dark ? <Moon size={14} /> : <Sun size={14} />}
            </span>
            <label className="toggle">
              <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
              <span className="toggle-slider" />
            </label>
            <SignedIn>
              <UserButton />
            </SignedIn>
          </div>
        </nav>
        {/* /invite is public — must sit outside SignedIn so unauthenticated users see it */}
        <Routes>
          <Route path="/invite" element={<InvitePage />} />
        </Routes>
        <SignedIn>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route
                path="/"
                element={
                  hasAccess ? (
                    <MatchList />
                  ) : (
                    <div className="page">
                      <div className="empty">
                        You don&rsquo;t have access yet — contact your team admin.
                      </div>
                    </div>
                  )
                }
              />
              <Route
                path="/match/:id"
                element={hasAccess ? <MatchDetail /> : <Navigate to="/" replace />}
              />
              <Route
                path="/players"
                element={hasAccess ? <PlayerList /> : <Navigate to="/" replace />}
              />
              <Route
                path="/player/:id"
                element={hasAccess ? <PlayerDetail /> : <Navigate to="/" replace />}
              />
              <Route
                path="/season"
                element={hasAccess ? <Season /> : <Navigate to="/" replace />}
              />
              <Route path="/notifications" element={<Notifications />} />
              <Route
                path="/admin"
                element={canUpload || canAdmin ? <Admin /> : <Navigate to="/" replace />}
              />
              <Route path="/ingest" element={<Navigate to="/admin" replace />} />
              <Route path="/admin/users" element={<Navigate to="/admin" replace />} />
              <Route
                path="/manual"
                element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />}
              />
              <Route
                path="/manual/:fixtureId"
                element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />}
              />
              <Route
                path="/ball-entry"
                element={canUpload ? <BallEntry /> : <Navigate to="/" replace />}
              />
              <Route
                path="/ball-entry/:fixtureId"
                element={canUpload ? <BallEntry /> : <Navigate to="/" replace />}
              />
            </Routes>
          </Suspense>
        </SignedIn>
        <SignedOut>
          <RedirectToSignIn />
        </SignedOut>
      </>
    </GroupContext.Provider>
  )
}
