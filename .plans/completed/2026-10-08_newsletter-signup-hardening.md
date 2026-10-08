---
plan-id: newsletter-signup-hardening
title: Harden the newsletter signup with a server-side switch, Turnstile, email normalization, per-address and global send limits, and a non-repeating confirmation email
status: implemented
created: 2026-10-08
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [personal-data, vendor, accessibility]
decisions:
  - ref: .context/decisions/0021-turnstile-on-newsletter-signup.md
  - ref: .context/decisions/0022-send-limits-from-pending-subscription-rows.md
  - ref: .context/decisions/0023-store-subscriber-emails-normalized.md
type: feature
complexity: complex
---

# Newsletter signup hardening

The behavior in this plan (one server-side switch defaulting to closed, Turnstile failing closed, trim+lowercase normalization, one email per address per 24 h, a global hourly cap with one alert per hour, a confirmation email that repeats nothing typed, no duplicate-producing retries, the doc and privacy fixes) was decided by the owner, Odin Mühlenbein, before planning (task brief, 2026-10-08; background in `DOCS/2026-10-08_plunk-suspension-review.md`, sections 2 and 4). ADR-0021 is therefore the owner's decision. The agent made every implementation choice under Approach, including ADR-0022 and ADR-0023 (the owner allowed a migration "if safe"; choosing it over case-insensitive queries is the agent's call).

Planned without explorer, architect or reviewer sub-agents (none available in this run); the alternatives each would have weighed are compared under Approach.

## Problem

The signup pause is client-only: the API still issues form tokens and sends confirmation emails, so once Plunk reactivates the account a script can trigger confirmation emails to arbitrary addresses again, which is what caused the complaints. The form token is scriptable, there is no CAPTCHA, no per-address or global send limit, addresses are not normalized, the optional first name lets spam text into our email, and the Plunk send retries on timeouts, which can deliver duplicates.

## Approach

### Server

**1. One switch, on the server.** `config.subscribe.enabled = process.env.SUBSCRIPTIONS_ENABLED === 'true'` (the `=== 'true'` pattern the Bluesky/Mastodon toggles use; missing means paused). A small router-local middleware `requireSignupsOpen` in `routes/public/subscribe.ts`, mounted first on `GET /token` and `POST /`, answers `503 { error: 'Newsletter signups are paused.', code: 'SIGNUPS_PAUSED' }` and does nothing else. `GET /confirm` and `POST /confirm` are not behind it, so already-sent links keep working while paused. The client constant `SUBSCRIPTIONS_ENABLED` is removed. A Render env change restarts the service, so flipping the switch needs no deploy.

