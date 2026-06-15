'use strict'

const express = require('express')

// Build a minimal Express app for route-level HTTP tests.
// Attaches a super-admin auth context so all auth checks pass without Clerk.
// routerPath: the path to pass to app.use (e.g. '/api/admin')
// router: the required router module
function buildTestApp(routerPath, router) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.authCtx = {
      verified: true,
      userId: 'test-user',
      isSuperAdmin: true,
      isClubAdmin: true,
      canUpload: true,
      accessGroups: []
    }
    next()
  })
  app.use(routerPath, router)
  return app
}

module.exports = { buildTestApp }
