import { useState, useEffect } from 'react'
import { useApiFetch } from '../../../hooks/useApiFetch'
import { shortTeam, formatDateShort } from '../../../utils/cricket'

function matchTitle(f, pcId) {
  if (f.home_team && f.away_team) return `${shortTeam(f.home_team)} v ${shortTeam(f.away_team)}`
  return pcId
}

function ingestButtonLabel(state) {
  if (state === 'running') return 'Ingesting…'
  if (state === 'done') return 'Done'
  return 'Ingest'
}

function IngestBtn({ state, msg, onIngest, pcId }) {
  return (
    <td style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
      {msg && (
        <span
          style={{
            fontSize: '0.75rem',
            marginRight: 8,
            color: state === 'error' ? 'var(--red)' : 'var(--green)'
          }}
        >
          {msg}
        </span>
      )}
      <button
        className="secondary btn-xs"
        disabled={state === 'running' || state === 'done'}
        onClick={() => onIngest(pcId)}
      >
        {ingestButtonLabel(state)}
      </button>
    </td>
  )
}

function PastPendingRow({ f, state, msg, onIngest }) {
  const pcId = String(f.play_cricket_id)
  return (
    <tr key={pcId} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://${f.pcDomain ?? 'play-cricket.com'}/website/results/${pcId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pcId}
        </a>
      </td>
      <td style={{ padding: '5px 10px' }}>{matchTitle(f, pcId)}</td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(f.match_date_iso) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {f.ingest_after?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
      <IngestBtn state={state} msg={msg} onIngest={onIngest} pcId={pcId} />
    </tr>
  )
}

function UpcomingFixtureRow({ j }) {
  return (
    <tr key={j.play_cricket_id} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://${j.pcDomain ?? 'play-cricket.com'}/website/results/${j.play_cricket_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {j.play_cricket_id}
        </a>
      </td>
      <td style={{ padding: '5px 10px' }}>
        {j.home_team && j.away_team
          ? `${shortTeam(j.home_team)} v ${shortTeam(j.away_team)}`
          : j.play_cricket_id}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(j.match_date_iso) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
        {j.ingest_after?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
    </tr>
  )
}

function PastPendingSection({ past, ingesting, msgs, onIngest }) {
  return (
    <>
      <h3 style={{ marginBottom: '0.5rem' }}>Past matches — pending ingest</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        These matches have passed their scheduled ingest time but have not been ingested yet. Click{' '}
        <strong>Ingest</strong> to fetch each one now.
      </p>
      <div
        className="card"
        style={{
          padding: 0,
          overflowX: 'auto',
          border: '1px solid var(--border2)',
          marginBottom: '1.25rem'
        }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              {['Fixture', 'Match', 'Match date', 'Ingest after', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {past.map((f) => (
              <PastPendingRow
                key={f.play_cricket_id}
                f={f}
                state={ingesting[String(f.play_cricket_id)]}
                msg={msgs[String(f.play_cricket_id)]}
                onIngest={onIngest}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function JobStatusTag({ job }) {
  if (!job.exists)
    return (
      <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
        missing
      </span>
    )
  if (job.enabled === false)
    return (
      <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
        disabled
      </span>
    )
  return (
    <span className="tag tag-green" style={{ fontSize: '0.72rem' }}>
      active
    </span>
  )
}

function ScheduleSection({ fixedJobs, hasUpcoming, syncing, syncMsg, onSync }) {
  const missingJobs = fixedJobs.filter((j) => !j.exists)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Ingest schedule</h3>
        <button className="secondary btn-xs" disabled={syncing} onClick={onSync}>
          {syncing ? 'Syncing…' : 'Sync cron jobs'}
        </button>
        {syncMsg && (
          <span
            style={{
              fontSize: '0.75rem',
              color: syncMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)'
            }}
          >
            {syncMsg}
          </span>
        )}
      </div>
      {missingJobs.length > 0 && (
        <p style={{ fontSize: '0.82rem', color: 'var(--orange)', marginBottom: '0.75rem' }}>
          ⚠ Ingest cron job is missing from cron-job.org. Click <strong>Sync cron jobs</strong> to
          recreate it.
        </p>
      )}
      <div
        className="card"
        style={{
          padding: 0,
          overflowX: 'auto',
          border: '1px solid var(--border2)',
          marginBottom: hasUpcoming ? '1.25rem' : 0
        }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              {['Schedule', 'Next run', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fixedJobs.map((j) => (
              <tr key={j.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 10px', fontVariantNumeric: 'tabular-nums' }}>
                  {j.label}
                </td>
                <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
                  {j.next_execution?.slice(0, 16).replace('T', ' ') ?? '—'}
                </td>
                <td style={{ padding: '5px 10px' }}>
                  <JobStatusTag job={j} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function UpcomingSection({ upcoming }) {
  return (
    <>
      <h3 style={{ marginBottom: '0.5rem' }}>Upcoming fixtures</h3>
      <div
        className="card"
        style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              {['Fixture', 'Match', 'Match date', 'Ingest after'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {upcoming.map((j) => (
              <UpcomingFixtureRow key={j.play_cricket_id} j={j} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function doIngestOne(pcId, apiFetch, setIngesting, setMsgs, setPast) {
  setIngesting((s) => ({ ...s, [pcId]: 'running' }))
  setMsgs((m) => ({ ...m, [pcId]: null }))
  try {
    const res = await apiFetch('/api/admin/scheduler/ingest-one/' + pcId, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setIngesting((s) => ({ ...s, [pcId]: 'done' }))
    setMsgs((m) => ({
      ...m,
      [pcId]: data.alreadyDone ? 'Already ingested — marked done' : 'Ingested ✓'
    }))
    setPast((p) => (p || []).filter((f) => String(f.play_cricket_id) !== String(pcId)))
  } catch (e) {
    setIngesting((s) => ({ ...s, [pcId]: 'error' }))
    setMsgs((m) => ({ ...m, [pcId]: e.message }))
  }
}

async function doSyncCronJobs(apiFetch, setSyncing, setSyncMsg, load) {
  if (!window.confirm('Delete all cron-job.org jobs and recreate the every-3-hours ingest job?'))
    return
  setSyncing(true)
  setSyncMsg(null)
  try {
    const res = await apiFetch('/api/admin/scheduler/sync-cron-jobs', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setSyncMsg(
      'Done — deleted ' + data.deleted + ' old job(s), created ' + data.created + ' new job(s)'
    )
    load()
  } catch (e) {
    setSyncMsg('Error: ' + e.message)
  } finally {
    setSyncing(false)
  }
}

function CronJobsDisplay({
  past,
  fixedJobs,
  upcoming,
  ingesting,
  msgs,
  schedState,
  onIngest,
  onSync
}) {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {past?.length > 0 && (
        <PastPendingSection past={past} ingesting={ingesting} msgs={msgs} onIngest={onIngest} />
      )}
      {fixedJobs?.length > 0 && (
        <ScheduleSection
          fixedJobs={fixedJobs}
          hasUpcoming={upcoming?.length > 0}
          syncing={schedState.syncing}
          syncMsg={schedState.syncMsg}
          onSync={onSync}
        />
      )}
      {upcoming?.length > 0 && <UpcomingSection upcoming={upcoming} />}
    </div>
  )
}

export default function CronJobsPanel() {
  const [fixedJobs, setFixedJobs] = useState(null)
  const [upcoming, setUpcoming] = useState(null)
  const [past, setPast] = useState(null)
  const [ingesting, setIngesting] = useState({})
  const [msgs, setMsgs] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const apiFetch = useApiFetch()

  function load() {
    apiFetch('/api/admin/scheduler/cron-jobs')
      .then((r) => r.json())
      .then((d) => {
        setFixedJobs(Array.isArray(d?.fixedJobs) ? d.fixedJobs : [])
        setUpcoming(Array.isArray(d?.upcomingFixtures) ? d.upcomingFixtures : [])
      })
      .catch(() => {
        setFixedJobs([])
        setUpcoming([])
      })
    apiFetch('/api/admin/scheduler/past-pending')
      .then((r) => r.json())
      .then((d) => setPast(Array.isArray(d) ? d : []))
      .catch(() => setPast([]))
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!past?.length && !upcoming?.length && !fixedJobs?.length) return null

  return (
    <CronJobsDisplay
      past={past}
      fixedJobs={fixedJobs}
      upcoming={upcoming}
      ingesting={ingesting}
      msgs={msgs}
      schedState={{ syncing, syncMsg }}
      onIngest={(id) => doIngestOne(id, apiFetch, setIngesting, setMsgs, setPast)}
      onSync={() => doSyncCronJobs(apiFetch, setSyncing, setSyncMsg, load)}
    />
  )
}
