'use strict'
const rateLimit = require('express-rate-limit')

// Shared API rate limiter. Applied per-router (routers are path-exclusive, so a request
// passes through exactly one router and is counted once) and on the standalone /api routes
// defined directly on the app. Generous default since the app is authenticated and a
// legitimate session makes many requests; tighten via RATE_LIMIT_PER_MIN.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_PER_MIN) || 300,
  standardHeaders: true,
  legacyHeaders: false,
})

module.exports = { apiLimiter }