**2. Turnstile.** New `server/src/lib/turnstile.ts`, `verifyTurnstile(token, remoteIp)` returning `'ok' | 'failed' | 'unavailable'`:
- No `TURNSTILE_SECRET_KEY`: `'unavailable'` when `NODE_ENV === 'production'`, otherwise `'ok'` (skipped). Module-level startup log like `formToken.ts`: `error` in production ("signups will be refused"), `warn` elsewhere ("Turnstile check skipped").
- Missing or empty token with a secret set: `'failed'`, no HTTP call.
- Otherwise POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, `remoteip` and an `idempotency_key` (one `randomUUID()` per verification, reused across retries), through axios (already a dependency, 5 s timeout) wrapped in `withRetry(…, { retries: 2, retryOn: isRetryableError })`. The idempotency key is what makes retrying safe: without it a retry after Cloudflare saw the token returns `timeout-or-duplicate` and a real person is turned away. `success: true` → `'ok'`; `success: false` → `'failed'` (log the `error-codes`, never the token); exhausted retries or any thrown error → `'unavailable'`.
- Placement: a lib module beside `formToken.ts`, because it is a request-level bot gate with its own external call and its own reason to change (Cloudflare's API), not part of the subscription flow.

Route order in `POST /`: `requireSignupsOpen` → burst and daily limiters → `validateBody` → honeypot (silent success, as today) → form token (silent success, as today) → `verifyTurnstile(req.body.turnstileToken, req.ip)`:
- `'failed'` → `200 { success: false, message: "We couldn't verify that you're human. Please try again." }` (a human needs to hear this; the honeypot and form token stay silent because only bots trip them).
- `'unavailable'` → `200 { success: false, message: 'Signups are unavailable right now. Please try again later.' }`.
- then `subscribeService.subscribe({ email })`.

The existing `{ success: false, message }` with status 200 is kept for every refusal except the pause, which is the one the client must tell apart by code.

**3. Normalization.** `normalizeEmail(email)` (trim + lowercase, nothing else) exported from `services/subscribe.ts`, applied at the top of `subscribe()` and `confirmSubscription()`, so every lookup, delete, create, send and the confirm link use the normalized address. The zod schemas gain `.trim()` before `.email()` so a padded address validates. Existing rows: a data-only migration (ADR-0023, below).

**4 and 5. Send limits.** New `server/src/services/subscribeLimits.ts`, `checkSendAllowance(email)` returning `'ok' | 'address-limited' | 'global-cap'`:
- Per address: an unconfirmed `PendingSubscription` for this (normalized) email with `createdAt` newer than `perAddressWindowHours` (default 24) → `'address-limited'`.
- Global: count of all `PendingSubscription` rows with `createdAt` in the last hour `>= globalHourlyMax` (default 30) → `'global-cap'`, and alert the owner through `notifyEvent('Newsletter signup cap reached', '<n> confirmation emails in the last hour; new signups are refused until the hour passes.')` at most once per hour (module-level `lastCapAlertAt`; a deploy resets it, costing at most one extra alert). The alert carries no address.
- Both read Postgres (ADR-0022), so they hold across deploys and instances. A row is exactly one sent confirmation email because `subscribe()` deletes the row it created when the send fails (new), and the re-subscribe `deleteMany` only ever removes unconfirmed rows older than the per-address window, so the hourly count is exact. Two simultaneous requests for one address can both pass; the per-IP burst limit makes that rare, and it costs at most one extra email. Accepted.

`subscribe()` becomes: normalize → already-confirmed check (silent success) → `checkSendAllowance`: `'address-limited'` → return silently (route answers with the same generic success, nothing sent, nothing written); `'global-cap'` → throw new `SignupUnavailableError` ("Signups are unavailable right now. Please try again later.", mapped by the route like `EmailValidationError`) → Plunk verify (unchanged, best-effort) → delete unconfirmed rows → create row → send; on send failure delete the created row by id, then throw `ConfirmationEmailError` as today. The limit check sits before Plunk verify so a throttled request makes no external call.

Placement: `subscribe.ts` keeps the signup flow; the limits module owns the throttling policy and its alert, a separate reason to change (tuning, alerting) that would otherwise be the third concern bolted into `subscribe()`. Two functions' worth of code, but it hides the window arithmetic, the alert throttle and the notify import behind one call.

**6. Confirmation email.** Remove `firstName` from the route schema, `SubscribeParams`, `sanitizeFirstName` (deleted) and the email. The greeting becomes "Hi," and a new closing paragraph replaces "If you didn't request this, you can safely ignore this email.": "You got this email because someone entered this address at actuallyrelevant.news. If it wasn't you, do nothing and you won't hear from us again." (American English, no em dash.) The expiry sentence stays. Nothing the visitor typed appears in the email except the address it is sent to, inside the confirm link.

**7. No duplicate sends.** New `isConnectionNotEstablished(err)` in `lib/retry.ts`: true only when there is no `response` and `err.code` is `ECONNREFUSED`, `ENOTFOUND` or `EAI_AGAIN` (the request certainly never reached Plunk). `plunk.sendTransactional` uses `withRetry(…, { retries: 2, retryOn: isConnectionNotEstablished })`. A timeout, `ECONNRESET`, 429 or 5xx is not retried. `sendTransactional` has one caller (the confirmation email), and any transactional send has the same duplicate risk, so the change belongs in `plunk.ts` rather than a parameter.

**Migration (ADR-0023).** `npm run db:migrate:create --prefix server -- --name lowercase_pending_subscription_emails` (no schema change, so Prisma writes an empty migration), then hand-write:

```sql
UPDATE "pending_subscriptions" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
```

Review per `.context/database-migrations.md` (delete any generated `DROP INDEX "stories_embedding_idx"`); apply only to the local DB by restarting the dev server. Safe: `email` has no unique constraint, so two rows collapsing to one address cannot fail; the already-confirmed check returns early on either, the re-subscribe `deleteMany` clears stale unconfirmed ones, and the admin reconciliation (`subscribers.ts`) and the cleanup script already compare lowercased. In-flight links carrying a mixed-case address still confirm because `confirmSubscription` normalizes its input. Alternative rejected: `mode: 'insensitive'` on every query, which leaves two spellings stored, needs remembering on every future query and cannot use the plain email index.

### Client

**Single source of truth.** `SubscribeForm` gets an availability state `'checking' | 'open' | 'paused'` from the existing token fetch: success → `'open'`; `ApiError` with `code === 'SIGNUPS_PAUSED'` → `'paused'` immediately, no second attempt. A paused answer to the POST (switch flipped while the form was open) also flips to `'paused'`. The existing "Signups are paused" view renders for `'paused'`; `'checking'` renders the form with submit disabled, as the token load does today. `ApiError` in `lib/api.ts` gains an optional `code` read from the error body (one constructor argument; existing callers unaffected).

**First name** input, state and payload removed; the email input takes the `ref` and `autoFocus`.

**Turnstile on submit (changed during implementation, see below).** New `client/src/lib/turnstile.ts`, `getTurnstileToken(siteKey, container)`: on the first call it loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` (module-level promise, injected `<script async>`; a load failure clears the promise so the next submit tries again), renders a widget into the given container with `execution: 'execute'` and `appearance: 'interaction-only'`, calls `turnstile.execute`, and resolves with the token from `callback` (rejecting on `error-callback`); the widget is removed once it has answered, because a token is single-use and every submit gets a fresh one. No npm dependency: the API is four calls, and a wrapper package would add a dependency for no gain. Site key from a new `TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''` in `client/src/config.ts` (replacing the removed constant; the file `vite.config.ts` already imports).

When it loads: only when the visitor submits the form with an address (button or Enter; the browser's `type="email"` validation runs first). Nothing contacts Cloudflare when a page loads, the modal opens or the form renders, so a visitor who never submits never reaches Cloudflare, and nothing of Turnstile reaches the prerendered HTML. While the challenge runs the submit button shows a pending label ("Verifying...") and is disabled; if Cloudflare decides the visitor must interact, the challenge appears in a container above the button at that moment, and the signup is posted once it yields a token. If the script fails to load or the challenge errors, an inline `role="alert"` message reads "We couldn't verify that you're human. Please try again." and the form stays usable for another attempt. Submit stays disabled only until the form token exists. Without a site key (local dev) no challenge runs and no token is sent; the server skips the check outside production. The Cloudflare iframe brings its own accessible name and keyboard handling; we add nothing inside it.

*Change during implementation, relayed by the coordinator as the owner's (2026-10-08; not confirmed by the owner in this session):* visitors who don't register must not contact Cloudflare at all, so the script loads on submit, not when the email field is engaged as first planned. This replaces the earlier `TurnstileWidget.tsx` (visible managed widget rendered after the field was focused, submit gated on its token, remounted after a failed submit).

**CSP.** The API's helmet CSP governs only API responses. The static site has no CSP in the repo; if the Render dashboard sets one, it needs `https://challenges.cloudflare.com` in `script-src` and `frame-src` (owner check, listed in Out of Scope as a dashboard step).

### Docs, privacy page, settings

- `.context/subscription.md` rewritten to the new behavior: the switch and its 503, the gate order, Turnstile and its fail-closed rule, normalization and the migration, the two send limits and the alert, the rollback on send failure, the no-retry send, the email's contents, the client availability states. Corrections the audit names: the form token does **not** stop scripts that POST straight to the API (a script can fetch one, wait 1.5 s and reuse it for 30 min; Turnstile is now the gate that does), and the burst and daily limiters cover only `POST /api/subscribe`, while the token and confirm routes share the generous public limiter. Config table gains `enabled`, `turnstileSecretKey`, `perAddressWindowHours`, `globalHourlyMax`; env list gains `VITE_TURNSTILE_SITE_KEY`; a note that local development needs `SUBSCRIPTIONS_ENABLED=true` in `.env` to see the form, and that Cloudflare's always-pass test keys work for a local widget.
- `.context/newsletter-podcast.md` line 52: Plunk adds its own footer unsubscribe link and, since 2026-08-09, one-click unsubscribe headers; our template carries no unsubscribe link (removed in February).
- `PrivacyPage.tsx`: the Newsletter section lists the email address only (drop the IP-by-Plunk item; our server calls Plunk, so Plunk never sees the visitor's IP). Replace "We will never share, sell, or distribute your email address to any third party" with: we never sell or share it for others' purposes; Plunk and its delivery provider Amazon SES (Amazon Web Services) process it on our behalf to send the emails. Add a sentence on the signup form: Cloudflare Turnstile checks that a person is submitting it and receives the visitor's IP address and browser data only when they submit the signup form, for bot protection only. Third-party table: Plunk row "Email address (if you subscribe), delivered through Amazon SES"; new Cloudflare Turnstile row (bot protection on the newsletter form; IP address and browser signals when you use the form; Cloudflare processes them on our behalf, which may involve a transfer to the USA; link to Cloudflare's Turnstile privacy addendum). The "we do not load scripts from external CDNs" paragraph names the second exception: Turnstile loads from Cloudflare only when you submit the signup form. Implementer checks Cloudflare's Turnstile privacy addendum before keeping the page's "no cookies" opening unchanged, and words only what that document states. One em dash per paragraph at most, American English.
- No `render.yaml` exists (`.context/deployment.md`: the dashboard is the source of truth, documented in the README), so the new variables go into `README.md`'s Render tables: backend `SUBSCRIPTIONS_ENABLED` (default closed) and `TURNSTILE_SECRET_KEY`; static site `VITE_TURNSTILE_SITE_KEY`. Names only. `server/env.example` is not touched (uncommitted unrelated edits in it).

### Landing

Commit to `main` with a pathspec on every commit (`git commit -m "…" -- <paths>`), staging nothing else; the working tree holds unrelated uncommitted work (podcast, jobs, `notify.ts`, admin jobs page, `env.example`, `BACKLOG.md`, `AlertChannelWarning`) that must stay untouched. `notify.ts` is only imported, never edited. Never push. The commit that adds Turnstile flags the new third-party processing: visitor IP address and browser signals are sent to Cloudflare (a third party, processing on our behalf) when a visitor uses the signup form; no new npm dependency.

Rollout order for the owner (after merge): deploy the API first (unset `SUBSCRIPTIONS_ENABLED` keeps it paused), then the static site. A client deployed against the old API would see a 200 token and open the form.

### Alternatives considered

- **Kill switch:** a separate `GET /api/subscribe/status` endpoint (rejected: one more request per page and a second thing to keep consistent; the token fetch already happens on render); returning `200 { paused: true }` from the token route (rejected: a paused API should refuse, and 503 + code is what the owner asked for).
- **Send limits:** in-memory counters like express-rate-limit (rejected, ADR-0022: reset on deploy, the weakness the audit lists); a new table or columns for send attempts (rejected: the pending row already is the send record once failed sends are rolled back; no schema change needed).
- **Normalization:** case-insensitive queries without a migration (rejected, see ADR-0023 above).
- **Turnstile loading:** on form mount (rejected: the modal mounts on every page); an npm wrapper such as `@marsidev/react-turnstile` (rejected: no need for a dependency to wrap three calls).
- **Send retry:** no retry at all (acceptable to the owner, but a refused connection or DNS blip is common on a cold host and certainly undelivered, so retrying exactly those is safe and keeps a transient failure from reaching the visitor).

## Changes

| File | Change |
|------|--------|
| `server/src/config.ts` | `config.subscribe` gains `enabled` (`SUBSCRIPTIONS_ENABLED === 'true'`), `turnstileSecretKey` (`TURNSTILE_SECRET_KEY`), `perAddressWindowHours` (`SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS`, 24), `globalHourlyMax` (`SUBSCRIBE_GLOBAL_HOURLY_MAX`, 30) |
| `server/src/lib/turnstile.ts` | **New.** siteverify call with idempotency key, retry, fail-closed rule, startup log |
| `server/src/services/subscribeLimits.ts` | **New.** Per-address and global allowance from `pending_subscriptions`, hourly-throttled owner alert |
| `server/src/lib/retry.ts` | New exported predicate `isConnectionNotEstablished` beside `isRetryableError` |
| `server/src/services/plunk.ts` | `sendTransactional` retries only on `isConnectionNotEstablished`, at most 2 times |
| `server/src/services/subscribe.ts` | New `normalizeEmail`, new `SignupUnavailableError`; `subscribe()` takes `{ email }` only, normalizes, calls `checkSendAllowance`, deletes its row when the send fails; `sanitizeFirstName` and the first-name greeting removed; new "why you got this" line; `confirmSubscription` normalizes |
| `server/src/routes/public/subscribe.ts` | `requireSignupsOpen` middleware on `GET /token` and `POST /`; `firstName` out of the schema, `turnstileToken` in; `.trim()` on both email schemas; Turnstile check after the form token; `SignupUnavailableError` mapped to `success: false` |
| `server/prisma/migrations/<ts>_lowercase_pending_subscription_emails/migration.sql` | **New.** Data-only `UPDATE` lowercasing and trimming stored addresses |
| `client/src/config.ts` | Remove `SUBSCRIPTIONS_ENABLED`; add `TURNSTILE_SITE_KEY` from `VITE_TURNSTILE_SITE_KEY` |
| `client/src/lib/api.ts` | `ApiError` gains optional `code` from the error body; `subscribe()` payload drops `firstName`, adds `turnstileToken` |
| `client/src/lib/turnstile.ts` | **New.** Loads the Turnstile script on first use, runs one on-demand challenge, returns its token |
| `client/src/components/SubscribeForm.tsx` | Availability state from the token fetch (paused on `SIGNUPS_PAUSED`, no retry); first-name field removed; Turnstile challenge run on submit with a "Verifying..." state; inline error on challenge failure; paused answer to the POST switches to the paused view |
| `client/src/pages/PrivacyPage.tsx` | Plunk IP claim and "never shared" claim corrected; Plunk/Amazon SES as processors; Cloudflare Turnstile paragraph, table row and CDN exception |
| `.context/subscription.md` | Rewritten to the new behavior, with the audit's corrections |
| `.context/newsletter-podcast.md` | Stale unsubscribe-link line fixed |
| `README.md` | Render env tables: `SUBSCRIPTIONS_ENABLED`, `TURNSTILE_SECRET_KEY` (backend), `VITE_TURNSTILE_SITE_KEY` (static site) |
| `server/src/services/subscribe.test.ts`, `server/src/routes/public/subscribe.test.ts`, `server/src/services/plunk.test.ts`, `server/src/lib/retry.test.ts` | Updated and extended (Tests) |
| `server/src/lib/turnstile.test.ts`, `server/src/services/subscribeLimits.test.ts` | **New** tests |
| `client/src/components/SubscribeForm.test.tsx`, `SubscribeForm.disabled.test.tsx` | Updated: first-name tests out, paused now driven by the API mock |
| `client/src/lib/turnstile.test.ts` | **New** test |

New files:
- `server/src/lib/turnstile.ts` — *Responsibility:* decide whether a Turnstile token proves a human, including the fail-closed rule when Cloudflare or the secret is missing. *Exports:* `verifyTurnstile`.
- `server/src/services/subscribeLimits.ts` — *Responsibility:* decide whether a confirmation email may be sent now, per address and globally, and alert the owner when the global cap trips. *Exports:* `checkSendAllowance`.
- `client/src/lib/turnstile.ts` — *Responsibility:* load Cloudflare's Turnstile script on demand and turn one challenge into a token. *Exports:* `getTurnstileToken`.

Also check `server/src/app.test.ts` (it POSTs to `/api/subscribe` for a CORS check): with the switch closed by default it now gets 503; the CORS assertion should hold, otherwise enable the switch in that test.

## Tests

Server (patterns: `vi.hoisted()` mocks, supertest against `app`, mocked prisma as in `subscribe.test.ts`; toggle `config.subscribe.enabled` / `turnstileSecretKey` and `process.env.NODE_ENV` per test and restore them):
- `turnstile.test.ts`: no secret outside production → `'ok'` without a call; no secret in production → `'unavailable'`; empty token → `'failed'` without a call; siteverify `success: true` → `'ok'` with `remoteip` sent; `success: false` → `'failed'`; network error on every attempt → `'unavailable'`; a retried call reuses the same `idempotency_key`.
- `subscribeLimits.test.ts`: recent unconfirmed row → `'address-limited'`; only an older one → `'ok'`; hourly count at the cap → `'global-cap'` and one `notifyEvent`; a second cap hit within the hour sends no second alert; after an hour (fake timers) it alerts again; the alert text carries no address.
- `subscribe.test.ts`: mixed-case padded input is stored, looked up and sent lowercased; `'address-limited'` → resolves with no create, delete or send; `'global-cap'` → throws `SignupUnavailableError`, nothing sent; send failure deletes the created row and throws `ConfirmationEmailError`; `confirmSubscription` matches a lowercased row from mixed-case input; firstName tests removed.
- `routes/public/subscribe.test.ts`: switch closed → `GET /token` and `POST /` answer 503 `SIGNUPS_PAUSED` and the service is not called; `POST /confirm` still works while closed; Turnstile `'failed'` and `'unavailable'` → `success: false` with their messages, service not called; Turnstile runs only after the honeypot and form token pass; `SignupUnavailableError` → `success: false`; a `firstName` in the body is not passed on.
- `retry.test.ts`: `isConnectionNotEstablished` true for `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` without a response, false for timeout, `ECONNRESET`, 429 and 5xx.
- `plunk.test.ts`: `sendTransactional` is not retried on a timeout or 500, and is retried on `ECONNREFUSED`.

Client (Vitest + RTL, `publicApi` mocked as today):
- `SubscribeForm`: token endpoint rejecting with `ApiError` code `SIGNUPS_PAUSED` → paused view, token fetched once (replaces `SubscribeForm.disabled.test.tsx`'s constant-driven tests); paused answer to the POST → paused view; no first-name field and none in the payload; with a site key mocked, rendering and typing request no Turnstile token, and submit requests one and sends it as `turnstileToken`; a challenge failure shows an inline error, posts nothing, and leaves the form usable; without a site key the form submits with the form token alone.
- `turnstile.ts`: rendering nothing injects no script; the first call injects the script once, later calls reuse it; the challenge's token resolves, its error rejects, and the widget is removed either way; a script load failure rejects and the next call tries again.

No tests for the email copy, privacy page text, docs or config defaults (static content).

## Out of Scope

- Plunk webhooks, contact purge changes, sunset policy, consent IP logging, DMARC (owner's exclusions).
- The per-IP limiter weaknesses (memory store reset on deploy, IPv6 keyed per address) and Plunk's fail-open email verify: unchanged.
- Email addresses in server logs (existing `log.info({ email })` calls): unchanged.
- Turnstile `hostname`/`action` checks in siteverify: not added.
- Owner dashboard steps, not code: create the Turnstile widget in Cloudflare for `actuallyrelevant.news`; set `TURNSTILE_SECRET_KEY` on the API and `VITE_TURNSTILE_SITE_KEY` on the static site; add `challenges.cloudflare.com` to `script-src` and `frame-src` if the static site has a CSP header; set `SUBSCRIPTIONS_ENABLED=true` only once Plunk is active again.
- `server/env.example` and `BACKLOG.md` (its line on `SUBSCRIPTIONS_ENABLED` in `client/src/config.ts` goes stale): both carry unrelated uncommitted edits, so they are left for a follow-up once that work lands.
