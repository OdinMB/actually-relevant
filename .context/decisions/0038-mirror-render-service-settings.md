---
id: ADR-0038
title: Declare custom domains, plan and subdomain policy in render.yaml exactly as Render exports them
status: accepted
date: 2026-10-13
deciders: ["claude-code (AI)", "Odin Mühlenbein"]
context-repo: OdinMB/actually-relevant
themes: [handover]
---

# ADR-0038 · Declare custom domains, plan and subdomain policy in render.yaml exactly as Render exports them

## Context

ADR-0034, and ADR-0036 after it, kept custom domains and the instance plan in the Render dashboard and out of `render.yaml`. Before the services were adopted into the blueprint, the owner exported them with the dashboard's Generate Blueprint on 2026-10-12. The export lists `plan: starter` and the domain `api.actuallyrelevant.news` on the backend, and the domains `actuallyrelevant.news` and `www.actuallyrelevant.news` with `renderSubdomainPolicy: disabled` on the static site.

Render's documentation on adopting existing resources (render.com/docs/infrastructure-as-code, re-read by the owner on 2026-10-13) says to include all current settings, such as name, type, plan, buildCommand and startCommand, "or the defaults will override them". It says nothing about domains. Left out, the plan could fall back to Render's default instance type, the `onrender.com` subdomain could be switched back on, and whether a sync keeps or drops custom domains it does not see is not documented. The static site's `/sitemap.xml` and `/podcast.xml` rewrites proxy to the backend's custom domain (ADR-0019), so losing it would break both.

The owner decided this in session on 2026-10-13; the agent wrote it down and implemented it.

## Decision

`render.yaml` lists `domains:` on both services exactly as Render's export gives them, `plan: starter` on the backend, and `renderSubdomainPolicy: disabled` on the static site, so that adoption leaves Render nothing to add or remove. This replaces only the part of ADR-0034 and ADR-0036 that keeps custom domains and the plan in the dashboard; everything else in ADR-0036 stands (fixed values, `sync: false` for the rest, the blueprint test), and the database stays outside (ADR-0035). The blueprint test checks that the backend lists every host the static site's rewrites target and that the static site lists at least one domain.

## Consequences

Adoption no longer depends on undocumented behavior for domains or on Render's default plan, and a change of domain or plan is now a reviewed commit. In return, the file is the only place to change them once a blueprint is connected: a domain or plan changed in the dashboard is overwritten, or the domain removed, on the next sync. A plan upgrade is now a commit and a deploy rather than a click. A fresh deployment from this repository must replace the domains and remove the subdomain policy, or its services are unreachable; the README says so. ADR-0034's and ADR-0036's bodies still say domains and the plan stay in the dashboard, since accepted entries are frozen; `.context/deployment.md` names this entry beside them.

Revisit this if Render documents how blueprint syncs treat custom domains, if a domain is ever managed outside Render, or if a third service joins the blueprint.

## Alternatives considered

- **Keep domains and plan in the dashboard (ADR-0034, ADR-0036)** — Render's docs say omitted settings take their defaults on adoption, and they say nothing about domains, so the outcome for the live domains was unknowable before connecting.
- **Declare the plan but leave domains out** — closes the documented risk but leaves the domain behavior, the one that would break the sitemap and podcast rewrites, to chance.
- **Supersede ADR-0036 as a whole and restate it** — would duplicate a decision that stays in force apart from this one part.
