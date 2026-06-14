'use strict'

const https = require('https')

function apiRequest(method, path, body = null) {
  const key = process.env.CRON_JOB_ORG_API_KEY
  if (!key) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const req = https.request(
      {
        hostname: 'api.cron-job.org',
        path,
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          if (res.statusCode === 429) {
            console.warn(`[cronJobOrg] rate limited (429) on ${method} ${path}`)
            return resolve(null)
          }
          try {
            resolve(JSON.parse(data))
          } catch {
            resolve(data)
          }
        })
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// Creates a recurring daily cron-job.org job that calls the /ingest-cycle endpoint at the
// given hour:minute in Europe/London timezone. Returns the full API response (or null if
// CRON_JOB_ORG_API_KEY is absent or APP_BASE_URL is local).
function createFixedIngestJob(hour, minute, token) {
  const base = process.env.APP_BASE_URL || 'https://edge.phillprice.com'
  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    console.log(
      `[cronJobOrg] skipping fixed ingest job ${hour}:${String(minute).padStart(2, '0')} — APP_BASE_URL is local`
    )
    return Promise.resolve(null)
  }
  return apiRequest('PUT', '/jobs', {
    job: {
      url: `${base}/api/admin/scheduler/ingest-cycle`,
      enabled: true,
      saveResponses: false,
      requestMethod: 1, // POST
      extendedData: { headers: { 'X-Ingest-Token': token } },
      schedule: {
        timezone: 'Europe/London',
        expiresAt: 0, // never expires
        hours: [hour],
        minutes: [minute],
        mdays: [-1],
        months: [-1],
        wdays: [-1]
      }
    }
  })
}

function deleteJob(jobId) {
  if (!jobId) return Promise.resolve(null)
  return apiRequest('DELETE', `/jobs/${jobId}`)
}

function listJobs() {
  return apiRequest('GET', '/jobs')
}

module.exports = { createFixedIngestJob, deleteJob, listJobs }
