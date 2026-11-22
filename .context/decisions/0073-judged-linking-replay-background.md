---
id: ADR-0073
title: "The judged linking replay carries neighbouring developments as unscored background"
status: accepted
date: 2026-11-22
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk]
tags: ["overviews", "evals", "linking"]
---

# ADR-0073 · The judged linking replay carries neighbouring developments as unscored background

## Context

The overview linking eval (`eval:overviews --steps link,found,role`, ADR-0066) replays one half of
the answer keys, their entries and near misses, through production's linking in an in-memory
sandbox, and scores the bars on the judged half's keys. The judged replay held only the five judged
keys' stories. The Iran war and Hormuz, both tuned-half keys, appeared in it only through their
Lebanon look-alikes. In two of the three paid runs of 2026-11-19, those look-alikes founded a
"US–Israeli campaign against Iran" overview; the scorer read it as Lebanon's, since only the judged
keys decided what an overview stood for, so its ten Iran-war stories counted as wrong Lebanon joins
and joins right came out at 89.8%. In production the Iran war would have had its own overview from
its own stories.

Two further foundings in that run counted as wrong only because no key covered them: the UN
pandemic declaration and the US plan to dismantle the Ocean Observatories Initiative, each a real
separate development of two stories that the PABS and El Niño keys hold as near misses or optional
entries. The owner asked for background stories in the judged replay, for labels for those two
foundings, and for paid linking runs at `--concurrency 1` (2026-11-22). How to do each was the
agent's choice.

## Decision

In judged-half linking runs only, the replay also carries background: every key outside the half
whose own base entries share a slug with the judged replay adds its base entries, `must` and
`optional`, that the replay does not hold yet (`backgroundOf`, `link.ts`). One hop only, never a
key's near misses or centers, and never through a key whose only shared slug is its own near miss.
They are replayed with the judged stories in one date order. One reading of the keys
(`linkKeys`, `linkScore.ts`) serves the scorer, the diagnostics and the whole-step replay: an
overview stands for the key, of either half or a label key, most of whose `must` entries it holds.
In an overview standing for a judged development, its `must` entries are right, its optional and
center entries ignored, and every other member wrong (a near miss, a background story, any entry of
another key). In any other overview only the judged `must` entries are scored, right where that
overview's key holds one as `must` too. A founding is checked only when one of its two stories is a
judged story. Label keys (`LABEL_DEVELOPMENTS`, `developmentHalves.ts`) sit in neither half: never
tuned on, replayed as a half or scored, read by no step but the linking evals, they only say what a
story is. Tune runs take no background.

## Consequences

- A neighbouring development's look-alikes among the judged stories no longer found an overview that
  counts against a judged key, and a two-story development a label key names founds rightly.
- The judged run replays about 490 stories a run instead of 209, so a paid judged line costs about
  $0.75–1.10 rather than $0.30, and takes longer at `--concurrency 1`.
- Behaviour changes for stories already replayed: a judged near miss, optional or center entry of
  one judged key that lands in another judged key's overview is now a wrong join, where it went
  uncounted; and an overview made mostly of another key's `must` entries now stands for that key.
  The 2026-11-19 bars cannot be rescored under these rules, so the next paid run is the baseline.
- The background stories are tuned-half stories: their own behaviour is no held-out evidence, and
  tuning keeps them in their own overviews, which also keeps them out of judged ones, so joins right
  may read a little high. Some judged stories were replayed in tuning already. The neighbourhood is
  one hop, where production holds every story.
- Revisit if a judged key's replay pulls in a neighbour two hops out that founds false overviews, or
  if the background's cost grows past what the gate's budget holds.

## Alternatives considered

- **Score background without changing what an overview stands for** — overviews made mostly of
  background stories would still be read as judged developments, the failure this fixes.
- **Background in tune runs too** — it would carry judged stories into tuning.
- **Hard-code the Iran war and Hormuz** — the owner asked for a general rule.
- **Take every key outside the half** — it adds unrelated developments, at a cost.
- **Copy the rule into each of the three readers** — the diagnostics would drift from the bars; the
  plan's first draft already missed the charter counts.
- **The two label developments in the tune or judged half, or a per-story label field** — the tune
  half would replay judged near misses in tuning, the judged half would add two-story developments
  to the gate's bars, and a field would be a second way of saying which development a story is.
