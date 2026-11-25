---
id: ADR-0081
title: "The whole-step replay replays the linking step's story set, background included, and skips no review"
status: accepted
date: 2026-11-25
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, cost]
tags: ["overviews", "evals", "replay"]
---

# ADR-0081 · The whole-step replay replays the linking step's story set, background included, and skips no review

## Context

The overview eval's `replay` step replays the whole module night by night in an in-memory sandbox:
linking, the status machine, reviews, re-centers and the stands. The gate's last bar rests on it. It
loaded only its half's stories (`replaySlugs`): for the judged half, 201. The linking step
(`link`, `found`, `role`) had replayed the judged half among background stories since ADR-0073: the
base entries of each key outside the half that shares an entry with it, 272 stories of the Iran war's
and Hormuz's keys, 473 in all, deduplicated (ADR-0076).

The replay's first paid run, on 2026-11-24, read joins right 89.8% against a bar of 97% and wrong
foundings 14.3% against 10%. Lebanon's overview held 5 to 6 wrong members at its checkpoints. 89.8%
was also what the linking step read on 2026-11-19, before it replayed the background; with the
background it met the bar (97.4% in the run of 2026-11-23). The replay's report gave counts only, so
which stories the wrong members were could not be read from it. The likely cause was the one ADR-0073
describes: look-alikes of a neighbouring development with no overview of their own to join.

The main session told the implementing agent on 2026-11-25 that the owner had decided the replay
must replay the same stories as the linking step. What the background's overviews go through in the
upkeep, what of them is scored and what the report names were left to the agent. Reviews were the
replay's main cost: 32 of them, $0.71 of the run's $1.27, on the large tier, and a review reads every
active entry of its overview.

## Decision

The replay loads its stories through the linking step's own functions (`linkReplayStories`,
`loadReplayed`, `link.ts`), so the two steps cannot replay different sets: in a judged run the half's
entries and near misses and the background, in one date order, a `--limit` taking the first of them
all. A tuning run takes no background, as before.

Background developments go through the whole upkeep as any other overview: status moves, bursts,
re-centers and every review due. No review of a background overview is skipped. Nothing of theirs is
scored: the linking bars read a background story only as a wrong join in a judged development's
overview and a founding only with a judged story in its pair, as the linking step does; a re-center
of an overview that stood for a development the half does not score, read from its members without
the stories the re-center took in, counts in neither re-center bar and is listed as unscored. A
checkpoint's wrong members are the members the joins bar reads as wrong.

Not covered: the `pass-pool` step still researches only the half's must entries, so background
overviews are offered no facts and write no stands.

## Consequences

- The replay's linking bars now measure what the linking step's measure, with the upkeep on top, so
  the two can be read against each other.
- The judged replay links 473 stories instead of 201. Its desk estimate is about $3.70 a run against
  $1.27 measured without the background: about 26 more reviews, the dearest of the run, since the
  two background overviews would hold about 115 and 235 entries.
- The run of 2026-11-24 is no longer comparable, and its cached calls are reused only where the
  background changes nothing a call was shown.
- Worse: reviews now run at sizes no other eval has exercised. A large review that fails leaves a
  background overview unreviewed, which changes what judged stories see, and the report shows that
  only as a failed upkeep item.
- Worse: the cost per story and per overview average over background stories that write no stands,
  so they read lower than production's would.
- ADR-0073's limits now hold for the replay too: the background is tuned-half stories, so their own
  behaviour is no held-out evidence, and the neighbourhood is one hop.
- Revisit when the background's reviews cost more than the rest of the replay together, when a
  review gets a limit on the entries it reads, or when the owner stops rerunning the step for its
  cost.

## Alternatives considered

- **Keep replaying the half alone** — the failure this fixes: a neighbouring development's
  look-alikes join a judged overview or found one.
- **Skip the reviews of background overviews** — nearly chosen, for the cost. A review makes a
  forming overview public, detaches entries, narrows the charter and is the only thing that lifts a
  burst's freeze; the judged stories' later link calls read all of that, and a frozen background
  overview would hold every story that points at it. The judged result would change.
- **Skip only their periodic reviews** — those narrow charters and detach entries too, and the eval
  would run a schedule production does not have.
- **A second copy of the story set in the replay** — it is how the two steps came to replay
  different stories.
- **Research the background's stories, so their overviews write stands** — about 270 first passes,
  roughly $40, for stands no bar scores.
- **Score the background developments' own bars** — their keys are the tuned half's, so the numbers
  would be no evidence for the gate.
