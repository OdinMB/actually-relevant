# Email Subscription

Double opt-in newsletter signup. A visitor submits an email, receives a confirmation link, and confirms by clicking a button. Plunk delivers the email and holds the contact list. Visitors are unauthenticated public users, separate from admin `User` accounts.

## Configuration

`config.subscribe` in `server/src/config.ts`:

| Key | Default | Env override | Meaning |
|---|---|---|---|
| `enabled` | `false` | `SUBSCRIPTIONS_ENABLED` (`true` to open) | The one signup switch. Anything but `true`, a missing value included, means paused |
| `turnstileSecretKey` | empty | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret, shared with the feedback form. Empty in production refuses every signup; empty elsewhere skips the check, with a startup warning. Feedback skips the check whenever it is empty, production included |
| `perAddressWindowHours` | 24 | `SUBSCRIBE_PER_ADDRESS_WINDOW_HOURS` | At most one confirmation email per normalized address within this window |
| `globalHourlyMax` | 30 | `SUBSCRIBE_GLOBAL_HOURLY_MAX` | At most this many confirmation emails per rolling hour across all addresses, sent at once and queued together. A signup over it is queued, not refused ("Queued Signups") |
| `confirmTokenExpiryHours` | 24 | `SUBSCRIBE_TOKEN_EXPIRY_HOURS` | Lifetime of a confirmation link, counted from when the email goes out. Also the longest a queued signup waits: one that is still unsent this long after signing up is removed |
| `rateLimitWindowMs` / `rateLimitMax` | 60 s / 3 | `SUBSCRIBE_RATE_LIMIT_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_MAX` | Per-IP burst limit on `POST /api/subscribe` only |
| `rateLimitDailyWindowMs` / `rateLimitDailyMax` | 24 h / 20 | `SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_DAILY_MAX` | Per-IP sustained limit on `POST /api/subscribe` only |
| `minFormFillMs` | 1500 | `SUBSCRIBE_MIN_FORM_FILL_MS` | Form tokens younger than this are rejected (too fast for a human) |
| `formTokenMaxAgeMs` | 1 800 000 (30 min) | `SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS` | Form tokens older than this are rejected (bounds replay) |
| `formTokenSecret` | `FORM_TOKEN_SECRET`, else `JWT_SECRET` | | HMAC key for form tokens. If empty, every token is forgeable; startup logs a warning |

The form-token keys (`minFormFillMs`, `formTokenMaxAgeMs`, `formTokenSecret`) and `turnstileSecretKey` also serve the feedback form, which runs the same bot gate (`.context/public-website.md`, "Feedback").

The token and confirm routes (`GET /token`, `GET /confirm`, `POST /confirm`) share the generous public limiter, not the two subscribe limiters. The per-IP limiters keep their counters in memory, so a deploy resets them.

The client build reads `VITE_TURNSTILE_SITE_KEY` (`turnstileSiteKey()` in `client/src/lib/turnstile.ts`, not `config.ts`, which `vite.config.ts` imports in Node). Empty means no challenge runs.

