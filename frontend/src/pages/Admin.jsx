import { useNavigate, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  Download,
  PenTool,
  Clock,
  Database,
  Settings,
  Users,
  Shirt,
  ScrollText
} from 'lucide-react'
import UserAdmin from './UserAdmin'
import ClubAdmin from './ClubAdmin'
import DataTab from './admin/DataTab'
import PlayersTab from './admin/PlayersTab'
import SystemTab from './admin/SystemTab'
import ChangelogTab from './admin/ChangelogTab'
import IngestTab from './admin/IngestTab'
import ManualTab from './admin/ManualTab'
import SchedulerTab from './admin/SchedulerTab'

// ── Tab bar ───────────────────────────────────────────────────────────────────

const UPLOAD_TABS = [
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'ingest', label: 'Ingest', icon: Download },
  { id: 'manual', label: 'Manual', icon: PenTool }
]
const BASE_TABS = [
  ...UPLOAD_TABS,
  { id: 'data', label: 'Data', icon: Database },
  { id: 'system', label: 'System', icon: Settings }
]

export default function Admin() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const isClubAdmin = user?.publicMetadata?.isClubAdmin === true
  const canAdmin = isSuperAdmin || isClubAdmin
  const ADMIN_TABS = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'players', label: 'Players', icon: Shirt },
    { id: 'club', label: 'Club', icon: Settings },
    { id: 'changelog', label: 'Changelog', icon: ScrollText }
  ]
  const TABS = isSuperAdmin
    ? [...BASE_TABS, ...ADMIN_TABS]
    : isClubAdmin
      ? [...UPLOAD_TABS, ...ADMIN_TABS]
      : BASE_TABS

  const tabFromHash = hash.replace(/^#/, '')
  const activeTab = TABS.some((t) => t.id === tabFromHash)
    ? tabFromHash
    : (TABS[0]?.id ?? 'scheduler')

  function setTab(id) {
    navigate(`#${id}`, { replace: true })
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: '1rem' }}>Admin</h1>

      {/* Mobile: select dropdown */}
      <select
        className="tab-select-mobile"
        value={activeTab}
        onChange={(e) => setTab(e.target.value)}
      >
        {TABS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Desktop: scrolling tab bar */}
      <div
        className="tab-bar"
        style={{
          gap: 0,
          borderBottom: '2px solid var(--border)',
          marginBottom: '1.5rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {TABS.map((t) => {
          const IconComponent = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="secondary"
              style={{
                borderRadius: 0,
                border: 'none',
                borderBottom:
                  activeTab === t.id ? '2px solid var(--hotpink)' : '2px solid transparent',
                marginBottom: -2,
                fontWeight: activeTab === t.id ? 600 : 400,
                color: activeTab === t.id ? 'var(--hotpink)' : 'var(--text2)',
                padding: '0.5rem 1.1rem',
                background: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              <IconComponent size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'ingest' && <IngestTab />}
      {activeTab === 'manual' && <ManualTab />}
      {activeTab === 'scheduler' && <SchedulerTab />}
      {activeTab === 'data' && <DataTab />}
      {activeTab === 'system' && <SystemTab />}
      {activeTab === 'users' && canAdmin && <UserAdmin />}
      {activeTab === 'players' && canAdmin && <PlayersTab />}
      {activeTab === 'club' && canAdmin && <ClubAdmin />}
      {activeTab === 'changelog' && canAdmin && <ChangelogTab />}
    </div>
  )
}
