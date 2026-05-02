# Homepage Newsletter CTA after Human Development

- **Date**: 2026-05-02
- **Status**: draft
- **Type**: feature

## Problem
The homepage currently shows a single CTA (`SupportBanner`) tucked between the 2nd and 3rd issue sections. There is no in-flow prompt to subscribe to the newsletter on the homepage itself, even though the modal subscribe flow already exists (`SubscribeProvider` + `SubscribeModal`).

## Approach
Add a second in-flow CTA — a newsletter banner — between the 1st (Human Development) and 2nd (Planet & Climate) issue sections, mirroring the visual rhythm of `SupportBanner`. Reuse the existing modal subscribe flow via `useSubscribe().openSubscribe()` so the click opens the same dialog used by the navbar/footer subscribe buttons.

The component is a near-clone of `SupportBanner`'s layout (centered block, dividers + icon, short paragraph, primary button) with: a mail icon, copy about the newsletter, and a button that calls `openSubscribe()` instead of linking to Ko-fi. Clone rather than abstract — there are only 2 sites today, the visuals diverge (icon, copy, link vs button), and a shared base would obscure more than it reuses.

Insertion point: in `HomePage.tsx`'s reduce, push the new banner after `idx === 0` (Human Development is first in `ISSUE_ORDER`). The existing support banner stays at `idx === 1`.

## Changes

| File | Change |
|------|--------|
| `client/src/components/NewsletterBanner.tsx` | New component. Mirrors `SupportBanner` structure: centered max-w-2xl block, top divider line + icon + line, paragraph, single button. Mail SVG icon. Copy: "Don't miss what's actually relevant. / Get the weekly digest." Button label: "Subscribe". Button calls `useSubscribe().openSubscribe()`. |
| `client/src/pages/HomePage.tsx` | Import `NewsletterBanner`. In the `.reduce(...)` after the issue sections map, insert `<NewsletterBanner />` when `idx === 0`. Existing `SupportBanner` insertion at `idx === 1` is unchanged. |

## Tests
No tests — this change is static content (a new presentational banner + one insertion site). The button delegates to the already-tested `SubscribeProvider` flow; the banner has no branching logic.

## Out of Scope
- No changes to `SupportBanner`, `SubscribeProvider`, `SubscribeModal`, or `LandingCta`.
- No shared "Banner" abstraction — only 2 in-flow CTAs exist today.
- No reordering of issue sections or change to where `SupportBanner` appears.
- No A/B variant or tracking instrumentation.