**Local development:** set `SUBSCRIPTIONS_ENABLED=true` in the server's `.env` to see the form at all. Without Turnstile keys the form works and the server skips the check. To try the challenge, use Cloudflare's always-pass test keys (site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`).

## The Switch

`requireSignupsOpen` in `server/src/routes/public/subscribe.ts` sits first on `GET /api/subscribe/token` and `POST /api/subscribe`. While `enabled` is false they answer `503 { error, code: 'SIGNUPS_PAUSED' }` and nothing else happens: no token, no Turnstile call, no row, no email. `GET /confirm` and `POST /confirm` are not behind it, so links already sent keep working while paused. Changing the variable in the Render dashboard restarts the service, so pausing needs no deploy. There is no client-side switch.

## Subscribe (`POST /api/subscribe`)

Order matters; every gate runs before any side effect:

1. **Switch**, then the per-IP burst and daily limiters, then body validation (the email is trimmed; unknown keys such as an old client's `firstName` are dropped).
2. **Honeypot** filled → success reply, nothing done (bots are not tipped off).
3. **Form token** (`server/src/lib/formToken.ts`): a signed, stateless token stamped with its issue time and the form it was issued for (`subscribe` or `feedback`), valid only on that form and while its age is within `[minFormFillMs, formTokenMaxAgeMs]`, so a feedback token is no signup token. Missing or invalid → success reply, nothing done. It only trips naive bots: a script can fetch a token, wait 1.5 s and reuse it for 30 minutes. It does **not** stop scripts that POST straight to the API; Turnstile does.
4. **Turnstile** (`server/src/lib/turnstile.ts`, `verifyTurnstile`): posts the token and the visitor IP to Cloudflare's siteverify, retried on network errors with one idempotency key across attempts (so a retry gets the first answer instead of `timeout-or-duplicate`). Rejected or missing token → `success: false`, "We couldn't verify that you're human". Siteverify unreachable, or no secret in production → `success: false`, "Signups are unavailable right now" (fail closed). Unlike the two silent gates, a person can fail this one, so they are told. A caller can pass `skipWithoutSecret` to skip the check, production included, while no secret is set; only the feedback route does.
5. **Normalize** the address: trim and lowercase, nothing else (`normalizeEmail` in `services/subscribe.ts`). Every lookup, write, send and the confirm link use this form. Migration `20261008120000_lowercase_pending_subscription_emails` brought existing rows into it.
6. **Already confirmed, unless Plunk shows a reader who left cleanly** → success reply, nothing done. Unconfirmed rows do not short-circuit. A confirmed row alone does not settle it: a reader who left through Plunk's unsubscribe link keeps their confirmed row here while Plunk marks the contact `subscribed: false`. So for an address with a confirmed row the server asks Plunk once (`findContactsByEmail` in `services/plunk.ts`: one read-only `GET /contacts?search=<address>` page, retried on transient errors by `withRetry`, keeping only contacts whose address matches exactly once lowercased; it throws when the answer spans more than one page or carries no contact array, rather than answer from part of the list). An address with no confirmed row costs no lookup.
   - **No complaint or bounce on record:** Plunk marks a spam complaint and a permanent bounce exactly like an unsubscribe (`subscribed: false`, no `snoozedUntil`, no suppression list), and its transactional sends ignore the flag, so an unsubscribed contact alone could be someone who complained, and one more complaint can disable the sending account (ADR-0029). For each plainly unsubscribed contact the server reads its activity once (`hasComplaintOrBounce` in `services/plunk.ts`: one read-only `GET /activity?contactId=<id>&types=email.complaint,email.bounced&limit=1`, retried by `withRetry`, parsed like the hourly complaint poll's). A contact-scoped read has no 30-day window in Plunk's activity service, so the contact's whole history counts; a bounce is on record only when permanent or of unknown type. Any complaint or bounce on record sends nothing and logs a warning with the confirmed row's id. The read counts as failed when it cannot tell: no contact id (the read would be the whole account's), an unrecognized response, or an item of another type or another contact (a filter was not applied, and a page of one could hide an older complaint);
   - **No longer subscribed and clean** (Plunk holds no contact for the address, or only plainly unsubscribed ones with no complaint or bounce on record) → a **returning reader**: steps 7 to 10 run exactly as for a first-time signup (limits, queue, per-address window, verification, the confirmation email), and confirming marks the contact subscribed again. Their earlier confirmed row stays as it was (step 9 removes only unconfirmed rows), so the cleanup scripts still see that the address once confirmed. Plunk holding no contact means it keeps no activity for the address either, so nothing is checked there (a contact deleted by hand loses its complaint record with it);
   - **anything else sends nothing**, so a subscriber never gets a confirmation email they don't need and a complainer never gets one at all: a subscribed contact, a snoozed one (Plunk resubscribes it when the snooze ends), a `subscribed` flag that is not a boolean, a complaint or bounce on record, and a lookup or activity read that fails (network, 4xx, a 5xx after the retries, an unreadable answer), which logs a warning with the confirmed row's id, never the address or the contact id.
7. **Send limits** (`services/subscribeLimits.ts`, `checkSendAllowance`), counted from `pending_subscriptions` rows in Postgres so they survive deploys:
   - an unconfirmed row for this address created, or whose email went out, within `perAddressWindowHours` (a signup still waiting in the queue included) → success reply, nothing written or sent (same reply as a real signup);
   - `globalHourlyMax` confirmation emails sent in the last hour (rows counted by `sent_at`), or earlier signups still waiting with room in the hour → the signup is **queued**: steps 8 and 9 run as usual, step 10 writes its row without sending, and the visitor gets the same success reply as a sent signup ("Queued Signups" below). Joining behind waiting signups keeps the emails in signup order, so a steady stream of new signups never starves the queue;
   - when signups wait with room in the hour, only `send_queued_confirmations` can be holding them up, so this case also reads that job's `job_runs` row. If the row is missing, the job is disabled, or it has completed no run (a failed run counts as completed) within `config.subscribe.queueStalledAfterMinutes` (30, three of its 10-minute intervals), one owner alert at most once per hour per process: a `subscriptions` / `warning` admin notice, "Queued signups are not being sent" (key `signup-queue-stalled`, linking `/admin/jobs`), naming the reason and how many wait, and pointing to the Jobs page and `SCHEDULER_ENABLED`. It carries no address. Without it a stopped job would hold every signup while the hour never fills, so the cap alert never fires;
   - when the hour is full, one owner alert at most once per hour per process: a `subscriptions` / `warning` admin notice, "Newsletter signup cap reached" (key `signup-cap`, so a repeat reopens the one row; `.context/admin-notices.md`), saying how many confirmation emails went out in the last hour, that new signups are accepted and queued, how many already wait, and that `send_queued_confirmations` sends them oldest first, at most `globalHourlyMax` an hour. It is forwarded to `WEBHOOK_URL` when that is set. The alert carries no address.
8. **Email verification via Plunk is best-effort.** Explicit failure (bad format, no MX, disposable) rejects the signup; if the verify API errors, the check is skipped.
9. **Re-subscribe:** delete unconfirmed rows for the address (only rows created, and sent if they were, before the per-address window can be there, so the hourly count is not affected).
10. Create the `PendingSubscription` (single-use UUID `token`, `plunkContactId: null`, `expiresAt = now + confirmTokenExpiryHours`), then either:
    - **send at once:** `sent_at = now` and the confirmation email goes out. **If the send fails, the row is deleted again**, so each sent row stands for exactly one sent email and the limits count exactly. The visitor sees "We couldn't send the confirmation email right now";
    - **or queue:** `sent_at` null and no email; the row waits for `send_queued_confirmations`, and its `expiresAt` bounds how long it waits.

The success reply (`{ success: true, message: "Check your email to confirm your subscription." }`) is the same for a signup sent at once, a queued one, a throttled address, a still-subscribed one and the two silent bot gates, so it never tells them apart. A returning reader gets the replies a first-time signup gets.

**No duplicate sends:** `plunk.sendTransactional` retries only when the connection was never made (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`; `isConnectionNotEstablished` in `lib/retry.ts`). A timeout, reset, 429 or 5xx may come after Plunk accepted the email, so it is not retried.

