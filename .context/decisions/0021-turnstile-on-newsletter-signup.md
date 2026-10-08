---
id: ADR-0021
title: Protect the newsletter signup with Cloudflare Turnstile, verified server-side and failing closed in production
status: superseded
superseded-by: ADR-0024
date: 2026-10-08
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [personal-data, vendor, accessibility]
tags: ["subscription"]
---

# ADR-0021 · Protect the newsletter signup with Cloudflare Turnstile, verified server-side and failing closed in production

## Context

The Plunk account that sends the newsletter was suspended twice in 2026 for its complaint rate.
The likeliest source of complaints was confirmation emails sent to real people's addresses that
bots had typed into the signup form: those people never signed up and marked the email as spam.
The form's bot gate was a hidden honeypot field and a signed form token (at least 1.5 seconds and
at most 30 minutes old), plus per-IP rate limits. A script could fetch a token from
`GET /api/subscribe/token`, wait 1.5 seconds and post, and reuse the token for 30 minutes, so the
gate stopped only naive bots. There was no CAPTCHA.

The task brief that led to this change (2026-10-08) records Cloudflare Turnstile, checked on the
server and failing closed in production, as the owner's choice; this entry names only the agent
because the owner has not yet confirmed it in their own words to an agent recording it. Turnstile
sends the visitor's IP address and browser and device signals to Cloudflare. The signup form sits
in a modal that is mounted, closed, on every public page, and the public pages are prerendered.

## Decision

We add a Cloudflare Turnstile widget to the newsletter form and verify its token with Cloudflare's
siteverify on the server, after the honeypot and form token and before any side effect
(`server/src/lib/turnstile.ts`). The siteverify call carries one idempotency key across its
retries, so a retry after Cloudflare has already seen the token gets the first answer back rather
than `timeout-or-duplicate`. A rejected or missing token answers "We couldn't verify that you're
human"; when siteverify cannot be reached, or `TURNSTILE_SECRET_KEY` is missing in production, the
signup is refused with "try again later". Without a secret outside production the check is
skipped, with a startup warning. The client loads Cloudflare's script, with no npm wrapper, only
after the visitor focuses or types in the email field. The honeypot and form token stay as extra
layers and keep failing silently.

## Consequences

A script can no longer trigger confirmation emails by fetching a form token and posting; it has to
pass Turnstile. In production, signups stop whenever Cloudflare's siteverify is down or the secret
is missing, which is the intended trade: no confirmation email goes out unchecked.

What got worse: Cloudflare becomes a processor of visitors' IP addresses and browser signals for
everyone who starts filling in the form, which the privacy page now says, and it may involve a
transfer to the USA. Visitors who block Cloudflare's script, or whose browsers fail the check,
cannot sign up. A cached old client that sends no Turnstile token is refused until it reloads.
If the static site gets a Content-Security-Policy header, it must allow
`https://challenges.cloudflare.com` in `script-src` and `frame-src`. Revisit if Cloudflare changes
Turnstile's terms or data handling, if signups from real people drop noticeably, or if bots start
passing the check.

## Alternatives considered

- **Keep the honeypot and form token only** — the audit showed the token is scriptable, so it does
  not stop the abuse that caused the suspensions.
- **hCaptcha or reCAPTCHA** — comparable checks; reCAPTCHA shares data with Google's advertising
  business, and hCaptcha's default challenges are more visible to people. Turnstile is usually
  invisible and was the brief's choice.
- **Plain retries without an idempotency key** — a retry after Cloudflare saw the token returns
  `timeout-or-duplicate`, which would turn a real person away.
- **Load the script when the form mounts** — the modal mounts on every page, so every visitor's IP
  would go to Cloudflare and the script could end up in prerendered pages.
- **An npm wrapper such as `@marsidev/react-turnstile`** — a dependency for three API calls.
