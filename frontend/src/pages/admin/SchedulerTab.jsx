import { useUser } from '@clerk/clerk-react'
import AutoIngestPanel from './scheduler/AutoIngestPanel'
import CronJobsPanel from './scheduler/CronJobsPanel'
import StaleFixturesPanel from './scheduler/StaleFixturesPanel'

// ── Scheduler tab ─────────────────────────────────────────────────────────────

export default function SchedulerTab() {
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  return (
    <>
      <AutoIngestPanel />
      {isSuperAdmin && <CronJobsPanel />}
      <StaleFixturesPanel />
    </>
  )
}
