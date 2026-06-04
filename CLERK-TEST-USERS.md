# Clerk Test Users for E2E Auth Testing

## Status: ✓ Set up — auth E2E tests active in CI

Test users are created in the dev Clerk instance and all GitHub secrets are set.
Auth tests run automatically on every PR when `CLERK_SECRET_KEY` is present.

---

## Test users

| Key | Email | publicMetadata | User ID |
|-----|-------|----------------|---------|
| `E2E_USER_SUPER` | `e2e-superadmin+clerk_test@phillprice.com` | `{"isSuperAdmin":true}` | `user_3Eh1E6is3RvIl2iTUzmrrQg58kl` |
| `E2E_USER_UPLOAD` | `e2e-upload+clerk_test@phillprice.com` | `{"canUpload":true,"accessGroups":[{"team_id":35534,"season_id":259}]}` | `user_3Eh1EHHZTlo8iaiVjCxgmVp33zK` |
| `E2E_USER_SCOPED` | `e2e-scoped+clerk_test@phillprice.com` | `{"accessGroups":[{"team_id":35534,"season_id":259}]}` | `user_3Eh1EFf5ZLeZJi7imGjeWo08oSB` |
| `E2E_USER_MULTI` | `e2e-multiteam+clerk_test@phillprice.com` | `{"accessGroups":[{"team_id":35534,"season_id":259},{"team_id":47317,"season_id":259}]}` | `user_3Eh1EE3P3YfiQDNwdpbYgiC7CW9` |
| `E2E_USER_NOACCESS` | `e2e-noaccess+clerk_test@phillprice.com` | `{"accessGroups":[]}` | `user_3Eh1ERW767WKL9BMcLs3i1rSVLZ` |

Password stored in `E2E_TEST_PASSWORD` GitHub secret.

---

## GitHub secrets set

| Secret | Status |
|--------|--------|
| `CLERK_SECRET_KEY` | ✓ (dev instance) |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✓ |
| `E2E_TEST_PASSWORD` | ✓ |
| `E2E_USER_SUPER` | ✓ |
| `E2E_USER_UPLOAD` | ✓ |
| `E2E_USER_SCOPED` | ✓ |
| `E2E_USER_MULTI` | ✓ |
| `E2E_USER_NOACCESS` | ✓ |

---

## Re-running setup

If users need to be recreated (e.g. after Clerk instance reset):

```bash
CLERK_SECRET_KEY=sk_test_... E2E_TEST_PASSWORD=... \
  node backend/scripts/setup-clerk-test-users.js
```

Requires **Email address** enabled as an identifier in the dev Clerk dashboard:
Dashboard → dev instance → User & Authentication → Email, Phone, Username → Email address ✓ + Password ✓

---

## What the auth tests cover

`frontend/e2e/auth.spec.js` — 7 tests via `@clerk/testing/playwright`:

| Scenario | Assertion |
|----------|-----------|
| Super admin — match list | All 6 fixtures visible |
| Super admin — fixture detail | Any fixture accessible |
| Scoped (Whirlwinds) — match list | Exactly 4 Whirlwinds fixtures |
| Scoped (Whirlwinds) — Hurricanes fixture | 403/404 |
| Multi-team — match list | All 6 fixtures |
| No-access — match list | 0 fixtures |
| Unauthenticated — any endpoint | 401 |

---

## Why not mock Clerk JWT metadata?

The `publicMetadata` is baked into the Clerk JWT and verified server-side against Clerk's
JWKS. You cannot forge a JWT with arbitrary metadata — the signature would fail.
Real test users with pre-set metadata is the only correct approach.
