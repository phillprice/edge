# Clerk Test Users for E2E Auth Testing

## Current status

Existing E2E tests (`frontend/e2e/smoke.spec.js`) run with auth **disabled** (backend started
with `CLERK_SECRET_KEY=` empty). No Clerk users are needed for those tests.

This document covers the setup for **authenticated** E2E tests (access-control, scoped visibility).

---

## Creating test users (automated)

Run the setup script against the dev Clerk instance once:

```bash
CLERK_SECRET_KEY=sk_test_... node backend/scripts/setup-clerk-test-users.js
```

The script creates (or idempotently updates) 5 users with the right `publicMetadata` and
prints a list of user IDs to add as GitHub secrets. It uses `@clerk/express` which is already
installed — no extra dependencies.

Set `E2E_TEST_PASSWORD` to override the default password:

```bash
CLERK_SECRET_KEY=sk_test_... E2E_TEST_PASSWORD=MyPassword1! node backend/scripts/setup-clerk-test-users.js
```

---

## GitHub Secrets to add

After running the script, add these to **Settings → Secrets → Actions**:

| Secret | Value |
|--------|-------|
| `CLERK_SECRET_KEY` | Dev instance secret key (same as `backend/.env`) |
| `VITE_CLERK_PUBLISHABLE_KEY` | Dev instance publishable key |
| `E2E_TEST_PASSWORD` | Password used when creating the test users |
| `E2E_USER_SUPER` | userId of `e2e-superadmin@test.invalid` |
| `E2E_USER_UPLOAD` | userId of `e2e-upload@test.invalid` |
| `E2E_USER_SCOPED` | userId of `e2e-scoped@test.invalid` |
| `E2E_USER_MULTI` | userId of `e2e-multiteam@test.invalid` |
| `E2E_USER_NOACCESS` | userId of `e2e-noaccess@test.invalid` |

---

## Test users created

| Key | Email | publicMetadata |
|-----|-------|----------------|
| `E2E_USER_SUPER` | `e2e-superadmin@test.invalid` | `{ isSuperAdmin: true }` |
| `E2E_USER_UPLOAD` | `e2e-upload@test.invalid` | `{ canUpload: true, accessGroups: [{team, season}] }` |
| `E2E_USER_SCOPED` | `e2e-scoped@test.invalid` | `{ accessGroups: [{team, season}] }` |
| `E2E_USER_MULTI` | `e2e-multiteam@test.invalid` | `{ accessGroups: [{team1}, {team2}] }` |
| `E2E_USER_NOACCESS` | `e2e-noaccess@test.invalid` | `{ accessGroups: [] }` |

Update team/season IDs in the script if the fixture_seasons table changes.

---

## Playwright + Clerk integration

Install the Clerk testing package:

```bash
cd frontend && npm install --save-dev @clerk/testing
```

Then in Playwright tests use `setupClerkTestingToken` to bypass bot detection in headless
browsers, and sign in with the test user credentials:

```js
import { setupClerkTestingToken, clerk } from '@clerk/testing/playwright'

test('scoped user only sees their team', async ({ page }) => {
  await setupClerkTestingToken({ page })
  await clerk.signIn({ page, signInParams: {
    strategy: 'password',
    identifier: 'e2e-scoped@test.invalid',
    password: process.env.E2E_TEST_PASSWORD,
  }})
  // ... test assertions
})
```

The testing token bypasses Clerk's bot/CAPTCHA detection. The sign-in still uses real credentials
against the dev Clerk instance — there is no way to mock JWT metadata in the frontend; the
metadata genuinely lives on the Clerk user object.

---

## Why not mock Clerk in tests?

The `publicMetadata` is baked into the Clerk JWT, which is verified server-side against Clerk's
JWKS. You cannot forge a JWT with arbitrary metadata in tests — the signature would fail. Using
real test users with pre-set metadata is the only correct approach.
