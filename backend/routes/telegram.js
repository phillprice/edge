'use strict'
const express = require('express')
const https = require('https')
const router = express.Router()
const { sendTelegramTo } = require('../utils/notify')

// POST /api/telegram/webhook — receives Telegram bot updates.
// Secured via secret token (X-Telegram-Bot-Api-Secret-Token header).
router.post('/webhook', (req, res) => {
  const secret = req.headers['x-telegram-bot-api-secret-token']
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.sendStatus(403)
  }

  const msg = req.body?.message
  if (msg?.text?.startsWith('/start')) {
    const chatId = String(msg.chat.id).replace(/\D/g, '')
    const firstName = (msg.from?.first_name || 'there').replace(/[<>&"]/g, '')
    const appUrl = process.env.APP_BASE_URL || 'https://edgexi.uk'
    const replyText =
      'Hi ' +
      firstName +
      '! 👋\n' +
      'Your Telegram chat ID is: <code>' +
      chatId +
      '</code>\n\n' +
      'Paste it into your EDGE notification preferences:\n' +
      appUrl +
      '/notifications'
    sendTelegramTo(chatId, replyText).catch((e) =>
      console.error('[telegram] /start reply error:', e.message)
    )
  }

  res.sendStatus(200)
})

/**
 * Register the Telegram webhook with Telegram's API.
 * Called once on server startup when TELEGRAM_BOT_TOKEN and APP_BASE_URL are set.
 */
function registerWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const baseUrl = process.env.APP_BASE_URL
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!token || !baseUrl || !secret) return

  const payload = JSON.stringify({
    url: `${baseUrl}/api/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ['message']
  })

  const req = https.request(
    {
      hostname: 'api.telegram.org',
      path: `/bot${token}/setWebhook`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    },
    (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => {
        try {
          const json = JSON.parse(body)
          if (json.ok) console.log('[telegram] webhook registered:', json.description)
          else console.error('[telegram] webhook registration failed:', json.description)
        } catch {
          /* ignore */
        }
      })
    }
  )
  req.on('error', (e) => console.error('[telegram] webhook registration error:', e.message))
  req.write(payload)
  req.end()
}

module.exports = { router, registerWebhook }
