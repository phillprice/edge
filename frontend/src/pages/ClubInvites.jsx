import { useState, useEffect } from 'react'
import { Link, Copy, Trash2 } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function InviteRow({ inv, copied, onCopy, onRevoke }) {
  const url = `${window.location.origin}/invite?token=${inv.token}`
  const daysLeft = Math.ceil((new Date(inv.expiresAt) - Date.now()) / MS_PER_DAY)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <code
        style={{
          fontSize: '0.75rem',
          color: 'var(--text3)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {url}
      </code>
      <span style={{ fontSize: '0.72rem', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
        {daysLeft}d
      </span>
      <button
        onClick={() => onCopy(inv.token)}
        style={{
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 7px'
        }}
      >
        <Copy size={11} />
        {copied === inv.token ? 'Copied!' : 'Copy'}
      </button>
      <button
        onClick={() => onRevoke(inv.token)}
        className="secondary"
        style={{
          fontSize: '0.75rem',
          padding: '1px 6px',
          color: 'var(--red)',
          borderColor: 'var(--red)'
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

export default function ClubInvites({ clubId }) {
  const apiFetch = useApiFetch()
  const [invites, setInvites] = useState([])
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(null)

  async function load() {
    const r = await apiFetch(`/api/admin/invites?clubId=${clubId}`)
    if (r.ok)
      setInvites((await r.json()).filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date()))
  }

  async function generate() {
    setGenerating(true)
    const r = await apiFetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clubId })
    })
    if (r.ok) await load()
    setGenerating(false)
  }

  async function revoke(token) {
    await apiFetch(`/api/admin/invites/${token}`, { method: 'DELETE' })
    await load()
  }

  function copyLink(token) {
    navigator.clipboard.writeText(`${window.location.origin}/invite?token=${token}`)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  useEffect(() => {
    load()
  }, [clubId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: invites.length ? '0.5rem' : 0
        }}
      >
        <span style={{ fontSize: '0.78rem', color: 'var(--text2)', flex: 1 }}>Invite links</span>
        <button
          onClick={generate}
          disabled={generating}
          style={{
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px'
          }}
        >
          <Link size={12} />
          {generating ? 'Generating…' : 'New link'}
        </button>
      </div>
      {invites.map((inv) => (
        <InviteRow key={inv.token} inv={inv} copied={copied} onCopy={copyLink} onRevoke={revoke} />
      ))}
    </div>
  )
}
