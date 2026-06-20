import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'

const STORAGE_KEY = 'pendingInviteToken'

export function storeInviteToken(token) {
  try {
    sessionStorage.setItem(STORAGE_KEY, token)
  } catch {}
}

export function consumeInviteToken() {
  try {
    const t = sessionStorage.getItem(STORAGE_KEY)
    sessionStorage.removeItem(STORAGE_KEY)
    return t
  } catch {
    return null
  }
}

export default function InvitePage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { isSignedIn, isLoaded } = useUser()
  const token = params.get('token')
  const [club, setClub] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) {
      setError('No invite token found in this link.')
      return
    }

    fetch(`/api/invites/validate/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error)
          return
        }
        setClub(d)
        storeInviteToken(token)
      })
      .catch(() => setError('Could not validate invite. Try again.'))
  }, [token])

  useEffect(() => {
    // Once signed in and club is loaded, navigate home — App.jsx will redeem
    if (isLoaded && isSignedIn && club) navigate('/', { replace: true })
  }, [isLoaded, isSignedIn, club, navigate])

  if (error) {
    return (
      <div style={centreStyle}>
        <div className="card" style={cardStyle}>
          <h2 style={headingStyle}>Invalid invite</h2>
          <p style={{ color: 'var(--text2)', fontSize: '0.9rem' }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!club) {
    return (
      <div style={centreStyle}>
        <p style={{ color: 'var(--text2)' }}>Validating invite…</p>
      </div>
    )
  }

  const navBg = club.primaryColour ?? '#1a1a1a'

  return (
    <div style={centreStyle}>
      <div className="card" style={cardStyle}>
        <div
          style={{
            background: navBg,
            borderRadius: '6px 6px 0 0',
            margin: '-1rem -1rem 1rem',
            padding: '1rem',
            textAlign: 'center'
          }}
        >
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '1.1rem' }}>
            {club.appName || club.clubName}
          </span>
        </div>
        <h2 style={headingStyle}>You've been invited</h2>
        <p style={{ color: 'var(--text2)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
          Join <strong>{club.clubName}</strong> on {club.appName || 'Edge XI'}.
          {isSignedIn
            ? ' You are already signed in — joining now…'
            : ' Sign in or create an account to continue.'}
        </p>
        {!isSignedIn && (
          <a
            href={`/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`}
            style={{
              display: 'inline-block',
              background: navBg,
              color: '#fff',
              padding: '0.55rem 1.4rem',
              borderRadius: 6,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9rem'
            }}
          >
            Sign in / Create account
          </a>
        )}
      </div>
    </div>
  )
}

const centreStyle = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '1rem'
}

const cardStyle = {
  maxWidth: 400,
  width: '100%',
  padding: '1rem'
}

const headingStyle = {
  fontSize: '1.1rem',
  fontWeight: 700,
  marginBottom: '0.5rem'
}
