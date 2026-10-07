---
id: ADR-0019
title: Name api.actuallyrelevant.news as the API's public host, keeping the onrender.com host answering
status: accepted
date: 2026-10-07
deciders: ["Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [handover]
tags: ["api", "deployment", "authentication"]
---

# ADR-0019 · Name api.actuallyrelevant.news as the API's public host, keeping the onrender.com host answering

## Context

The API ran on Render at `actually-relevant-api.onrender.com`. Because `onrender.com` is on the
Public Suffix List, the admin on `actuallyrelevant.news` and the API were different sites, so the
refresh cookie was a third-party cookie (`SameSite=None`) that Safari, Brave and strict browser
modes never send back: every reload logged the admin out. `widget.js`, the README and the OpenAPI
docs already named `api.actuallyrelevant.news`, which did not resolve, so widget embedders saw
"Could not load stories". On 2026-10-07 the owner added the custom domain in Render; it was
verified and a certificate issued.

Production configuration lives in the Render dashboard: the static site's `VITE_API_URL` (baked in
at build time) and the API's `API_URL` (only the OpenAPI spec's server entry) and
`AUTH_COOKIE_SAMESITE`. CORS checks the calling site (`FRONTEND_URL`), not the API's host.

## Decision

`api.actuallyrelevant.news` is the API's public host. Code and docs name it: `server/env.example`'s
`API_URL`, the OpenAPI spec's fallback server URL, the README, `widget.js`. The client keeps
taking its API host only from `VITE_API_URL`. Render keeps the `onrender.com` host answering beside
the custom domain, so existing callers of either host keep working. Switching production over is
the owner's: `VITE_API_URL` on the static site, then `AUTH_COOKIE_SAMESITE=strict` once the admin
works on the new host.

## Consequences

- Widget embedders load stories again; public API callers on the `onrender.com` host are
  unaffected.
- Once `VITE_API_URL` switches, the refresh cookie becomes same-site and survives third-party
  cookie blocking; everyone logs in once more, since the old cookie belongs to the old host.
- Until the owner switches `VITE_API_URL` and checks `API_URL`, production still calls the
  `onrender.com` host and the OpenAPI docs may name it; the BACKLOG item tracks the steps.
- Two hosts answer for one service; the Render `/sitemap.xml` and `/podcast.xml` rewrites still
  point at the `onrender.com` host. Revisit if Render ever stops serving the `onrender.com` host
  beside a custom domain, or if the service moves off Render.

## Alternatives considered

- **Keep the `onrender.com` host as the public name** — leaves the admin logout in third-party
  cookie blocking browsers and `widget.js` broken.
- **Rewrite `/api/*` on the static site to the API** — same-site without a domain, but every request
  would reach the API from the proxy's address, breaking the per-IP rate limits.
- **Change the Render values in the same change** — they are dashboard settings, the owner's to
  change, and the cookie switch must wait until the admin is seen working on the new host.
