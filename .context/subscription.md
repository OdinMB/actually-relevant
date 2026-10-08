# Email Subscription

Double opt-in newsletter signup. A visitor submits an email, receives a confirmation link, and confirms by clicking a button. Plunk delivers the email and holds the contact list. Visitors are unauthenticated public users, separate from admin `User` accounts.

## Configuration

`config.subscribe` in `server/src/config.ts`:

| Key | Default | Env override | Meaning |
|---|---|---|---|
| `enabled` | `false` | `SUBSCRIPTIONS_ENABLED` (`true` to open) | The one signup switch. Anything but `true`, a missing value included, means paused |
| `turnstileSecretKey` | empty | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret. Empty in production refuses every signup; empty elsewhere skips the check, with a startup warning |
| `perAddressWindowHours` | 24 | `SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS` | At most one confirmation email per normalized address within this window |
| `globalHourlyMax` | 30 | `SUBSCRIBE_GLOBAL_HOURLY_MAX` | At most this many confirmation emails per rolling hour across all addresses |
| `confirmTokenExpiryHours` | 24 | `SUBSCRIBE_TOKEN_EXPIRY_HOURS` | Lifetime of a confirmation link |
| `rateLimitWindowMs` / `rateLimitMax` | 60 s / 3 | `SUBSCRIBE_RATE_LIMIT_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_MAX` | Per-IP burst limit on `POST /api/subscribe` only |
| `rateLimitDailyWindowMs` / `rateLimitDailyMax` | 24 h / 20 | `SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_DAILY_MAX` | Per-IP sustained limit on `POST /api/subscribe` only |
| `minFormFillMs` | 1500 | `SUBSCRIBE_MIN_FORM_FILL_MS` | Form tokens younger than this are rejected (too fast for a human) |
| `formTokenMaxAgeMs` | 1 800 000 (30 min) | `SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS` | Form tokens older than this are rejected (bounds replay) |
| `formTokenSecret` | `FORM_TOKEN_SECRET`, else `JWT_SECRET` | | HMAC key for form tokens. If empty, every token is forgeable; startup logs a warning |

The token and confirm routes (`GET /token`, `GET /confirm`, `POST /confirm`) share the generous public limiter, not the two subscribe limiters. The per-IP limiters keep their counters in memory, so a deploy resets them.

The client build reads `VITE_TURNSTILE_SITE_KEY` (`turnstileSiteKey()` in `client/src/lib/turnstile.ts`, not `config.ts`, which `vite.config.ts` imports in Node). Empty means no challenge runs.

**Local development:** set `SUBSCRIPTIONS_ENABLED=true` in the server's `.env` to see the form at all. Without Turnstile keys the form works and the server skips the check. To try the challenge, use Cloudflare's always-pass test keys (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`).

## The Switch

`requireSignupsOpen` in `server/src/routes/public/subscribe.ts` sits first on `GET /api/subscribe/token` and `POST /api/subscribe`. While `enabled` is false they answer `503 { error, code: 'SIGNUPS_PAUSED' }` and nothing else happens: no token, no Turnstile call, no row, no email. `GET /confirm` and `POST /confirm` are not behind it, so links already sent keep working while paused. Changing the variable in the Render dashboard restarts the service, so pausing needs no deploy. There is no client-side switch.

## Subscribe (`POST /api/subscribe`)

Order matters; every gate runs before any side effect:

1. **Switch**, then the per-IP burst and daily limiters, then body validation (the email is trimmed; unknown keys such as an old client's `firstName` are dropped).
2. **Honeypot** filled → success reply, nothing done (bots are not tipped off).
3. **Form token** (`server/src/lib/formToken.ts`): a signed, stateless token stamped with its issue time, valid while its age is within `[minFormFillMs, formTokenMaxAgeMs]`. Missing or invalid → success reply, nothing done. It only trips naive bots: a script can fetch a token, wait 1.5 s and reuse it for 30 minutes. It does **not** stop scripts that POST straight to the API; Turnstile does.
4. **Turnstile** (`server/src/lib/turnstile.ts`, `verifyTurnstile`): posts the token and the visitor IP to Cloudflare's siteverify, retried on network errors with one idempotency key across attempts (so a retry gets the first answer instead of `timeout-or-duplicate`). Rejected or missing token → `success: false`, "We couldn't verify that you're human". Siteverify unreachable, or no secret in production → `success: false`, "Signups are unavailable right now" (fail closed). Unlike the two silent gates, a person can fail this one, so they are told.
5. **Normalize** the address: trim and lowercase, nothing else (`normalizeEmail` in `services/subscribe.ts`). Every lookup, write, send and the confirm link use this form. Migration `20261008120000_lowercase_pending_subscription_emails` brought existing rows into it.
6. **Already confirmed** → success reply, nothing done. Unconfirmed rows do not short-circuit.
7. **Send limits** (`services/subscribeLimits.ts`, `checkSendAllowance`), counted from `pending_subscriptions` rows in Postgres so they survive deploys:
   - an unconfirmed row for this address newer than `perAddressWindowHours` → success reply, nothing written or sent (same reply as a real signup);
   - `globalHourlyMax` rows created in the last hour → `success: false`, "try again later", and one owner alert at most once per hour per process: a `subscriptions` / `warning` admin notice (key `signup-cap`, so a repeat reopens the one row; `.context/admin-notices.md`), forwarded to `WEBHOOK_URL` when that is set. The alert carries no address.
8. **Email verification via Plunk is best-effort.** Explicit failure (bad format, no MX, disposable) rejects the signup; if the verify API errors, the check is skipped.
9. **Re-subscribe:** delete unconfirmed rows for the address (only rows older than the per-address window can be there).
10. Create the `PendingSubscription` (single-use UUID `token`, `plunkContactId: null`, `expiresAt = now + confirmTokenExpiryHours`) and send the confirmation email. **If the send fails, the row is deleted again**, so each row stands for exactly one sent email and the limits count exactly.

**No duplicate sends:** `plunk.sendTransactional` retries only when the connection was never made (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`; `isConnectionNotEstablished` in `lib/retry.ts`). A timeout, reset, 429 or 5xx may come after Plunk accepted the email, so it is not retried.

