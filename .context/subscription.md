# Email Subscription

Double opt-in newsletter signup. A visitor submits an email, receives a confirmation link, and confirms by clicking a button. Plunk delivers the email and holds the contact list. Visitors are unauthenticated public users, separate from admin `User` accounts.

## Configuration

`config.subscribe` in `server/src/config.ts`:

| Key | Default | Env override | Meaning |
|---|---|---|---|
| `confirmTokenExpiryHours` | 24 | `SUBSCRIBE_TOKEN_EXPIRY_HOURS` | Lifetime of a confirmation link |
| `rateLimitWindowMs` / `rateLimitMax` | 60 s / 3 | `SUBSCRIBE_RATE_LIMIT_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_MAX` | Per-IP burst limit on the subscribe routes |
| `rateLimitDailyWindowMs` / `rateLimitDailyMax` | 24 h / 20 | `SUBSCRIBE_RATE_LIMIT_DAILY_WINDOW_MS`, `SUBSCRIBE_RATE_LIMIT_DAILY_MAX` | Per-IP sustained limit |
| `minFormFillMs` | 1500 | `SUBSCRIBE_MIN_FORM_FILL_MS` | Form tokens younger than this are rejected (too fast for a human) |
| `formTokenMaxAgeMs` | 1 800 000 (30 min) | `SUBSCRIBE_FORM_TOKEN_MAX_AGE_MS` | Form tokens older than this are rejected (bounds replay) |
| `formTokenSecret` | `FORM_TOKEN_SECRET`, else `JWT_SECRET` | | HMAC key for form tokens. If empty, every token is forgeable and the bot gate fails open; startup logs a warning |

## Form Token

`server/src/lib/formToken.ts`. A signed, stateless token stamped with its issue time and served by `GET /api/subscribe/token` when the form renders. It is valid only while its age is within `[minFormFillMs, formTokenMaxAgeMs]`. It proves the submitter fetched the form from us, which stops scripts that POST straight to the API. Replay is also bounded by the per-IP rate limits on the subscribe routes.

## Subscribe (`POST /api/subscribe`)

1. **Bot gate, before any side effect.** If the hidden honeypot field is filled, or the form token is missing, invalid or outside its age window, the request returns success but nothing is created and no email is sent, so bots are not tipped off.
2. **Idempotency.** If the email already has a *confirmed* `PendingSubscription`, return success without doing anything. Unconfirmed pending rows do not short-circuit.
3. **Email verification via Plunk is best-effort.** Plunk's verify API checks valid format, an existing MX record for the domain, and whether the address is disposable. An explicit failure on any of the three rejects the signup. If the verify API errors (unavailable, 403), the check is skipped and the signup proceeds; the honeypot and form-token gate and double opt-in are the backstop. The server check is authoritative; the client only does a basic format regex.
4. **Re-subscribe.** Delete any unconfirmed `PendingSubscription` rows for this email.
5. Create a `PendingSubscription` with a single-use unique UUID `token`, `plunkContactId: null`, and `expiresAt = now + confirmTokenExpiryHours`.
6. Send the confirmation email. The greeting uses the first name sanitized (URLs and markup stripped). The first name is **never** written to Plunk.

**Plunk contact side effect:** Plunk creates a contact for every transactional recipient, so sending the confirmation email leaves a Plunk contact with `subscribed: false` even when the signup is never confirmed (see the cleanup script below).

## Confirm

- The link in the email points to `GET /api/subscribe/confirm`, which **only redirects** to the client confirmation page (`client/src/pages/SubscribedPage.tsx`) and never changes state. This keeps email scanners that prefetch links from auto-confirming.
- A human button click sends `POST /api/subscribe/confirm` with `{ token, email }`. Both must match the same pending row.
- Confirming an already-confirmed row is a no-op success. An expired, unconfirmed row is rejected.
- On confirm, the Plunk contact is upserted to `subscribed: true` and its id is stored in `plunkContactId`, then `confirmedAt = now`. If Plunk fails, the row is still marked confirmed locally and `plunkContactId` stays null.

## Client Behavior

- `SubscribeForm` (`client/src/components/SubscribeForm.tsx`, also used by `SubscribeModal` and `/newsletter`) has one email field, an optional first name and a hidden honeypot. It fetches a form token on render and keeps submit disabled until the token has loaded. On success it tells the visitor to check their inbox. On a validation error, or a failure to send the confirmation email, it shows the error inline and never claims the email was sent.
- `SubscribedPage` does not confirm on load. It shows a confirm button. Success shows a welcome state, an expired link suggests subscribing again, and a transient or network error keeps the button so the visitor can retry.

## Cleaning Up Never-Confirmed Plunk Contacts

`server/src/scripts/cleanup-plunk-contacts.ts`, run by hand:

```bash
npm run cleanup:plunk-contacts --prefix server        # dry run
npm run cleanup:plunk-contacts:apply --prefix server  # deletes
```

It deletes Plunk contacts that are not subscribed, have no confirmed local `PendingSubscription`, and were created more than 14 days ago (`PURGE_MIN_AGE_DAYS`). Subscribed contacts, and anyone who ever confirmed locally, are never touched. It needs an active Plunk account; a suspended one returns 403 `PROJECT_DISABLED`.

## Key Files

- Server: `server/src/services/subscribe.ts`, `server/src/services/plunk.ts`, `server/src/routes/public/subscribe.ts`, `server/src/lib/formToken.ts`
- Client: `client/src/components/SubscribeForm.tsx`, `SubscribeModal.tsx`, `SubscribeProvider.tsx`, `client/src/pages/SubscribedPage.tsx`
- Admin reconciliation view: see `admin-dashboard.md` (Subscribers page)
