'use strict'
const https = require('https')

/**
 * Send a transactional email via the Brevo REST API.
 * Silently resolves if BREVO_API_KEY or BREVO_SENDER_EMAIL are not set.
 * @param {{ to: string, toName?: string, subject: string, htmlContent: string }} opts
 */
function sendEmail({ to, toName, subject, htmlContent }) {
  const apiKey = process.env.BREVO_API_KEY
  const fromEmail = process.env.BREVO_SENDER_EMAIL
  const fromName = process.env.BREVO_SENDER_NAME || 'EDGE – WHCC Cricket'
  if (!apiKey || !fromEmail || !to) return Promise.resolve()

  const payload = JSON.stringify({
    sender: { email: fromEmail, name: fromName },
    to: [{ email: to, name: toName || to }],
    subject,
    htmlContent
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode >= 400) {
            process.stderr.write(
              '[brevo] send failed (' + res.statusCode + '): ' + body.slice(0, 200) + '\n'
            )
          }
          resolve()
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

module.exports = { sendEmail }
