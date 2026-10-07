# Authentication

The admin panel uses JWT-only authentication: access tokens (15 min) with httpOnly refresh token cookies (24 hours) for browser sessions. A separate `requireApiKey` middleware exists for public API consumers (mobile apps, etc.) that need authenticated read access — the static API key cannot access admin endpoints.

## Architecture

### Server

- **Auth middleware** (`server/src/middleware/auth.ts`): `requireAuth` accepts JWT only (used on admin routes). `requireApiKey` accepts the static `PUBLIC_API_KEY` (used on public API routes that need authenticated access). `requireRole(...roles)` checks user role after auth. `requireApiKey` compares the presented key to `PUBLIC_API_KEY` in constant time (`crypto.timingSafeEqual`) to prevent timing attacks. `requireAuth` has no API-key fallback.
- **Auth service** (`server/src/services/auth.ts`): Password hashing (bcryptjs, 12 rounds), JWT generation/verification (`JWT_SECRET` env var, 15 min expiry), refresh token creation/rotation/revocation (stored in `refresh_tokens` DB table, 24h expiry). Includes token reuse detection via family tracking, with a short grace window (see Session and Token Rules).
- **User service** (`server/src/services/user.ts`): CRUD operations for user management. Returns sanitized objects (no `passwordHash`).
- **Auth routes** (`server/src/routes/auth.ts`): Public routes at `/api/auth` — login, refresh, logout, me. Login and refresh endpoints are rate-limited (`authLimiter`: 5 req/15 min, `refreshLimiter`: 30 req/15 min) via `server/src/middleware/rateLimit.ts`. Both limits are counted per client IP and are checked before any auth logic runs.
- **User routes** (`server/src/routes/admin/users.ts`): Admin-only CRUD at `/api/admin/users`. Blocks self-delete, revokes tokens on user deletion. Includes `PUT /api/admin/users/:id/password` for password changes (self-change requires current password; admins can reset any user's password).

### Client

- **Session** (`client/src/lib/session.ts`): the access token in a module-scoped variable (not localStorage — XSS-safe), `refreshSession()` and the session-expired signal. A refresh has three outcomes: `ok`; `unauthorized` (the server rejected or found no cookie — only this means "log in again"); `unavailable` (5xx or network error after two retries 1 s and 3 s apart, or a 429, which is not retried because it only spends more of the limit). Concurrent callers in one tab share one refresh request.
- **Auth context** (`client/src/lib/auth.tsx`): `AuthProvider` wraps the app but does **not** refresh on mount, so public pages never call the API. The session status starts `unchecked`; the admin guard and the login page call `tryRestoreSession()` (once per page load), and `isLoading` stays true until it finishes. `unavailable` leaves the person signed out but undecided (`isServerUnavailable`); `retryRestoreSession()` tries again. It subscribes to the session-expired signal and signs the person out when it fires.
- **Admin guard** (`client/src/components/admin/RequireSession.tsx`, wrapping `AdminLayout`): shows a spinner until the restore finishes — never a redirect, which used to throw away the URL on every reload. Signed out, it redirects to `/admin/login` with `state.from` = path + query + hash. Server unavailable, it shows "Can't reach the server" with a retry button on the same URL.
- **API client** (`client/src/lib/admin-api.ts`): on a 401, refreshes the session once and retries the request. If the refresh is `unauthorized` it fires the session-expired signal, so a session that ends mid-use sends the person to login remembering the page; if `unavailable`, the request just fails.
- **Login page** (`client/src/pages/admin/LoginPage.tsx`): Email + password form. After a restored session or a sign-in it returns to `state.from` (`postLoginPath()` in `client/src/lib/authRedirect.ts` accepts only `/admin…` paths other than the login page itself, else `/admin`).
- **Users page** (`client/src/pages/admin/UsersPage.tsx`): Admin user management with create/edit/delete dialogs.

## Token Flow

1. **Login**: `POST /api/auth/login` with `{ email, password }` returns `{ accessToken, user }` + sets `refresh_token` httpOnly cookie
2. **API calls**: `Authorization: Bearer <accessToken>` header on every request
3. **Token expiry**: On 401, client calls `POST /api/auth/refresh` (cookie sent automatically), gets new access token, retries original request
4. **Logout**: `POST /api/auth/logout` revokes refresh token in DB, clears cookie, clears in-memory access token

## Session and Token Rules

All in `server/src/services/auth.ts` unless noted.

- **Login** fails unless the email belongs to an existing user and the password matches the bcrypt hash. Each successful login starts a new token family: a fresh `randomUUID()` `familyId`, and a refresh token of 40 random bytes, hex-encoded. Access tokens carry `userId`, `email` and `role`.
- **Refresh** accepts a token that exists, has not expired and has not been rotated, or was rotated within the grace window (below). It soft-rotates the presented token: it sets `rotatedAt` and does not delete the row, which is kept for forensics. The claim is atomic (`updateMany where { id, rotatedAt: null }`), so of two simultaneous requests only one rotates; the other re-reads the row and is served only if the row still exists and was rotated within the window (a session revoked in between is not revived). It then issues a new access token and a new refresh token in the **same family**.
- **Expired token presented**: the request is rejected and that token row is deleted. Expiry is checked before rotation, so an expired token that was also rotated is deleted on its own rather than triggering family revocation.
- **Reuse grace window** (ADR-0014): a rotated token presented again within `config.auth.refreshReuseGraceMs` (60 s, `AUTH_REFRESH_REUSE_GRACE_MS`) of its rotation is a lost response (reload mid-refresh, sleep, network drop, deploy restart) or a second tab, not theft: it gets a new token in the same family and nothing is revoked. The cost: a stolen token replayed inside that minute gets a session instead of tripping revocation.
- **Reuse detection**: a token presented after the grace window is treated as a sign of compromise. Every token in its family is deleted (`deleteMany({ familyId })`) and the request fails.
- **Cookie clearing**: `POST /api/auth/refresh` clears the cookie only when the token is rejected (401: invalid, expired, reused). A server failure (500) keeps it, so the client can retry.
- **Logout** deletes every token in the presented token's family, ending that login session (other logins of the same user stay). An unknown token is not an error.
- **Password change and admin reset both revoke every refresh token of that user**, which forces a re-login on every device. A self-change requires the current password. An admin reset does not.
- **Cleanup**: an hourly job deletes all expired refresh tokens (`cleanupExpiredTokens()`, called from `server/src/index.ts`).

## User Management Rules

- Email is unique: creating a user with an existing email fails. A created user's role defaults to `viewer` (`server/src/services/user.ts`).
- Deleting a user removes all of their refresh tokens (cascade). Self-delete is blocked.

## Cookie Configuration

- `httpOnly: true` — not accessible from JavaScript
- `secure: true` — only in production (HTTPS)
- `sameSite`: `AUTH_COOKIE_SAMESITE` (`strict` | `lax` | `none`; an unknown value stops the server at startup) when set; otherwise `'none'` in production and `'strict'` in development (`server/src/routes/auth.ts`, `config.auth.cookieSameSite`)
- `path: /api/auth` — only sent to auth endpoints
- `maxAge: 24 hours`

### Cross-site cookie in production

In development the Vite proxy makes the API same-origin. In production (2026-10-07) the admin runs on `actuallyrelevant.news` and calls the API at `actually-relevant-api.onrender.com`. `onrender.com` is on the Public Suffix List, so these are different **sites** and the refresh cookie is a third-party cookie (hence `SameSite=None`). Browsers that block third-party cookies (Safari always; Brave; Firefox strict; Chrome incognito or with third-party cookies blocked) never send it back: login works, but every reload and every 15-minute access-token expiry is a logout. Only putting the API on the same site fixes this. The way that needs no proxy is a custom domain, `api.actuallyrelevant.news`, which the README, `widget.js` and the OpenAPI docs already assume but which did not resolve on 2026-10-07:

1. Render → API web service → Settings → Custom Domains → add `api.actuallyrelevant.news`; add the CNAME record Render shows at the DNS provider; wait for the certificate.
2. Static site → Environment: `VITE_API_URL=https://api.actuallyrelevant.news`, then redeploy the static site (Vite bakes it in at build time). `FRONTEND_URL` on the API stays `https://actuallyrelevant.news`. Everyone logs in once more, since the old cookie belongs to the old host.
3. Once the admin works on the new host, set `AUTH_COOKIE_SAMESITE=strict` on the API service.

A static-site rewrite of `/api/*` to the API would also work, but every request would reach the API from the proxy's address, which breaks the per-IP rate limits.

## Environment Variables

- `JWT_SECRET` — Required. Random string (32+ chars) for signing JWTs. Verification is restricted to HS256 algorithm only.
- `PUBLIC_API_KEY` — Optional. Static key for public API consumers (mobile apps, external services). Does **not** grant admin access.

## Database Models

- `User` (`users` table): id, email, name, passwordHash, role (admin/editor/viewer), timestamps
- `RefreshToken` (`refresh_tokens` table): id, token, userId, familyId, expiresAt, rotatedAt, createdAt. Cascade-deleted with user. `familyId` groups tokens from the same login session; `rotatedAt` marks soft-rotated tokens for reuse detection.

## Roles

- `admin`: full access, including user management (`/api/admin/users`, gated by `requireRole('admin')` in `server/src/routes/admin/users.ts`).
- `editor`: every admin feature except user management. All admin routes are mounted with `requireAuth, requireRole('admin', 'editor')` in `server/src/routes/admin/index.ts`.
- `viewer`: the default role for new users. It is locked out of every admin route, and is kept for future public user profiles.

## Creating the First Admin

```bash
npx tsx server/src/scripts/create-admin.ts
```

## Key Files

- Server auth: `server/src/services/auth.ts`, `server/src/middleware/auth.ts`, `server/src/routes/auth.ts`
- Server users: `server/src/services/user.ts`, `server/src/routes/admin/users.ts`
- Schemas: `server/src/schemas/auth.ts`, `server/src/schemas/user.ts`
- Client auth: `client/src/lib/auth.tsx`, `client/src/lib/admin-api.ts`
- Client UI: `client/src/pages/admin/LoginPage.tsx`, `client/src/pages/admin/UsersPage.tsx`
- Hooks: `client/src/hooks/useUsers.ts`