**The confirmation email repeats nothing the visitor typed** apart from the address it goes to, inside the confirm link. There is no name field. It ends with a line saying someone entered this address at actuallyrelevant.news and that, if it wasn't them, they need do nothing and won't hear from us again.

**Plunk contact side effect:** Plunk creates a contact for every transactional recipient, so sending the confirmation email leaves a Plunk contact with `subscribed: false` even when the signup is never confirmed (see the cleanup script below).

## Confirm

- The link in the email points to `GET /api/subscribe/confirm`, which **only redirects** to the client confirmation page (`client/src/pages/SubscribedPage.tsx`) and never changes state. This keeps email scanners that prefetch links from auto-confirming.
- A human button click sends `POST /api/subscribe/confirm` with `{ token, email }`. The email is normalized first, so links sent before normalization still match. Both must match the same pending row.
- Confirming an already-confirmed row is a no-op success. An expired, unconfirmed row is rejected.
- On confirm, the Plunk contact is upserted to `subscribed: true` and its id is stored in `plunkContactId`, then `confirmedAt = now`. If Plunk fails, the row is still marked confirmed locally and `plunkContactId` stays null.

## Client Behavior

- `SubscribeForm` (`client/src/components/SubscribeForm.tsx`, used by `SubscribeModal` on every public page and by `/newsletter`) has one email field and a hidden honeypot. Its token fetch on mount also decides availability: a token opens the form; `ApiError` with code `SIGNUPS_PAUSED` shows the "Signups are paused" notice at once (no retry); a paused answer to the POST does the same. While the token loads, submit is disabled.
- **Turnstile loads only on submit** (`client/src/lib/turnstile.ts`, `hooks/useTurnstileChallenge.ts`, no npm dependency). Owner rule: a visitor who does not sign up never contacts Cloudflare, so rendering, focusing or typing in the form requests nothing; the modal is mounted (closed) on every page, and the script must never reach prerendered pages. On submit (button or Enter) the form first checks the address shape (`something@domain.suffix`; a bad one shows the inline error and requests nothing), then, when a site key is set, injects Cloudflare's script, renders a widget with `execution: 'execute'`, `appearance: 'interaction-only'` (invisible unless Cloudflare needs the visitor to interact) and `retry: 'never'`, runs it, and POSTs with the token. The button reads "Verifying..." meanwhile, then "Subscribing...". Every submit runs a fresh challenge, because a token is single-use, and the widget is removed as soon as it settles or the form unmounts. A challenge always settles: one that has neither a token nor a failure within 30 s (`TURNSTILE_TIMEOUT_MS`, script load included) counts as failed. A script-load failure, challenge error, timeout or unsupported browser shows the inline human-check error with `role="alert"` and leaves the form usable; submitting again retries, reloading the script if it failed.
- On success it tells the visitor to check their inbox. On any refusal it shows the message inline and never claims the email was sent.
- `SubscribedPage` does not confirm on load. It shows a confirm button. Success shows a welcome state, an expired link suggests subscribing again, and a transient or network error keeps the button so the visitor can retry.

**CSP:** if the static site ever gets a Content-Security-Policy header (none today), it needs `https://challenges.cloudflare.com` in `script-src` and `frame-src`.

## Cleaning Up Plunk Contacts

