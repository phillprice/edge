import { useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, RedirectToSignIn, UserButton, useUser } from '@clerk/clerk-react'
import { BarChart2, Moon, Sun } from 'lucide-react'
import { setPlayerNames } from './utils/cricket'
import MatchList   from './pages/MatchList'
import MatchDetail from './pages/MatchDetail'
import PlayerList  from './pages/PlayerList'
import PlayerDetail from './pages/PlayerDetail'
import Ingest      from './pages/Ingest'
import ManualEntry from './pages/ManualEntry'
import Season      from './pages/Season'

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

  useEffect(() => {
    fetch('/api/players/names', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPlayerNames)
      .catch(() => {})
  }, [])

  return (
    <>
      <nav>
        <span className="brand"><BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />EDGE</span>
        <NavLink to="/" end>Matches</NavLink>
        <NavLink to="/players">Players</NavLink>
        <NavLink to="/season">Season</NavLink>
        {canUpload && <NavLink to="/ingest">Upload</NavLink>}
        {canUpload && <NavLink to="/manual">Manual entry</NavLink>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: 'var(--nav-dim)', display: 'flex', alignItems: 'center' }}>{dark ? <Moon size={14} /> : <Sun size={14} />}</span>
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
          <Route path="/season"        element={<Season />} />
          <Route path="/ingest"        element={canUpload ? <Ingest />       : <Navigate to="/" replace />} />
          <Route path="/manual"           element={canUpload ? <ManualEntry />  : <Navigate to="/" replace />} />
          <Route path="/manual/:fixtureId" element={canUpload ? <ManualEntry />  : <Navigate to="/" replace />} />
        </Routes>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <footer className="app-footer">
        Enhanced Data for Game Evolution
        <span style={{ marginLeft: '1rem', fontSize: '0.7rem', opacity: 0.6 }}>
          <a href="https://www.flaticon.com/free-icons/bat" title="bat icons" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Bat icon by Kiranshastry</a>
          {' · '}
          <a href="https://www.flaticon.com/authors/fach" title="FACH icons" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Icons by FACH</a>
          {' · '}
          <a href="https://www.flaticon.com/authors/candy-design" title="Candy Design icons" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Icons by Candy Design</a>
          {' · '}
          <a href="https://www.flaticon.com/authors/maniprasanth" title="Maniprasanth icons" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Icons by Maniprasanth</a>
          {' · '}
          <a href="https://www.flaticon.com/free-icons/coin" title="coin icons" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Coin icons by redempticon</a>
          {' · '}
          <a href="https://www.freepik.com" title="Freepik" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Runner icon by Freepik</a>
          {' – '}
          <a href="https://www.flaticon.com" title="Flaticon" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Flaticon</a>
        </span>
      </footer>
    </>
  )
}
