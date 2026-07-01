import { useState, useEffect, useMemo, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, Navigate, useLocation, Link } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react'
import { BarChart2, Moon, Sun, Menu, X } from 'lucide-react'
import { setPlayerNames, setOurMarkers, setNameFormat } from './utils/cricket'
import { setJerseyDisplay } from './components/JerseyIcon'
import { useApiFetch } from './hooks/useApiFetch'
import { GroupContext } from './GroupContext'
import MatchList from './pages/MatchList'
import Season from './pages/Season'
import Notifications from './pages/Notifications'
import Changelog from './pages/Changelog'
import InvitePage, { consumeInviteToken } from './pages/InvitePage'
import RequestAccessPage from './pages/RequestAccessPage'
import { Skeleton } from './components/Skeleton'

const MatchDetail = lazy(() => import('./pages/MatchDetail'))
const Admin = lazy(() => import('./pages/Admin'))
const ManualEntry = lazy(() => import('./pages/ManualEntry'))
const BallEntry = lazy(() => import('./pages/BallEntry'))
const PlayerList = lazy(() => import('./pages/PlayerList'))
const PlayerDetail = lazy(() => import('./pages/PlayerDetail'))

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

// WHCC base hue (~337°) used to compute offset for icon hue-rotate
function hexToHue(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min
  if (d === 0) return 0
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return Math.round(h * 60)
}
const ICON_BASE_HUE = 337

function injectClubColors(primaryColour, secondaryColour, kitColour) {
  const root = document.documentElement
  if (primaryColour) {
    root.style.setProperty('--nav-bg', primaryColour)
    root.style.setProperty('--nav-dim', 'rgba(255,255,255,0.65)')
    root.style.setProperty('--toss-primary-bg', primaryColour)
    const hue = hexToHue(primaryColour)
    if (hue !== null) {
      const rotate = (((hue - ICON_BASE_HUE) % 360) + 360) % 360
      root.style.setProperty('--icon-hue-rotate', `${rotate}deg`)
    }
  }
  if (secondaryColour) root.style.setProperty('--secondary-colour', secondaryColour)
  if (kitColour) root.style.setProperty('--kit-colour', kitColour)
  else root.style.removeProperty('--kit-colour')
}

function AppRoutes({ hasAccess, canUpload, canAdmin }) {
  return (
    <Routes>
      <Route path="/" element={hasAccess ? <MatchList /> : <RequestAccessPage />} />
      <Route
        path="/match/:id"
        element={hasAccess ? <MatchDetail /> : <Navigate to="/" replace />}
      />
      <Route path="/players" element={hasAccess ? <PlayerList /> : <Navigate to="/" replace />} />
      <Route
        path="/player/:id"
        element={hasAccess ? <PlayerDetail /> : <Navigate to="/" replace />}
      />
      <Route path="/season" element={hasAccess ? <Season /> : <Navigate to="/" replace />} />
      <Route path="/notifications" element={<Notifications />} />
      <Route
        path="/admin"
        element={canUpload || canAdmin ? <Admin /> : <Navigate to="/" replace />}
      />
      <Route path="/ingest" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/users" element={<Navigate to="/admin" replace />} />
      <Route path="/manual" element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />} />
      <Route
        path="/manual/:fixtureId"
        element={canUpload ? <ManualEntry /> : <Navigate to="/" replace />}
      />
      <Route path="/ball-entry" element={canUpload ? <BallEntry /> : <Navigate to="/" replace />} />
      <Route
        path="/ball-entry/:fixtureId"
        element={canUpload ? <BallEntry /> : <Navigate to="/" replace />}
      />
    </Routes>
  )
}

