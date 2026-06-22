'use strict'
const { verifyToken } = require('@clerk/express')

const HAS_CLERK = () => !!process.env.CLERK_SECRET_KEY

// Local dev without Clerk configured → full access so the app is usable offline.
// clubId=1 is the WHCC seed row inserted by the clubs:seed-whcc migration.
function devCtx() {
  return {
    userId: null,
    isSuperAdmin: true,
    isClubAdmin: true,
    canUpload: true,
    groups: [],
    clubId: 1,
    verified: true
  }
}
// Unauthenticated / failed verification → zero privileges.
function anonCtx() {
  return {
    userId: null,
    isSuperAdmin: false,
    isClubAdmin: false,
    canUpload: false,
    groups: [],
    clubId: null,
    verified: false
  }
}

// Map verified Clerk session claims → normalized auth context.
function claimsToCtx(claims) {
  const meta = claims?.metadata ?? {}
  return {
    userId: claims?.sub ?? null,
    isSuperAdmin: meta.isSuperAdmin === true,
    isClubAdmin: meta.isClubAdmin === true,
    canUpload: meta.canUpload === true,
    groups: Array.isArray(meta.accessGroups) ? meta.accessGroups : [],
    clubId: meta.clubId != null ? Number(meta.clubId) : null,
    verified: true
  }
}

// Express middleware: cryptographically verify the Clerk session JWT (signature checked
// against Clerk's JWKS — networked, SDK-cached) ONCE per request and attach req.authCtx.
// Downstream handlers/helpers read req.authCtx synchronously. A missing or invalid token
// yields an anonymous (zero-privilege) context rather than throwing, so individual routes
// decide whether to require sign-in.
async function attachAuthContext(req, _res, next) {
  if (!HAS_CLERK()) {
    req.authCtx = devCtx()
    return next()
  }

  // E2E test backdoor: when E2E_TEST_MODE=true, accept X-Test-Auth-Context header containing
  // a JSON-encoded auth context. Only active outside production — never in NODE_ENV=production.
  // This lets auth E2E tests exercise scoping logic without browser-based JWT sign-in.
  if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV !== 'production') {
    const testCtxHeader = req.headers['x-test-auth-context']
    if (testCtxHeader) {
      try {
        const ctx = JSON.parse(testCtxHeader)
        req.authCtx = {
          userId: ctx.userId || 'e2e-test',
          isSuperAdmin: !!ctx.isSuperAdmin,
          isClubAdmin: !!ctx.isClubAdmin,
          canUpload: !!ctx.canUpload,
          groups: Array.isArray(ctx.groups) ? ctx.groups : [],
          clubId: ctx.clubId != null ? Number(ctx.clubId) : 1,
          verified: true
        }
        return next()
      } catch {
        /* fall through to normal auth */
      }
    }
  }

  // Prefer Authorization: Bearer header (set by useApiFetch), fall back to __session cookie
  // so browser-native requests (curl from devtools, direct fetch without the hook) also work.
  const headerToken = (req.headers.authorization || '').replace('Bearer ', '').trim()
  const cookieToken = parseCookie(req.headers.cookie || '', '__session')
  const token = headerToken || cookieToken
  if (!token) {
    req.authCtx = anonCtx()
    return next()
  }
  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY })
    req.authCtx = claimsToCtx(claims)
  } catch {
    req.authCtx = anonCtx()
  }
  return next()
}

function parseCookie(cookieHeader, name) {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k.trim() === name) return decodeURIComponent(v.join('='))
  }
  return ''
}

function getAuthContext(req) {
  return req.authCtx ?? anonCtx()
}

// Guards — read the verified context attached by attachAuthContext.
const requireSignedIn = (req, res, next) =>
  getAuthContext(req).verified && (getAuthContext(req).userId || !HAS_CLERK())
    ? next()
    : res.status(401).json({ error: 'Authentication required' })

const requireUpload = (req, res, next) =>
  getAuthContext(req).canUpload
    ? next()
    : res.status(403).json({ error: 'Upload access not permitted' })

const requireSuperAdmin = (req, res, next) =>
  getAuthContext(req).isSuperAdmin
    ? next()
    : res.status(403).json({ error: 'Super admin access required' })

module.exports = {
  attachAuthContext,
  getAuthContext,
  requireSignedIn,
  requireUpload,
  requireSuperAdmin,
  claimsToCtx,
  anonCtx,
  devCtx // exported for unit tests
}
