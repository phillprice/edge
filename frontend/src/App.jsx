import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react'
import MatchList   from './pages/MatchList'
import MatchDetail from './pages/MatchDetail'
import PlayerList  from './pages/PlayerList'
import PlayerDetail from './pages/PlayerDetail'
import Ingest      from './pages/Ingest'
import ManualEntry from './pages/ManualEntry'

function getInitialDark() {
  const stored = localStorage.getItem('theme')
  if (stored) return stored === 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export default function App() {
  const [dark, setDark] = useState(getInitialDark)
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  return (
    <>
      <nav>
        <span className="brand">🏏 EDGE <span className="brand-sub">Enhanced Data for Game Evolution</span></span>
        <NavLink to="/" end>Matches</NavLink>
        <NavLink to="/players">Players</NavLink>
        {canUpload && <NavLink to="/ingest">Upload</NavLink>}
        {canUpload && <NavLink to="/manual">Manual entry</NavLink>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--nav-dim)' }}>{dark ? '🌙' : '☀️'}</span>
          <label className="toggle">
            <input type="checkbox" checked={dark} onChange={e => setDark(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </div>
      </nav>
      <SignedIn>
        <Routes>
          <Route path="/"              element={<MatchList />} />
          <Route path="/match/:id"     element={<MatchDetail />} />
          <Route path="/players"       element={<PlayerList />} />
          <Route path="/player/:id"    element={<PlayerDetail />} />
          <Route path="/ingest"        element={canUpload ? <Ingest />       : <Navigate to="/" replace />} />
          <Route path="/manual"        element={canUpload ? <ManualEntry />  : <Navigate to="/" replace />} />
        </Routes>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}
