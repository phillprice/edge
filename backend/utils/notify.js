'use strict'
const https = require('https')

function sendTelegramTo(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !chatId) return Promise.resolve()

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${token}/sendMessage`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve) })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// Backward-compatible wrapper — sends to the configured global chat.
function sendTelegram(text) {
  return sendTelegramTo(process.env.TELEGRAM_CHAT_ID, text)
}

module.exports = { sendTelegram, sendTelegramTo }
