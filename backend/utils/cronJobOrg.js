const https = require('https')

function apiRequest(method, path, body = null) {
  const key = process.env.CRON_JOB_ORG_API_KEY
  if (!key) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.cron-job.org',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch { resolve(data) }
      })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

function createIngestJob(playCricketId, ingestAfterIso, token) {
  const d = new Date(ingestAfterIso)
  const base = process.env.APP_BASE_URL || 'https://edge.phillprice.com'
  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    console.log(`[cronJobOrg] skipping job creation for fixture ${playCricketId} — APP_BASE_URL is local`)
    return Promise.resolve(null)
  }
  return apiRequest('PUT', '/jobs', {
    job: {
      url: `${base}/api/admin/scheduler/ingest/${playCricketId}`,
      enabled: true,
      saveResponses: false,
      requestMethod: 1, // POST
      extendedData: { headers: { 'X-Ingest-Token': token } },
      schedule: {
        timezone: 'UTC',
        expiresAt: Math.floor(d.getTime() / 1000) + 7200, // auto-expire 2h after ingest time
        hours:   [d.getUTCHours()],
        minutes: [d.getUTCMinutes()],
        mdays:   [d.getUTCDate()],
        months:  [d.getUTCMonth() + 1],
        wdays:   [-1],
      },
    },
  })
}

// Creates a recurring daily cron-job.org job that calls the /discover endpoint at 06:00
// Europe/London. Returns the full API response (or null if CRON_JOB_ORG_API_KEY is absent
// or APP_BASE_URL is local).
function createDiscoveryJob(discoverToken) {
  const base = process.env.APP_BASE_URL || 'https://edge.phillprice.com'
  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    console.log('[cronJobOrg] skipping discovery job creation — APP_BASE_URL is local')
    return Promise.resolve(null)
  }
  return apiRequest('PUT', '/jobs', {
    job: {
      url: `${base}/api/admin/scheduler/discover`,
      enabled: true,
      saveResponses: false,
      requestMethod: 1, // POST
      extendedData: { headers: { 'X-Discover-Token': discoverToken } },
      schedule: {
        timezone: 'Europe/London',
        expiresAt: 0, // never expires
        hours:   [6],
        minutes: [0],
        mdays:   [-1],
        months:  [-1],
        wdays:   [-1],
      },
    },
  })
}

function deleteJob(jobId) {
  if (!jobId) return Promise.resolve(null)
  return apiRequest('DELETE', `/jobs/${jobId}`)
}

function getJob(jobId) {
  return apiRequest('GET', `/jobs/${jobId}`)
}

function listJobs() {
  return apiRequest('GET', '/jobs')
}

module.exports = { createIngestJob, createDiscoveryJob, deleteJob, getJob, listJobs }
