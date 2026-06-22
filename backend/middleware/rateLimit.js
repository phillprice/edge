'use strict'
const rateLimit = require('express-rate-limit')

// Shared API rate limiter. Applied once at app level on '/api/' (plus inline on the
// cron callbacks registered before it). Generous default since the app is authenticated
// and a legitimate session makes many requests; tighten via RATE_LIMIT_PER_MIN.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false
})

// Separate store for the SPA fallback so page loads never compete with API quota
const spaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false
})

// Stricter limiter for the public (unauthenticated) ICS calendar feed.
// Calendar apps poll at most hourly, so 30 req/15 min per IP is generous.
// Separate store so it doesn't share quota with apiLimiter.
const icsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
})

module.exports = { apiLimiter, spaLimiter, icsLimiter }
