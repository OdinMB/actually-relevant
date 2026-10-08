---
id: ADR-0024
title: Load Cloudflare Turnstile only when the visitor submits the signup form, as ADR-0021 otherwise
status: accepted
date: 2026-10-08
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
supersedes: ["ADR-0021"]
themes: [personal-data, vendor, accessibility]
tags: ["subscription"]
---

# ADR-0024 · Load Cloudflare Turnstile only when the visitor submits the signup form, as ADR-0021 otherwise

## Context

ADR-0021 added Cloudflare Turnstile to the newsletter signup and loaded Cloudflare's script as soon
as the visitor focused or typed in the email field. A visitor who clicked into the field and then
left without signing up had still sent their IP address and browser signals to Cloudflare. The
task brief for this change (2026-10-08) gives an owner rule: visitors who do not register must not
contact Cloudflare at all. This entry names only the agent because the owner's rule reached it
through that brief, not in the owner's own words to the agent recording it.

Turnstile can render a widget without running it (`execution: 'execute'`, started with
`turnstile.execute()`), and can stay invisible unless Cloudflare needs the visitor to interact
(`appearance: 'interaction-only'`). Cloudflare's Turnstile Privacy Addendum (last updated
2025-06-18) says it processes the IP address, TLS fingerprint, user agent and site key with its
origin, as a processor to detect and block bots on the site's behalf, and as a controller to
improve its bot detection.

## Decision

Everything in ADR-0021 stands except when the client contacts Cloudflare. The form requests
nothing from Cloudflare on render, focus or typing. On submit, by button or Enter, it first checks
the address shape client-side; a malformed address shows the inline error and requests nothing.
Only then, when a site key is set, does it inject Cloudflare's script, render an execute-mode,
interaction-only widget with automatic retries off, run the challenge, and POST the signup with the
token (`client/src/lib/turnstile.ts`, `client/src/hooks/useTurnstileChallenge.ts`). Each submit
runs a fresh challenge, and the widget is removed once it settles or the form unmounts. A failed
script load or challenge, or one that does not finish within 30 seconds, shows the inline human-check error and leaves the form usable; submitting
again retries.

## Consequences

Cloudflare receives data only from visitors who submit the form, which the privacy page now says.
The first submit waits for the script and the challenge, usually about a second, shown as
"Verifying..." on the button. The challenge can no longer run in the background while the visitor
types, so a visitor whom Cloudflare does need to interact with sees the challenge only after
pressing Subscribe. The client-side shape check is looser than the server's validation and is
there only to keep obviously malformed input from contacting Cloudflare.

## Alternatives considered

- **Keep loading on focus or typing (ADR-0021)**: a visitor who never signs up would still contact
  Cloudflare, against the owner's rule.
- **Load on submit but render a visible, always-on widget**: the visitor would have to complete a
  second step after pressing Subscribe even when Cloudflare needs no interaction.
- **Reuse one widget across submits with `turnstile.reset()`**: saves a render per retry, but a
  fresh widget per submit is simpler to reason about, and retries are rare.