export default function App() {
  const [dark, setDark] = useState(getInitialDark)
  const [clubName, setClubName] = useState('Edge XI')
  const [playCricketDomain, setPlayCricketDomain] = useState(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [myGroups, setMyGroups] = useState([])
  const [selectedGroups, setSelectedGroups] = useState(null) // null = use defaults (favourites or all)
  const [jerseyDisplay, setJerseyDisplayState] = useState('both')
  const [showOppositionScorecard, setShowOppositionScorecard] = useState(false)
  const [showMvp, setShowMvp] = useState(true)
  const { user } = useUser()
  const apiFetch = useApiFetch()
  const userId = user?.id
  const { pathname } = useLocation()

  const canUpload = user?.publicMetadata?.canUpload === true
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const isClubAdmin = user?.publicMetadata?.isClubAdmin === true
  const canAdmin = isSuperAdmin || isClubAdmin
  const groups = user?.publicMetadata?.accessGroups ?? []
  const hasAccess = isSuperAdmin || isClubAdmin || canUpload || groups.length > 0

  const groupCtx = useMemo(
    () => ({
      myGroups,
      playCricketDomain,
      selectedGroups,
      setSelectedGroups,
      jerseyDisplay,
      showOppositionScorecard,
      showMvp
    }),
    [myGroups, playCricketDomain, selectedGroups, jerseyDisplay, showOppositionScorecard, showMvp]
  )

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
          injectClubColors(cfg.primaryColour, cfg.secondaryColour, cfg.kitColour)
          if (cfg.name) {
            document.title = cfg.name
            setClubName(cfg.name)
          }
          if (cfg.playCricketDomain) setPlayCricketDomain(cfg.playCricketDomain)
          if (cfg.nameMarkers) setOurMarkers(cfg.nameMarkers)
          setNameFormat(cfg.nameFormat)
          setJerseyDisplay(cfg.jerseyDisplay)
          if (cfg.jerseyDisplay) setJerseyDisplayState(cfg.jerseyDisplay)
          setShowOppositionScorecard(cfg.showOppositionScorecard ?? false)
          setShowMvp(cfg.showMvp ?? true)
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

  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  const [latestVersion, setLatestVersion] = useState(null)

  useEffect(() => {
    fetch('/api/changelog/latest', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.version) setLatestVersion(d.version)
      })
      .catch(() => {})
  }, [])

  const isInvitePage = pathname === '/invite'

  return (
    <GroupContext.Provider value={groupCtx}>
      <>
        {!isInvitePage && (
          <nav>
            <span className="brand">
              <BarChart2
                size={16}
                style={{ verticalAlign: 'middle', marginRight: 6, marginTop: -4 }}
              />
              {clubName}
            </span>

            {/* Inline links — hidden on mobile */}
            <div className="nav-links">
              {hasAccess && (
                <NavLink to="/" end onClick={closeMenu}>
                  Matches
                </NavLink>
              )}
              {hasAccess && (
                <NavLink to="/players" onClick={closeMenu}>
                  Players
                </NavLink>
              )}
              {hasAccess && (
                <NavLink to="/season" onClick={closeMenu}>
                  Season
                </NavLink>
              )}
              {hasAccess && (
                <NavLink to="/notifications" style={{ position: 'relative' }} onClick={closeMenu}>
                  Notifications
                  {unreadNotifications > 0 && (
                    <span className="nav-badge">
                      {unreadNotifications > 9 ? '9+' : unreadNotifications}
                    </span>
                  )}
                </NavLink>
              )}
              {(canUpload || canAdmin) && (
                <NavLink to="/admin" style={{ position: 'relative' }} onClick={closeMenu}>
                  Admin
                  {pendingCount > 0 && (
                    <span className="nav-badge">{pendingCount > 9 ? '9+' : pendingCount}</span>
                  )}
                </NavLink>
              )}
              <NavLink to="/changelog" className="nav-changelog" onClick={closeMenu}>
                What&rsquo;s new
              </NavLink>
            </div>

            {/* Right-side controls */}
            <div className="nav-right">
              <span
                className="nav-theme-icon"
                aria-hidden="true"
                style={{ color: 'var(--nav-dim)', display: 'flex', alignItems: 'center' }}
              >
                {dark ? <Moon size={14} /> : <Sun size={14} />}
              </span>
              <label className="toggle nav-theme-toggle">
                <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
                <span className="toggle-slider" />
              </label>
              <SignedIn>
                <UserButton />
              </SignedIn>
              <button
                className="hamburger-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              >
                {menuOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>

            {/* Mobile dropdown — portal-less, positioned below nav */}
            {menuOpen && (
              <>
                <div className="mobile-nav-overlay" onClick={closeMenu} />
                <div className="mobile-menu">
                  {hasAccess && (
                    <NavLink to="/" end onClick={closeMenu}>
                      Matches
                    </NavLink>
                  )}
                  {hasAccess && (
                    <NavLink to="/players" onClick={closeMenu}>
                      Players
                    </NavLink>
                  )}
                  {hasAccess && (
                    <NavLink to="/season" onClick={closeMenu}>
                      Season
                    </NavLink>
                  )}
                  {hasAccess && (
                    <NavLink
                      to="/notifications"
                      onClick={closeMenu}
                      style={{ position: 'relative' }}
                    >
                      Notifications
                      {unreadNotifications > 0 && (
                        <span className="nav-badge mobile-badge">
                          {unreadNotifications > 9 ? '9+' : unreadNotifications}
                        </span>
                      )}
                    </NavLink>
                  )}
                  {(canUpload || canAdmin) && (
                    <NavLink to="/admin" onClick={closeMenu} style={{ position: 'relative' }}>
                      Admin
                      {pendingCount > 0 && (
                        <span className="nav-badge mobile-badge">
                          {pendingCount > 9 ? '9+' : pendingCount}
                        </span>
                      )}
                    </NavLink>
                  )}
                  <NavLink to="/changelog" onClick={closeMenu}>
                    What&rsquo;s new
                  </NavLink>
                  <hr className="mobile-menu-divider" />
                  <div className="mobile-menu-theme">
                    <span
                      aria-hidden="true"
                      style={{ display: 'flex', alignItems: 'center', color: 'var(--nav-dim)' }}
                    >
                      {dark ? <Moon size={14} /> : <Sun size={14} />}
                    </span>
                    <span>Dark mode</span>
                    <label className="toggle">
                      <input
                        type="checkbox"
                        checked={dark}
                        onChange={(e) => setDark(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                </div>
              </>
            )}
          </nav>
        )}
        {/* Public routes — no auth required */}
        <Routes>
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/changelog" element={<Changelog />} />
        </Routes>
        <SignedIn>
          <Suspense fallback={<PageFallback />}>
            <AppRoutes hasAccess={hasAccess} canUpload={canUpload} canAdmin={canAdmin} />
          </Suspense>
        </SignedIn>
        <SignedOut>
          {pathname !== '/invite' && pathname !== '/changelog' && <RedirectToSignIn />}
        </SignedOut>
        {!isInvitePage && (
          <footer
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              padding: '1.5rem 1rem',
              borderTop: '1px solid var(--border)',
              marginTop: '2rem'
            }}
          >
            {latestVersion && (
              <Link
                to="/changelog"
                style={{
                  fontSize: 12,
                  color: 'var(--muted)',
                  textDecoration: 'none',
                  padding: '3px 10px',
                  borderRadius: 20,
                  border: '1px solid var(--border)'
                }}
              >
                {latestVersion}
              </Link>
            )}
            <a
              href="https://www.flaticon.com"
              target="_blank"
              rel="noopener noreferrer"
              className="tooltip"
              data-tip="Kiranshastry, FACH, Candy Design, Maniprasanth, redempticon, Freepik, Amethyst prime, andinur – Flaticon"
              style={{ fontSize: 11, color: 'var(--muted)', textDecoration: 'none', opacity: 0.6 }}
            >
              Icons
            </a>
          </footer>
        )}
      </>
    </GroupContext.Provider>
  )
}