Two operator scripts in `server/src/scripts/`, both run by hand and both previewing by default. **Run them only from the Render API service's Shell** (dashboard: the API web service, Shell tab), where the production `DATABASE_URL` and Plunk key are set. Never run them locally: the protection sets (who confirmed, who confirmed again) come from whatever database `DATABASE_URL` points at, so a local run would judge production Plunk contacts against the dev database. Both need an active Plunk account; a suspended one returns 403 `PROJECT_DISABLED`.

Render's Shell opens inside the `server` folder, so the commands below take no `--prefix server`.

### Never-confirmed contacts (`cleanup-plunk-contacts.ts`)

```bash
npm run cleanup:plunk-contacts        # dry run
npm run cleanup:plunk-contacts:apply  # deletes
```

It deletes Plunk contacts that are not subscribed, have no confirmed local `PendingSubscription`, were created more than 14 days ago (`PURGE_MIN_AGE_DAYS`), and fall outside the import guard. Subscribed contacts, and anyone who ever confirmed locally, are never touched.

- **Import guard:** the owner imported the previous provider's subscribers straight into Plunk on 15 February 2026, 01:36 Berlin time. Those contacts have no local `PendingSubscription`, so one who later unsubscribed (or was unsubscribed after a complaint) looks like a bot, and deleting the contact would erase Plunk's record that they opted out. Contacts created inside a protected window are never purged. The default window is `2026-02-14T23:00Z` to `2026-02-16T00:00Z` (start inclusive, end exclusive), the import day in Berlin and in UTC. `--protect-created=<ISO start>..<ISO end>` replaces it and may be repeated (each end is a plain date, read as UTC midnight, or a date-time with `Z` or an offset; a zoneless date-time is rejected because it would parse in the machine's local zone); repeat the default window if it should still apply, e.g. `npm run cleanup:plunk-contacts -- --protect-created=2026-02-14T23:00Z..2026-02-16T00:00Z --protect-created=<other window>`.
- **Dry run** (default) is read-only. Besides the first 20 addresses it prints the purgeable contacts per UTC creation day (top 15 by count), so another import spike shows up as one large day, and how many contacts the import guard kept that would otherwise have been purged.
- **Apply** deletes the purgeable contacts, 200 ms apart, and prints deleted and failed counts.

### Fast pre-June confirmations (`cleanup-fast-confirmations.ts`)

Before 2026-06-03 the confirm link changed state on GET, so link scanners "confirmed" bot-submitted addresses within seconds. This script unsubscribes (never deletes) those Plunk contacts, so a real person caught by mistake can sign up again. Plunk cannot reset complaint stats, so it is deliberately conservative.

```bash
npm run cleanup:fast-confirmations                              # gap distribution only
npm run cleanup:fast-confirmations -- --max-seconds=10          # + addresses that would go
npm run cleanup:fast-confirmations:apply -- --max-seconds=10    # unsubscribes
```

- **Preview** (default) reads only the database and changes nothing. It prints how all confirmed signups created before the cutoff spread over confirmation gaps (`<5s`, `5-10s`, `10-30s`, `30-60s`, `1-5min`, `5-60min`, `>1h`), so the owner picks the threshold from data; with `--max-seconds=N` it also lists every candidate with its gap.
- **Candidates:** addresses (lowercased, deduped) whose every confirmed signup created before the cutoff (`--before=YYYY-MM-DD`, default 2026-06-03) has a gap strictly below N seconds.
- **Never touched:** an address with a confirmed signup created on or after the cutoff (a genuine re-confirmation through the button flow), an address with any pre-cutoff confirmation at or above N, and any contact not currently subscribed in Plunk.
- **Apply** refuses to run without an explicit `--max-seconds`. It sets each remaining contact to `subscribed: false` through `POST /contacts` (the upsert the confirm flow uses), 200 ms apart, and prints a summary: unsubscribed, skipped (not subscribed in Plunk), skipped (re-confirmed), failed.

## Key Files

- Server: `server/src/services/subscribe.ts`, `server/src/services/subscribeLimits.ts`, `server/src/services/plunk.ts`, `server/src/routes/public/subscribe.ts`, `server/src/lib/formToken.ts`, `server/src/lib/turnstile.ts`
- Client: `client/src/components/SubscribeForm.tsx`, `client/src/lib/turnstile.ts`, `client/src/hooks/useTurnstileChallenge.ts`, `SubscribeModal.tsx`, `SubscribeProvider.tsx`, `client/src/pages/SubscribedPage.tsx`
- Admin reconciliation view: see `admin-dashboard.md` (Subscribers page)
- Decisions: ADR-0021 (Turnstile), ADR-0024 (Turnstile loads only on submit; supersedes ADR-0021's loading), ADR-0022 (limits from rows), ADR-0023 (normalized storage) in `.context/decisions/`