**The confirmation email repeats nothing the visitor typed** apart from the address it goes to, inside the confirm link. There is no name field. It ends with a line saying someone entered this address at actuallyrelevant.news and that, if it wasn't them, they need do nothing and won't hear from us again.

**Plunk contact side effect:** Plunk creates a contact for every transactional recipient, so sending the confirmation email leaves a Plunk contact with `subscribed: false` even when the signup is never confirmed (see the cleanup script below). A queued signup has no Plunk contact until its email goes out.

## Queued Signups

A queued signup (over the hourly limit, or behind others still waiting) waits on its own `pending_subscriptions` row: `sent_at` null, unconfirmed, `expires_at` still ahead (`waitingSignupsWhere` in `services/subscribeLimits.ts`). There is no separate queue table and nothing in memory, so the queue survives deploys and both instances of a zero-downtime deploy see the same one (ADR-0049, building on ADR-0022). `sent_at` defaults to the current time, so a row written without it counts as sent: the direct send, and rows the previous release writes while both run during a deploy, which the job therefore never sends a second time. Migration `20261029120000_signup_queue` is hand-written for that reason: it adds the column without a default, backfills it from `created_at` (each existing row was one sent email), then sets the default; adding the column with its default in one statement would stamp every existing row with the migration's time and fill the hourly limit.

The `send_queued_confirmations` job (`server/src/jobs/sendQueuedConfirmations.ts`) runs every 10 minutes (`*/10 * * * *`) and is seeded **enabled** by that migration, since a queued signup was told its email is on its way and only this job sends it (`.context/scheduler.md`). Each run:

