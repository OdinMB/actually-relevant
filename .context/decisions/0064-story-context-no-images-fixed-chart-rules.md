---
id: ADR-0064
title: "Story context: no images and no direction badges; tiles, bars and lines only, drawn when fixed chart rules hold"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, product]
tags: ["story-context", "overviews", "charts", "visuals"]
---

# ADR-0064 · Story context: no images and no direction badges; tiles, bars and lines only, drawn when fixed chart rules hold

## Context

The overviews roadmap's decision D9 (the owner's, 2026-11-16) drops direction badges ("getting
worse") as low value and an embarrassment risk, and allows standardized charts and area colors but
no story images. Story context, module 1, is the first code that draws anything. The thinking
document behind it proposed eight chart types; the plan (approved 2026-11-16) keeps three.

## Decision

- **No images per story, no direction badges.** A card's visual is at most one of three kinds:
  big-number tiles, comparison bars, or a line over time, drawn by the client from the facts'
  values. No model draws, picks or describes an image.
- **A chart is drawn only when fixed rules hold** (`validChart`,
  `server/src/services/storyContextVisuals.ts`): every point a supported, shown fact with a single
  value (a range is no point and is removed before counting), one unit across the points, no
  negative value since the axis starts at zero; bars need 2 points, a line 3 at different as-of
  dates, drawn in date order. A different measure may stand beside bars as `apart` points, drawn
  lighter, never in the comparison. A provisional point is hatched; a point within 30 days of the
  story's day takes the area's color. The agent placed two of the rules: negatives are refused for
  lines too, and `apart` is kept beside bars only.
- A chart that breaks a rule is not drawn; its card keeps its sentences. This is no failure.
- That every point measures the same thing is judged by the box check, against the chart's caption
  and each point's fact, not matched in code.

## Consequences

- Charts are client-side SVG with a visible caption, a source line and a hidden table of values;
  story pages are not prerendered and no newsletter, preview image or feed shows context, so server
  SVG would buy nothing today.
- The mockup's pictograms and split bars become tiles until a later module adds those types.
- Some writable charts are not drawn: two points for a line, a mixed unit, a negative change.

## Alternatives considered

- **The thinking document's eight types:** YAGNI until stories need them.
- **Vega-Lite specs written by the model:** hard to enforce that every mark has a source.
