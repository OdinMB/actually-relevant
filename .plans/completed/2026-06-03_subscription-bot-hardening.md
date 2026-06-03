# Subscription Bot Hardening (Wave 1 + Confirm-Link Hardening)

- **Date**: 2026-06-03
- **Status**: completed
- **Type**: feature
- **Complexity**: complex

## Problem

Bots hit the open `POST /api/subscribe` endpoint en masse. Because the current flow creates a Plunk contact (`subscribed:false`) **and** sends a confirmation email on every raw submission — *before any human gate* — each bot signup pollutes Plunk's contact list/quota and burns sender reputation (bounces + "I never signed up" complaints), regardless of whether the bot ever confirms. Double opt-in does not help: the harm is upstream of confirmation. The signup form has no honeypot/timing gate (the feedback form already has a honeypot), and the confirmation link is a bare GET that mutates state — auto-followable by email security scanners (RFC 8058 / GHSA-3988-q8q7-p787).

## Approach

Six coordinated changes, gated so bots cost nothing. All deterrent checks run **before** any Plunk call.

1. **Defer Plunk contact creation to confirmation.** `subscribe()` only writes a local `PendingSubscription` row + sends the confirmation email; the Plunk contact is created (`subscribed:true`) inside `confirmSubscription()`. Unconfirmed bots never enter Plunk. (Plunk's own double-opt-in guidance.)
2. **Honeypot** on the signup endpoint, mirroring the proven `feedback.ts` pattern (silent generic-success when filled).
3. **Form token (proof-of-page-load + min fill time).** A new `GET /api/subscribe/token` issues a **stateless** HMAC-signed `{ts, nonce}` token. `POST /subscribe` rejects (silently, generic success) if the token is missing, has a bad signature, or is outside the `[minFormFillMs, formTokenMaxAgeMs]` age window. This blocks the dominant attacker — scripts that POST directly to the API without ever loading the form (CORS is browser-enforced and does **not** stop server-side POSTs; the token does). The min-age also trips instant submitters.
4. **Fail-closed email verification** — stop silently skipping Plunk `verifyEmail` on API error; reject with a "try again shortly" message. (Safe: the confirmation send uses Plunk too, so a Plunk outage already blocks legit signups — failing closed costs real users nothing while removing the bot bypass.)
5. **Sanitize `firstName`** (strip URLs/markup) and add a longer-window per-IP rate limit on top of the existing 3/min burst limit.
6. **Confirm via POST, not GET.** The email link points at the client `/subscribed?token=&email=` page, which shows a "Confirm my subscription" button that POSTs to a new `POST /api/subscribe/confirm`. The old `GET /api/subscribe/confirm` becomes a no-op 302 redirect to that page (backward-compat for in-flight emails; scanner-safe).

### Key decisions (revised after plan review)
- **Stateless form token, no single-use nonce store.** Render may run multiple API instances, so an in-memory consumed-nonce cache cannot guarantee single-use across instances (and a DB-backed nonce table is overkill for a deterrent). The token is a signed timestamp only; replay is bounded by the short `formTokenMaxAgeMs` window + the per-IP rate limits. This also removes the StrictMode/double-fetch consumption hazard.
- **Drop `firstName` from the Plunk contact (no DB migration).** `firstName` is read in only two places: the confirmation-email greeting (built in `subscribe()`, where it is still available — unchanged) and the Plunk contact `data` (consumed nowhere in newsletters or elsewhere). Dropping it from the deferred contact-create means no `PendingSubscription` schema change and **no migration**. Reversible later if personalization is wanted.
- **Dedicated `FORM_TOKEN_SECRET`** (env, falling back to `JWT_SECRET`) rather than reusing the auth secret directly — avoids coupling form-token lifetime to auth-secret rotation.
- **Reuse `/subscribed`** rather than a new `/confirm` page — it already reads query params and renders success/expired/invalid; adding the confirm-button state avoids a new page, route, prerender entry, and sitemap entry.

### Alternatives considered
- **Pure client-side timing check** → rejected: bots POST directly to the API and never load the React form, so only a server-issued signed token works.
- **DB-backed single-use nonce** → rejected as overkill for a deterrent (see above).
- **Persist `firstName` via a new column + migration** → rejected: unused downstream (see above).

## Changes

### Server

| File | Change |
|------|--------|
| `server/src/lib/formToken.ts` (new) | `issueFormToken(): string` and `verifyFormToken(token): { ok: boolean }`. HMAC-SHA256 (`config.subscribe.formTokenSecret`) over `base64url({ts, nonce})`; verify checks signature (constant-time compare) + min age (`config.subscribe.minFormFillMs`) + max age (`config.subscribe.formTokenMaxAgeMs`). **Stateless** (no consumed-nonce store); one-line comment notes replay is bounded by max age + rate limits. |
| `server/src/services/subscribe.ts` | `subscribe()`: **remove** `plunk.createContact()`; make verify **fail-closed** (throw new `EmailVerificationUnavailableError` on a non-validation Plunk error instead of skipping); `sanitizeFirstName()` before the greeting; create the `PendingSubscription` with `plunkContactId: null`. `confirmSubscription()`: **delete the existing `updateContact(pending.plunkContactId, …)` branch** and replace with `plunk.createContact({ email, subscribed:true })`; persist the returned id via `pendingSubscription.update({ plunkContactId })`; then set `confirmedAt`. Graceful: if `createContact` throws, log and still set `confirmedAt` (confirmed locally, no Plunk contact). Idempotent: already-confirmed → early `return` (route treats as success). Confirm-email link → `${config.clientUrl}/subscribed?token=…&email=…` built with `URLSearchParams`. Add `sanitizeFirstName` (strip `https?://\S+`, `www\.\S+`, `<[^>]+>`; collapse whitespace; trim; cap 100) + `EmailVerificationUnavailableError` exports. Drop the now-unused `API_URL` const. |
| `server/src/routes/public/subscribe.ts` | Add `website` (honeypot) + `formToken` to `subscribeSchema`. Handler order: honeypot → form-token → service. Add a second (daily) `rateLimit` limiter alongside the 3/min burst on `POST /`. Add `GET /token` (apply the burst limiter; `Cache-Control: no-store`; returns `{ token }`). Change `GET /confirm` to a 302 redirect to `${clientUrl}/subscribed?token=…&email=…` (URL-encoded, **no** state change). Add `POST /confirm` (`validateBody {token, email}`) → `confirmSubscription` → always HTTP 200 `{ success:true }` on confirm/already-confirmed, `{ success:false, reason:'expired'\|'invalid' }` otherwise. Map `EmailVerificationUnavailableError` on `POST /` to `{ success:false, message: 'Email verification is temporarily unavailable. Please try again in a few minutes.' }`. |
| `server/src/config.ts` | Add to `subscribe`: `minFormFillMs` (1500), `formTokenMaxAgeMs` (~30 min), `formTokenSecret` (`FORM_TOKEN_SECRET` ‖ `JWT_SECRET`), `rateLimitDailyWindowMs` (24h), `rateLimitDailyMax` (~20). Add top-level `clientUrl` (`CLIENT_URL` ‖ `https://actuallyrelevant.news`) and use it in `subscribe.ts` (replaces the local `CLIENT_URL`/`API_URL` consts). |

### Client

| File | Change |
|------|--------|
| `client/src/lib/api.ts` | Extend `subscribe` payload type to `{email, firstName?, website?, formToken?}`; add `getSubscribeToken(): Promise<{token:string}>` (`GET /subscribe/token`) and `confirmSubscription({token,email}): Promise<{success:boolean; reason?:string}>` (`POST /subscribe/confirm`). |
| `client/src/components/SubscribeForm.tsx` | Fetch a form token on mount via `useEffect` (with `AbortController` cleanup; retry once on failure); **disable submit until the token has loaded** so a real token is always sent (avoids the min-age edge). Add the hidden honeypot `website` input (copy FeedbackForm markup: off-screen, `aria-hidden`, `tabIndex={-1}`, `autoComplete="off"`). Include `website`/`formToken` in the submit payload. |
| `client/src/pages/SubscribedPage.tsx` | When `token`+`email` are present and no `error`: render a "Confirm my subscription" button that POSTs via `confirmSubscription` → on success show the existing welcome state; on `reason==='expired'` show the expired state, else the invalid state. Render `<meta name="robots" content="noindex">` **only when `token` is present** (keeps the plain `/subscribed` page indexable as today). Existing default/welcome + `?error=` states unchanged. |

### Specs / Docs (during the documentation step)

| File | Change |
|------|--------|
| `.specs/subscription.allium` | Via `/allium`: `ValidateAndCreateSubscription` — no contact creation; **`try_verify_email` contract changes from graceful-degradation to fail-closed** (reject on API error, not proceed); add honeypot + form-token gate; sanitize `firstName`; `firstName` no longer flows to a Plunk contact. `ConfirmSubscription` — Plunk contact creation moves here. New `config` entries. `SubscribeForm` surface (honeypot + form token). `ConfirmationPage` surface — GET renders/redirects to the page; **POST** performs the confirmation. |

## Tests

Logic-bearing only:

- **`server/src/lib/formToken.test.ts` (new)** — issue→verify roundtrip ok; reject too-fast (age < min, via fake timers/threshold); reject expired (age > max); reject tampered signature; reject malformed token.
- **`server/src/services/subscribe.test.ts` (rewrite affected cases)** — expand mocks to add `pendingSubscription.update` and keep `plunk.createContact`. `subscribe()`: does **not** call `createContact`; verify→sendTransactional preserved; **fail-closed** — verify API error now rejects with `EmailVerificationUnavailableError` (invert old "skips gracefully"); `firstName` sanitized (URL/markup stripped) in greeting; already-confirmed early return unchanged. `confirmSubscription()` (new cases): creates Plunk contact (`subscribed:true`), persists `plunkContactId`, sets `confirmedAt`; still confirms locally if `createContact` throws; idempotent on a second (already-confirmed) call — no second `createContact`; honors expiry/invalid.
- **`server/src/routes/public/subscribe.test.ts` (new)** — mirror `feedback.test.ts` (mock rate-limit + service). Honeypot filled → 200 success, service not called. Missing/invalid `formToken` → 200 generic success, service not called. Valid token → service called. `GET /confirm` → 302 redirect, `confirmSubscription` not called. `POST /confirm` → calls `confirmSubscription`; expired/invalid → `success:false` + reason; already-confirmed → `success:true`.
- **`client/src/components/SubscribeForm.test.tsx` (update)** — expand the `vi.mock('../lib/api')` factory to include `getSubscribeToken: vi.fn().mockResolvedValue({token:'t'})`; change the exact `toHaveBeenCalledWith(...)` assertions (current lines 39 & 111) to `expect.objectContaining({email, …})`.
- **`client/src/pages/SubscribedPage.test.tsx` (new)** — with `token`+`email`: button POSTs → renders confirmed state on success, error state on failure. Also assert existing `?error=expired` and `?error=invalid` (no token) still render their states.

## Out of Scope

Explicitly deferred (the "Full hardening" tier the user did not pick): **Cloudflare Turnstile / any CAPTCHA**; scheduled cleanup job for expired `PendingSubscription` rows; diagnostic logging / `ipHash` capture on subscribe; reputation monitoring (Postmaster/Sender Hub); any Plunk-side unsubscribe-link audit. No changes to newsletter generation/sending, CORS, or auth.

**Known residue (accepted):** `pending_subscriptions` rows created *before* this change may hold a non-null `plunk_contact_id` pointing at an unconfirmed Plunk contact; those orphans are left as-is (they age out as the rows are replaced on re-subscribe). The stateless form token does not guarantee single-use across multiple server instances — accepted, since it is a deterrent bounded by the token lifetime and rate limits.