1. **Paused:** while `SUBSCRIPTIONS_ENABLED` is off it logs at debug level and returns before anything else, so queued signups keep waiting and none is removed until signups reopen.
2. **Drops stale entries:** deletes waiting rows past their `expires_at` (a link lifetime, `confirmTokenExpiryHours`, after the signup), unsent, logs their count, never an address, and records a `subscriptions` / `warning` admin notice, "Queued signups expired unsent" (key `signup-queue-expired`, linking `/admin/subscribers`), with the count: each of them was told its email was on its way. The visitor can sign up again at once, since no row is left for the address.
3. **Reads the room left in the rolling hour:** `globalHourlyMax` minus the rows whose `sent_at` falls in the last hour, so direct and queued sends share one limit and at most 30 (by default) go out in any rolling hour. No room: it returns, and the next run tries again.
4. **Takes that many waiting rows, oldest first** (`created_at`, then `id`). A row whose address confirmed at or after the row was made (its latest `confirmed_at` against the row's `created_at`) is deleted unsent. An older confirmation does not stop it: that is a returning reader, whom step 6 queued only once Plunk had them unsubscribed.
5. **Claims each row before calling Plunk:** one conditional update, only where `sent_at` is still null, sets `sent_at` to now and `expires_at` to now + `confirmTokenExpiryHours`, so the link lives a full lifetime from the send. Then it sends the confirmation email with the token stored at signup. A claim that matches no row (a newer signup for the address replaced it, or another run sent it) skips that row, so an overlapping run, a retry or a crash never sends an email twice.

**Failure handling.** What a failed send does depends on Plunk's answer (`responseStatus` and `provedNotSent` in `lib/retry.ts`, the latter shared with the newsletter send):

- **400 or 422** (Plunk refuses this one request as invalid; each request carries one recipient, so a resend would be refused again and would hold up every signup behind it): the row is deleted unsent, the log names only its id and the status, and the run carries on with the next row.
- **Any other 4xx** (401, 403 such as `PROJECT_DISABLED`, 429) **or no connection made**: nothing went out, and the cause is the account or the rate, so the row goes back in the queue with its old expiry and the run stops. The rows after it wait for the next run.
- **A timeout, a reset or a 5xx**: Plunk may have delivered it, so the row is kept as sent and the run stops; no address ever gets a second email from the job.

The run then fails, so the scheduler records a job-failure notice under Subscriptions, linking `/admin/subscribers` (key `job-failure:send_queued_confirmations`, `.context/admin-notices.md`). A stop fails it with "A queued confirmation email failed to send (HTTP status or error code); the remaining signups wait for the next run"; refused rows with "N queued signups refused by Plunk (HTTP 400, 422) and removed", each status once; when both happen the two messages are joined into one. Neither names an address.

A crash, a timeout or a 5xx between claiming a row and Plunk's answer can lose that one confirmation: the row stays marked sent with no email behind it, and the address can sign up again only after the per-address window (`perAddressWindowHours`), since the row counts as an email sent to it.

The Subscribers page shows a queued signup as `pending`, like one whose email went out; the cap alert and the stalled-queue alert are where the number waiting appears.

## Confirm

- The link in the email points to `GET /api/subscribe/confirm`, which **only redirects** to the client confirmation page (`client/src/pages/SubscribedPage.tsx`) and never changes state. This keeps email scanners that prefetch links from auto-confirming.
- A human button click sends `POST /api/subscribe/confirm` with `{ token, email }`. The email is normalized first, so links sent before normalization still match. Both must match the same pending row.
- Confirming an already-confirmed row is a no-op success. An expired, unconfirmed row is rejected.
- On confirm, the Plunk contact is upserted to `subscribed: true` and its id is stored in `plunkContactId`, then `confirmedAt = now`. If Plunk fails, the row is still marked confirmed locally and `plunkContactId` stays null.
- A returning reader's confirm leaves the address with more than one confirmed row, one per time they confirmed. Nothing counts them twice: the Subscribers page collapses an address's rows into one (`dedupeDbRows` in `services/subscribers.ts`), the cleanup scripts read confirmed addresses as a set, and `cleanup-fast-confirmations` treats a confirmation after its cutoff as a re-confirmation that protects the address. While their new signup is unconfirmed, the Subscribers page shows the address as confirmed in the database and unsubscribed in Plunk (drift), as it did before they signed up again.

## Client Behavior

- `SubscribeForm` (`client/src/components/SubscribeForm.tsx`, used by `SubscribeModal` on every public page and by `/newsletter`) has one email field and a hidden honeypot. `SubscribeModal` mounts it only while the dialog is open, so a page view with the dialog closed requests no token, and each open mounts a fresh form that fetches one (the submit button's waiting state covers the gap); the `/newsletter` form is always mounted. Its token fetch on mount also decides availability: a token opens the form; `ApiError` with code `SIGNUPS_PAUSED` shows the "Signups are paused" notice at once (no retry); a paused answer to the POST does the same. While the token loads, submit is disabled and reads "Loading...". Any other failure is retried once; if that fails too, submit stays disabled and a calm line under the form says "The signup form can't load right now. Please reload the page or try again later.", or, when the last answer was a 429 (the token route has only the public API's request limits), "Too many requests from this network right now, so the signup form can't load. Please try again in a few minutes." It sits in a `role="status"` region that is always mounted, so it is announced when it appears, and it describes the email field (first in its `aria-describedby`). There is no retry button: the first token is fetched only on mount, and a reload (or reopening the modal, which mounts a fresh form) fetches it again. **Never while prerendering** (`isPrerendering()` in `client/src/lib/renderComplete.ts`, true when `navigator.webdriver` is set, so in Playwright too): the build's browser may not reach the API, and the line would be baked into every prerendered page.
- **The form posts only a token the server takes, however long it stays open.** The server drops a token younger than 1.5 s or older than 30 minutes and still answers success (step 3 above), so the reader would see "Check your email" and get nothing. `client/src/lib/formToken.ts` holds the client's copies of both limits (keep them in step with `config.subscribe`) and the margins below; `FeedbackForm` takes its refresh period from there too. When the reader comes back to the page (the tab turns visible, or the window gets focus) and the token is 20 minutes old or more (`FORM_TOKEN_REFRESH_MS`), the form fetches a replacement in the background, since timers stop in a background phone tab. On submit, after the human check, a token older than 25 minutes (`FORM_TOKEN_POST_MAX_AGE_MS`, five minutes spare for the check and the network) is replaced first, and a replacement is posted only once it is 1.5 s old (`FORM_TOKEN_MIN_AGE_MS`), the button reading "Subscribing..." meanwhile. The first token is posted at once, so the server's minimum still measures how fast the form was filled. A replacement fetch shares the one-retry rule and joins a fetch already under way; if it fails, a background refresh keeps the old token and a submit shows "Something went wrong. Please try again." (the rate-limit line below for a 429) and posts nothing, and a paused answer to it shows the paused notice.
- **Turnstile loads only on submit** (`client/src/lib/turnstile.ts`, `hooks/useTurnstileChallenge.ts`, no npm dependency; `FeedbackForm` uses both the same way). Owner rule: a visitor who does not sign up never contacts Cloudflare, so rendering, focusing or typing in the form requests nothing; the modal's dialog is on every page, and the script must never reach prerendered pages. On submit (button or Enter) the form first checks the address shape (`something@domain.suffix`; a bad one shows the inline error and requests nothing), then, when a site key is set, injects Cloudflare's script, renders a widget with `execution: 'execute'`, `appearance: 'interaction-only'` (invisible unless Cloudflare needs the visitor to interact) and `retry: 'never'`, runs it, and POSTs with the token. The button reads "Verifying..." meanwhile, then "Subscribing...". Every submit runs a fresh challenge, because a token is single-use, and the widget is removed as soon as it settles or the form unmounts. A challenge always settles: one that has neither a token nor a failure within 30 s (`TURNSTILE_TIMEOUT_MS`, script load included) counts as failed. A script-load failure, challenge error, timeout or unsupported browser shows the inline human-check error with `role="alert"` and leaves the form usable; submitting again retries, reloading the script if it failed.
- On success it shows "Check your email": "A confirmation link is on its way to <the address>. Click the link to start receiving our weekly newsletter." and "It usually arrives within minutes, but at busy times it can take a few hours. If you can't find it, please check your spam folder." The wording holds for a queued signup too, whose email can come hours later (at most `globalHourlyMax` go out an hour); the server's reply does not say which it was, so every success shows the same words. On any refusal it shows the message inline and never claims the email is on its way. A 429 from the signup POST shows "Too many requests from this network right now. Please try again in a few minutes, or tomorrow if this keeps happening." instead of "Something went wrong. Please try again." Three per-IP limits can answer it: first the public API's limit (`config.rateLimit.publicMax` requests per `publicWindowMs`, 100 per 15 minutes by default, one count shared with the other public routes behind it in `routes/public/index.ts`), then the signup per-minute and daily limits. The signup limits answer "Too many subscription attempts. Please try again later." and the public limit "Too many requests. Please try again later.", so only the per-minute and daily signup limits cannot be told apart by their body. The client tells none of them apart: it reads the status alone, so the line names no limit and holds for someone on a shared network who tried once.
- **What a subscriber gets** is one line under every form: `NEWSLETTER_PROMISE` in `client/src/config.ts` ("Free, no ads, once a week. Unsubscribe anytime."), which also describes the email field (`aria-describedby`). It is centered under the form's own heading (the modal) and left-aligned when the parent provides the heading (`hideHeading`, `/newsletter`). The homepage `NewsletterBanner` repeats it under its button. Keep it true: one issue a week is the `generate_newsletter` / `publish_newsletter` schedule (`.context/newsletter-podcast.md`), and the unsubscribe link is the one Plunk adds to every email. It names no weekday, because the Saturday 04:30 UTC send is still Friday in the Americas. In the modal the form also links "Read past issues" to `/newsletter` and closes the modal when it is followed (`onPastIssuesClick`); `/newsletter` lists the issues itself, so its form has no such link.
- `SubscribedPage` does not confirm on load. It shows a confirm button. Success shows a welcome state, an expired link suggests subscribing again, and a transient or network error keeps the button so the visitor can retry.
- **Only a successful confirm shows the welcome state.** Without a token and an address the page claims nothing. The prerendered HTML is that state, and the confirmation link's address serves it until the script runs, so it says the page is loading and, if it doesn't change, to open the link in the confirmation email again (chosen by `isPrerendering()`). After the script runs, a visit without them asks the reader to open that link. Every state is `noindex`, and the page is out of the sitemap (`.context/seo.md`, "The static route list").

**CSP:** if the static site ever gets a Content-Security-Policy header (none today), it needs `https://challenges.cloudflare.com` in `script-src` and `frame-src`.

## Cleaning Up Plunk Contacts

Two cleanup scripts in `server/src/scripts/`, both run by hand and both previewing by default, with a backup and restore pair to run locally before them (below), and a local script that unsubscribes a hand-picked list of addresses. **Run the cleanups only from the Render API service's Shell** (dashboard: the API web service, Shell tab), where the production `DATABASE_URL` and Plunk key are set. Never run them locally: the protection sets (who confirmed, who confirmed again) come from whatever database `DATABASE_URL` points at, so a local run would judge production Plunk contacts against the dev database. Both need an active Plunk account; a suspended one returns 403 `PROJECT_DISABLED`.

Render's Shell opens inside the `server` folder, so the cleanup commands below take no `--prefix server`.

### Back up first (`backup-plunk-contacts.ts`)

Plunk has no export, so take a backup on the owner's machine before either cleanup. It is read-only, needs only the Plunk secret key (no database), and runs locally, not on Render, whose disk is wiped on deploy. dotenv does not override a variable already set, so in PowerShell:

```powershell
$env:PLUNK_SECRET_KEY="sk_..."
npm run backup:plunk-contacts --prefix server
Remove-Item Env:PLUNK_SECRET_KEY
```

It pages through every contact and writes `DOCS/YYYY-MM-DD_plunk-contacts-backup.json` at the repo root (UTC date; `DOCS/` is gitignored). It never overwrites: an existing name gets `-HHMM` added. The file is `{ exportedAt, plunkBaseUrl, count, contacts }`, each contact exactly as Plunk returned it, custom data included. It prints the count, subscribed and unsubscribed totals and the path, never an address. It fails when Plunk announces more pages without a cursor or repeats one, or when a page carries no recognizable contact array (`listContacts` throws rather than return an empty page; it reads the raw response, so a cursor beside a `{ success, data }` envelope's array is kept), and exits non-zero with a warning when Plunk's reported total differs from the contacts paged or an id appears twice; don't run a cleanup on such a backup.

**The backup holds subscriber addresses (personal data).** Keep it only on the owner's machine, never commit or share it, and delete it once the cleanup has proven right (a few weeks).

**Restore** (`restore-plunk-contacts.ts`) compares a backup with the current Plunk contacts by lowercased email:

```powershell
$env:PLUNK_SECRET_KEY="sk_..."
npm run restore:plunk-contacts --prefix server -- --file=../DOCS/2026-10-08_plunk-contacts-backup.json        # preview
npm run restore:plunk-contacts:apply --prefix server -- --file=../DOCS/2026-10-08_plunk-contacts-backup.json  # recreates
Remove-Item Env:PLUNK_SECRET_KEY
```

A relative `--file` resolves against `server/`. Preview is read-only and lists the contacts in the backup but missing now (count, addresses, the subscribed status each had). Apply recreates each through `POST /contacts` (`createContact`) with its email, subscribed status and custom data (string, number and boolean values; others are left out and counted), 200 ms apart, then prints recreated and failed counts. Contacts that still exist are never changed. Apply refuses to run when the current listing looks incomplete (Plunk's total differs from the contacts paged, or an id repeats): a contact the listing missed would be sent through `POST /contacts` with the backup's older status. Only a `subscribed` of `true` (or `"true"`, `1`) restores as subscribed; anything else restores as unsubscribed. A recreated contact is a new Plunk contact with a new id and creation date; its event history does not come back.

### Unsubscribing a list of addresses (`unsubscribe-plunk-contacts.ts`)

For when Plunk's dashboard will not unsubscribe contacts (in October 2026 it answered with an error). Run it locally on the owner's machine from the repo root; it needs only the Plunk key (read from `server/.env`, which holds the production key, or from `$env:PLUNK_SECRET_KEY`), no database:

```powershell
npm run unsubscribe:plunk-contacts --prefix server -- --file=../DOCS/2026-10-08_unsubscribe-list.txt        # preview
npm run unsubscribe:plunk-contacts:apply --prefix server -- --file=../DOCS/2026-10-08_unsubscribe-list.txt  # unsubscribes
```

- **The list file** has one address per line; blank lines and `#` comments are skipped, addresses are lowercased and deduped, and any other line (two addresses, a CSV row) stops the run. It holds personal data: keep it in `DOCS/` (gitignored) on the owner's machine only and delete it once done.
- **Preview first.** It is strictly read-only: it lists every Plunk contact (refusing, in both modes, a listing that looks incomplete, as restore does, since a missed contact would show as "not found") and prints each listed address as currently subscribed, snoozed, already unsubscribed or not found, with counts.
- **Apply** changes only the listed contacts that are subscribed or snoozed (Plunk resubscribes a snoozed contact when the snooze ends), never deletes, never touches anything off the list. It calls `PATCH /contacts/:id` with `{ subscribed: false }` (`updateContact`) by the id from the listing: Plunk's synchronous per-contact update, which cannot create a contact (unlike the `POST /contacts` upsert), clears any snooze and returns the contact. A change counts only when that contact reads `subscribed: false` with no snooze; otherwise it is failed and Plunk's error is printed as status and message. 200 ms apart, `withRetry` on transient errors. If the first change fails it stops rather than try the rest. It ends with unsubscribed, already unsubscribed, not found and failed counts, and exits non-zero on any failure.

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

- Server: `server/src/services/subscribe.ts`, `server/src/services/subscribeLimits.ts` (limits, the queue decision, the cap alert), `server/src/services/confirmationEmail.ts` (the email, its send and the link expiry, shared by `subscribe()` and the job), `server/src/jobs/sendQueuedConfirmations.ts`, `server/src/services/plunk.ts`, `server/src/routes/public/subscribe.ts`, `server/src/lib/formToken.ts`, `server/src/lib/turnstile.ts`
- Client: `client/src/components/SubscribeForm.tsx`, `client/src/lib/formToken.ts`, `client/src/lib/turnstile.ts`, `client/src/hooks/useTurnstileChallenge.ts`, `SubscribeModal.tsx`, `SubscribeProvider.tsx`, `client/src/pages/SubscribedPage.tsx`
- Admin reconciliation view: see `admin-dashboard.md` (Subscribers page)
- Decisions: ADR-0021 (Turnstile), ADR-0024 (Turnstile loads only on submit; supersedes ADR-0021's loading), ADR-0022 (limits from rows), ADR-0023 (normalized storage), ADR-0049 (signups over the hourly limit queued on their row) in `.context/decisions/`
