---
plan-id: 2026-10-07-podcast-standalone-episodes
title: Standalone podcast episodes built by hand from any published stories, beside the weekly episode
status: draft
created: 2026-10-07
author: claude-code (AI)
repo: OdinMB/actually-relevant
themes: [ai-risk, cost]
decisions:
  - id: ADR-0014
    title: Mark an episode's kind in an explicit kind column, weekly or standalone, with standalone rows never carrying a week key
    status: proposed
    context: Standalone episodes have no ISO week, and legacy rows already have a null week key, so a null week key cannot tell a standalone episode apart.
    decision: Add a PodcastKind enum column (default weekly) plus a CHECK that a standalone row has a null week_key; the publish job's candidate query also filters kind = weekly.
  - id: ADR-0015
    title: A person performs the selection stage of a standalone episode; the AI suggestion is advisory and writes nothing
    status: proposed
    context: The weekly selection stage is an LLM run over the week's pool, but a standalone episode's stories come from any published story, picked by a person.
    decision: Saving a standalone episode's stories at created writes the snapshot and moves it to selected (interactive) under the lease; Suggest stories is a stateless LLM call returning ids for the picker; no run may start a standalone episode from created.
type: feature
complexity: complex
---

# Standalone podcast episodes

Owner decisions this plan builds on (Odin Mühlenbein, 2026-10-07, in session): a **New podcast**
button beside "Start this week's episode"; an episode not tied to a week, built from *any*
published stories picked by hand with filters (date range, topic, text search) and an optional
**Suggest stories** that lets the AI propose 4-5 from the filtered set (selection prompt and schema
reused); the same min/max as weekly; then script and audio as usual (interactive, with "Finish
automatically" allowed once the stories are set); the same feed and `/podcast` page; default title
without the `W41:` prefix (editable); **published by hand only**, never touched by the weekly
generate and publish jobs. Every other choice below is the planning agent's (AI), recorded as
ADR-0014 and ADR-0015 or in this section's prose.

## Problem

Every two-speaker episode today is "this week's": the row is found by its ISO week key, the story
pool is the 7 days before selection, the prompts, the dialogue schema's descriptions and the spoken
and written AI disclosures say "this week", and both cron jobs key on the week. The owner cannot
make an episode about a theme or a set of stories from different weeks.

## Copy needing the owner's approval

Weekly wording stays exactly as it is. Proposed standalone variants (all in `aiLabelCopy.ts`, gated
by `PODCAST_STANDALONE_COPY_CONFIRMED`, see Approach):

| Constant | Weekly today (owner-approved) | Proposed standalone variant |
|---|---|---|
| Spoken opener (HOST_A, first turn) | "Everything you're about to hear was written and voiced by AI from this week's news." | **"Everything you're about to hear was written and voiced by AI from selected news stories."** (alternative, the owner's own example: "…from recent news." — shorter, but untrue when an older story is picked, which the feature allows) |
| Show-notes / feed / page / ID3 AI line | "AI-generated: Everything in this episode was written and voiced by AI from this week's news. People built and oversee the system but don't write or edit individual episodes." | **"AI-generated: Everything in this episode was written and voiced by AI from news stories a person selected. People built and oversee the system but don't write or edit individual episodes."** |
| The same, "Edited by a person" ticked | "AI-generated: Everything in this episode was written and voiced by AI from this week's news. A person reviewed and edited this episode." | **"AI-generated: Everything in this episode was written and voiced by AI from news stories a person selected. A person reviewed and edited this episode."** |
| Spoken sign-off (HOST_A, last turn; moves from `podcastDialogue.ts` into `aiLabelCopy.ts`) | "That's it for this week. Tell us what you think on actuallyrelevant.news. Thanks for listening." | **"That's it for this episode. Tell us what you think on actuallyrelevant.news. Thanks for listening."** |

Because the standalone AI line itself says a person selected the stories, the first selection does
**not** tick "Edited by a person"; later story changes, script edits and the manual chip tick it
under the existing rules. Not changed, flagged for the owner: the show-level description
(`PODCAST_SHOW_DESCRIPTION`, "A weekly five-minute briefing … of the week's news") and the
`/podcast` page intro still call the show weekly once standalone episodes share the feed.

## Approach

**Data model (ADR-0014).** New enum `PodcastKind { weekly standalone }` and column
`kind PodcastKind NOT NULL DEFAULT 'weekly'` on `podcasts`. Existing rows, legacy ones included,
become `weekly`; a legacy row stays recognisable by `stage = legacy`, as today. The migration adds
`CHECK (kind <> 'standalone' OR week_key IS NULL)`, so a standalone row can never take a week's
unique key or be found by `findOrCreateWeekEpisode`. Alternatives: *null week key means
standalone* — rejected, legacy rows already have a null week key and the owner asked not to
confuse them; *a synthetic week key* — rejected, every reader of `weekKey` would have to learn to
ignore it, and `pickAutoPublishCandidate` compares week keys.

**The jobs never touch standalone rows.** The generate job reaches only
`findOrCreateWeekEpisode(isoWeekKey(now))`, which the CHECK makes structurally weekly; its reminder
follows that result. The publish job takes only `pickAutoPublishCandidate`, which gains an explicit
`kind: 'weekly'` beside its week-key filter. Both are tested. No extra kind check goes into
`runEpisode` (shared with admin runs; the review found it already carries five concerns).

**Creating and choosing stories (ADR-0015).** `POST /api/admin/podcasts/standalone` creates
`{ kind: standalone, stage: created, weekKey: null, title, dryRun }`. The default title is
`Actually Relevant, <YYYY-MM-DD>` (UTC creation date), so several standalone episodes are told
apart in the list, the header and the toasts; `defaultEpisodeTitle` takes the row
(`{ weekKey, createdAt }`) and keeps the weekly result unchanged. As for weekly, the title is
editable from `scripted` on (the script stage replaces it with the model's title, which has no
prefix since `weekKey` is null).

`PUT /:id/stories` stays one route and dispatches on the row's kind: weekly →
`replaceEpisodeStories` (unchanged); standalone → `saveStandaloneStories(id, storyIds)` in the new
`podcastStandalone.ts`. That function, under `withEpisodeLease`:

- refuses (409) a legacy, published or in-progress row and any stage but `created` or `selected`;
- checks count and duplicates with the exported `storyCountErrors`, then loads the ids as
  **published** stories (any date) with `loadStoriesByIds` (422 `not published: …`);
- writes the snapshot (refs 1..n in the given order, built with the exported `snapshotOf`),
  `storyIds`, `storiesSelectedAt = now`; at `created` also `stage = selected` and
  `mode = interactive`; at `selected` it leaves the mode alone (an owner who chose "Finish
  automatically" keeps it) and ticks `humanEdited` only when the set or order changed (the weekly
  rule).

Alternatives: *a kind branch inside `replaceEpisodeStories`* — rejected after review: allowed
stages, membership, a stage transition and the mode write would all depend on kind, a second
operation inside an edit function; *let the `created` runner copy hand-picked ids* — rejected, a
run, a lease round-trip and a failure mode for nothing.

**No run starts a standalone episode from `created`.** `startAdminRun` computes the effective stage
`req.rewindTo ?? episode.stage` **before claiming** and refuses a standalone row whose effective
stage is `created` (409 "choose the episode's stories first"), so neither Resume nor "Start over"
with `advance` reaches the weekly selection. The client's Start over for a standalone episode
rewinds to `created` without advance ("The stories, script and audio are discarded. Choose the
stories again."). `selectStage` throws for a standalone row as a deliberate backstop (one line,
named here as defence in depth). The dry-run reset in `runEpisode` (a dev-made row run in
production) rewinds a standalone row to `selected` rather than `created`, so the person's stories
survive; `rewindWrite` already resets `dryRun` for any target.

**Suggest stories** (`POST /api/admin/podcasts/:id/suggest-stories`, body = the finder's filters,
`expensiveOpLimiter`): 409 unless standalone, at `created` or `selected`, at rest, never published.
It loads the filtered published stories, most relevant first, capped at
`config.podcast.suggestPoolMax` (60, new; a different pool rule from the weekly 7-day window, on
purpose), and calls `chooseStories(pool, 'standalone')`. It writes nothing; the client puts the
result into the picker's draft. Synchronous (one large-tier call, withRetry inside), so no lease and
no toast.

`selectEpisodeStories` is split: `chooseStories(pool: PoolStory[], kind)` (exported; prompt, call,
drop unknown and duplicate ids, cap, and a typed `TooFewStoriesError` under the minimum) is used by
both. The weekly function keeps its loader and wraps the error in its existing "only N published
stories this week" message; the standalone path maps `TooFewStoriesError` to
`PodcastEditRejectedError` (422 "only N stories match the filters; an episode needs 4"). Both
loaders share the existing `storySelect`.

**Story search** (`GET /api/admin/podcasts/story-search`, routed before `/:id`): query
`crawledAfter`, `crawledBefore` (ISO datetimes on `dateCrawled`, the same date the weekly pool uses;
the finder labels it "Found between"), `issueId`, `search`, `page`, `pageSize` (max 50). Published
stories only, most relevant first then newest. Returns the standard paginated shape of
`{ id, title, publisher, sourceUrl, slug, issue, relevance, dateCrawled }`. The where clause comes
from a new named helper in `story.ts`, `publishedStoryWhere(filters)`, a two-line wrapper over the
private `buildWhereClause` with `status: 'published'`, so the issue semantics (sub-issues and the
feed's issue as fallback) cannot drift from the admin story list, and the podcast module never sees
the list's status rules. One zod schema, `podcastStoryFiltersSchema`, serves the suggest body and,
extended with paging, the search query. Alternatives: *the client calls `GET /api/admin/stories`*
— rejected, different shape (no publisher name or top-level issue as the snapshot computes them)
and sort; *filters on `GET /:id/story-pool`* — rejected, that endpoint's contract is "exactly the
pool the model chose from".

**Copy, prompts and validation by kind.** The episode's `kind` reaches the code that words things:

- `aiLabelCopy.ts`: `PODCAST_EPISODE_COPY: Record<PodcastKind, { opener, signOff, aiLine,
  aiLineEdited }>` holding the weekly constants (unchanged values, names kept as aliases for the
  tests and docs) and the standalone strings above; `podcastOpener(kind)`, `podcastSignOff(kind)`,
  `podcastEpisodeAiLine(humanEdited, kind)`; `PODCAST_STANDALONE_COPY_CONFIRMED: boolean = false`.
  Lookups replace ternaries, so a third kind or a wording change touches one record.
- **Confirmation gate.** While the constant is false: `publishRefusal` refuses a standalone row
  ("a standalone episode cannot be listed yet: its opener and AI line await the owner's
  confirmation"), which `publishBlockedReason` shows on the Publish button since it calls
  `publishRefusal`; and `voiceEpisode` refuses the **live** voicing of a standalone row with a
  `PodcastBlockedError` before the first chunk, so no credits are spent on audio carrying
  unapproved wording. Dry runs (dev) voice the silent stub as today, so the flow can be tried end
  to end. Set it to true only on the owner's own confirmation of the wording.
- `podcastDialogue.ts`: `assembleSpokenSegments(dialogue, kind)`; `dialogueCharBudget(kind)` (the
  code turns' length is per kind; a kind-free budget from the longer variant was considered and
  rejected because it would change the weekly prompt's numbers); `validateDialogue(dialogue,
  stories, opts)` with `opts: { kind: PodcastKind; authoredBy?: … }` now required (callers:
  `podcastScript`, `podcastEditing`, eval `checks.ts`). For standalone a new error rule: no turn,
  title or summary contains `/\b(?:this|last|past|next) (?:week|month)(?:'s)?\b/i`, for the model
  (fed back on the one regeneration) and a person's edit alike, since the owner's rule is that such
  wording must not appear.
- `schemas/llm.ts`: the dialogue schema's title description says "naming the week's main themes";
  `podcastDialogueSchemaFor(kind)` returns the weekly schema unchanged or one whose description says
  "naming the episode's main themes".
- `prompts/podcast.ts`, `podcast-select.ts`: required `kind`, wording fragments in a per-kind record
  at the top of each file. Standalone: ROLE "a five-minute news briefing"; GOAL "for this
  episode"; intro "says the episode covers a selection of stories rated relevant for humanity";
  added constraint "The stories may come from different weeks or months. Never date a story
  relative to now ('this week', 'last month', 'yesterday'); when the material uses such words,
  paraphrase them or give the date only if the material states it." Selection: "for this episode",
  and the one-story-per-issue rule becomes "Prefer variety across issues when the articles span
  several; when they share one issue, choose complementary angles" (a topic filter makes every
  candidate share one issue).

Threading `kind` through these signatures is deliberate: making it required lets the type-checker
find every place a weekly wording would otherwise leak into a standalone episode. The cost, named:
about ten signatures and their tests change. The alternative, a variant object resolved once and
passed instead of `kind`, moves the same parameter around under another name.

**Client.** `PodcastsPage` gets **New podcast** (secondary, beside "Start this week's episode"),
which creates the row and opens it. `nextAction` returns `'choose-stories'` for a standalone episode
at `created`, whatever its mode (a rewind sets interactive), so neither the mode choice nor Resume
shows. `PodcastStoriesTab` renders the new `PodcastStoryFinder` for a standalone episode at
`created`, and at `selected` at rest; the weekly picker keeps its behaviour. The finder: filters
(dates, issue from `useIssues`, search applied on submit), paginated results with Add, **Suggest
stories** (replaces the draft; a 422 shows its message), the chosen list in episode order with Move
up/down and Remove, Save selection / Discard. The draft state, dirty reporting, following the
server's saved ids and the 422 error display move out of `PodcastStoryPicker` into
`usePodcastStoryDraft`, used by both (identical logic at two call sites that would otherwise drift;
the weekly picker's existing tests must pass unchanged, which guards the refactor). The finder keeps
a local map of story facts (seeded from `episodeStories`, then every result and suggestion) so the
chosen list shows titles for stories not on the current page. `PodcastTable` shows "Standalone" in
the Week column; the detail header a "Standalone" badge in place of the week key.

**Concurrent work.** Another agent is fixing admin auth and reload (client auth context, admin
layout, server auth routes). This plan touches none of those. One shared file:
`client/src/lib/admin-api.ts`, where this plan adds three methods inside the `podcasts` block
(around line 347) and the auth work most likely changes the token refresh at the top (lines
112-240). Different regions; implement after the auth fix lands, or merge carefully and re-run the
client tests.

## Changes

| File | Change |
|------|--------|
| `server/prisma/schema.prisma` | `enum PodcastKind { weekly standalone }`; `Podcast.kind PodcastKind @default(weekly)`; `weekKey` comment "null for legacy and standalone rows" |
| `server/prisma/migrations/<ts>_podcast_kind/migration.sql` | Via `db:migrate:create`: enum, column with default, CHECK `podcasts_standalone_without_week_key`; delete any `DROP INDEX "stories_embedding_idx"`. `db:generate` needs the dev server stopped |
| `server/src/config.ts` | `config.podcast.suggestPoolMax` (60) |
| `server/src/lib/aiLabelCopy.ts` | `PODCAST_EPISODE_COPY` record, standalone strings, sign-off moved here, `podcastOpener`/`podcastSignOff`/`podcastEpisodeAiLine(humanEdited, kind)`, `PODCAST_STANDALONE_COPY_CONFIRMED` |
| `server/src/schemas/llm.ts` | `podcastDialogueSchemaFor(kind)` (weekly unchanged) |
| `server/src/prompts/podcast.ts`, `podcast-select.ts` | Required `kind`; per-kind wording record (weekly text unchanged) |
| `server/src/services/podcastDialogue.ts` | `assembleSpokenSegments(dialogue, kind)`, `dialogueCharBudget(kind)`, required `opts.kind` in `validateDialogue`, standalone relative-time rule; sign-off read from `aiLabelCopy` |
| `server/src/services/podcastScript.ts` | Export `chooseStories(pool, kind)`, `TooFewStoriesError`, `snapshotOf`, `loadStoriesByIds(ids)`, the `PoolStory` type; `writeEpisodeScript(stories, kind)`; `buildShowNotes(summary, stories, humanEdited, kind)` |
| `server/src/services/podcastStandalone.ts` (new) | *Responsibility:* the standalone episode's entry points: create it and find and choose its stories among all published stories. *Exports:* `createStandaloneEpisode`, `searchStandaloneStories(filters)`, `suggestStandaloneStories(id, filters)`, `saveStandaloneStories(id, storyIds)` |
| `server/src/services/story.ts` | `publishedStoryWhere(filters)` (exported wrapper; `buildWhereClause` stays private) |
| `server/src/services/podcastEditing.ts` | Export `storyCountErrors`; `saveEpisodeScript`/`updateEpisodeMeta` pass `kind` to `validateDialogue`, `assembleSpokenSegments`, `buildShowNotes`. `replaceEpisodeStories` unchanged |
| `server/src/services/podcastPipeline.ts` | `defaultEpisodeTitle(row)`; `selectStage` refuses standalone (backstop); `writeScriptStage` passes `kind`; `rewindWrite` uses `defaultEpisodeTitle(episode)` |
| `server/src/services/podcastWeekly.ts` | `startAdminRun`: 409 for standalone with effective stage `created`, before claiming; `runEpisode`: dry-run reset of a standalone row to `selected`; `findOrCreateWeekEpisode` uses the new `defaultEpisodeTitle` signature |
| `server/src/services/podcastPublish.ts` | `pickAutoPublishCandidate` adds `kind: 'weekly'`; `publishRefusal` (`Pick` gains `kind`) refuses unconfirmed standalone; `getPublishedEpisodes` selects `kind` |
| `server/src/services/podcastAudioStages.ts` | `episodeChunks(Pick<'id'|'dialogue'|'kind'>)`; ID3 comment by kind; `voiceEpisode` refuses live voicing of an unconfirmed standalone row |
| `server/src/services/podcastShow.ts` | `PublishedEpisode.kind`; AI line by kind |
| `server/src/services/podcast.ts` | `kind` in `LIST_COLUMNS` and `getActiveEpisodes`' select; `ttsCharsEstimate`'s `Pick` gains `kind` |
| `server/src/schemas/podcast.ts` | `podcastStoryFiltersSchema` and the search query schema extending it with `page`, `pageSize` |
| `server/src/routes/admin/podcasts.ts` | `POST /standalone`, `GET /story-search` (both before `/:id`), `POST /:id/suggest-stories` (`expensiveOpLimiter`); `PUT /:id/stories` dispatches on kind |
| `server/src/scripts/eval/suites/podcast.ts`, `server/src/scripts/eval/checks.ts` | Pass `'weekly'` |
| Existing server tests that call the changed signatures | `podcastDialogue.test.ts`, `prompts.test.ts`, `podcastScript.test.ts`, `podcastPipeline.test.ts`, `podcastAudioStages.test.ts`, `podcast.test.ts`, `podcastFeed.test.ts`, `routes/public/podcast.test.ts`, `podcastWeekly.test.ts` (its `defaultEpisodeTitle` mock): pass `'weekly'` or add `kind` to fixtures; `server/src/test/helpers.ts` sample gets `kind: 'weekly'` |
| `shared/types/index.ts` | `PodcastKind`; `kind` on `PodcastListItem`; `PodcastStoryCandidate`; `PodcastStoryFilters` |
| `client/src/lib/admin-api.ts` | `podcasts.createStandalone`, `podcasts.storySearch`, `podcasts.suggestStories` (podcasts block only; see "Concurrent work") |
| `client/src/hooks/usePodcasts.ts` | `useCreateStandalonePodcast`, `usePodcastStorySearch(filters, page)`, `useSuggestPodcastStories` |
| `client/src/components/admin/podcastStoryDraft.ts` (new) | *Responsibility:* the chosen-stories draft both pickers edit: draft, dirty reporting, following the saved ids, save with 422 errors, discard, and the pure `moveStory`. *Exports:* `usePodcastStoryDraft`, `moveStory` |
| `client/src/components/admin/PodcastStoryPicker.tsx` | Uses `usePodcastStoryDraft`; behaviour unchanged |
| `client/src/components/admin/PodcastStoryFinder.tsx` (new) | *Responsibility:* choosing a standalone episode's stories from all published stories: filters, paginated results, Suggest stories, the ordered chosen list. *Exports:* `PodcastStoryFinder` |
| `client/src/components/admin/PodcastStoriesTab.tsx` | Finder for standalone at `created`/`selected`; standalone Start over without advance, its copy |
| `client/src/components/admin/podcastRun.ts` | `nextAction`: `'choose-stories'` for standalone at `created` |
| `client/src/pages/admin/PodcastsPage.tsx` | New podcast button; empty-state copy names both |
| `client/src/components/admin/PodcastTable.tsx`, `PodcastDetail.tsx` | "Standalone" in the Week column and as a header badge |
| `client/src/test/podcasts.tsx` | Fixture `kind: 'weekly'`, plus a standalone factory |
| `.context/podcast.md` | New section "Standalone episodes" (kind and CHECK, creation and title, finder, suggest, save, job exclusion, copy gate); `humanEdited` rule for standalone; module and admin endpoint tables; troubleshooting for the 409 "choose the stories first" and the publish/voicing refusal |
| `.context/ai-transparency.md` | Rows 8 and 11 and the podcast measures: standalone episodes, person-chosen stories, their opener and AI lines pending owner approval (publish and live voicing gated); open owner decision: the show description still says "weekly" |
| `.context/prompting.md` | One line: podcast prompts carry per-kind wording records; standalone wording never dates stories relative to now |
| `.context/admin-dashboard.md` | One line: New podcast and the story finder |
| `.context/decisions.md`, `.context/decisions/0014-…`, `0015-…` | Written at implementation when the stubs are promoted (`adr` skill) |

## Tests

Server (Vitest, `vi.hoisted` prisma mocks as in the existing podcast tests):

- `podcastPublish.test.ts`: `pickAutoPublishCandidate`'s where clause includes `kind: 'weekly'` and the week keys; `publishRefusal` refuses a ready standalone row while unconfirmed (constant passed as a parameter, as `editedAiLineRefusal` does) and allows it when confirmed; a weekly row is unaffected.
- `podcastWeekly.test.ts`: `startAdminRun` refuses a standalone row at `created`, and at `scripted` with `rewindTo: 'created'`, without claiming the lease; allows `selected` and `rewindTo: 'selected'`; `runEpisode`'s dry-run reset rewinds a standalone row to `selected` and a weekly one to `created`.
- `podcastStandalone.test.ts` (new): save at `created` writes snapshot, `stage: selected`, `mode: interactive`, leaves `humanEdited` false; save at `selected` keeps the mode and ticks `humanEdited` only on a changed set or order; unpublished ids → 422; published or weekly row → 409; search passes filters through `publishedStoryWhere` and paginates; suggest refuses a weekly/published/in-progress row (409), maps too few matches to 422 without calling the model, caps the pool at `suggestPoolMax`, returns the model's order; create writes `kind: standalone`, `weekKey: null`, the dated default title.
- `podcastScript.test.ts`: `chooseStories` drops unknown and duplicate ids, caps at max, throws `TooFewStoriesError` under min; the weekly wrapper keeps its message; a standalone call builds the standalone prompt variant; `buildShowNotes` picks the AI line by kind.
- `podcastDialogue.test.ts`: `assembleSpokenSegments` uses the standalone opener and sign-off; `dialogueCharBudget` per kind; the relative-time rule is an error for standalone (model and person), absent for weekly, and a fixture whose story summary says "this week" passes as long as the dialogue does not repeat it.
- `podcastAudioStages.test.ts`: `episodeChunks` of a standalone row carries the standalone opener and sign-off (the cost estimate's input); `voiceEpisode` blocks a live standalone voicing while unconfirmed and allows a dry run.
- `podcastPipeline.test.ts`: `writeScriptStage` on a standalone row writes the model title without prefix and the standalone opener; `selectStage` refuses a standalone row; a rewind to `selected` restores the dated default title.
- `podcastFeed.test.ts` / `podcastShow`: a standalone published episode's descriptions start with the standalone AI line.
- `routes/admin/podcasts.test.ts`: `POST /standalone`; `GET /story-search` validates the query (400 on a bad date or `pageSize` > 50) and is not captured by `/:id`; `POST /:id/suggest-stories` maps 409/422; `PUT /:id/stories` dispatches by kind.

Client (Vitest + RTL, `ToastProvider` wrapper):

- `podcastRun.test.ts`: `nextAction` → `choose-stories` for standalone at `created` (mode null and interactive), `approve-stories` at `selected` awaiting review; weekly unchanged.
- `podcastStoryDraft`: `moveStory` at the ends and in the middle.
- `PodcastStoryFinder.test.tsx`: Add appends and respects max; Remove respects min; Suggest replaces the draft and marks it dirty; a 422 from Suggest shows its message; Save sends the chosen ids in order.
- `PodcastStoriesTab.test.tsx`: standalone at `created` shows the finder and no mode choice; Start over on a standalone rewinds without advance.
- Existing `PodcastStoryPicker.test.tsx` passes unchanged (guards the draft extraction).

No tests for the copy strings or the prompt wording themselves (static content). Manual check before
the owner confirms the copy: one standalone run in dev (dry run: LLM calls are real, the voice is
the silent stub) to read the script for relative-time slips and the selection over a one-topic
filter.

## Out of Scope

- Changing the show-level description or the `/podcast` page intro, which still say "weekly"
  (owner's call, flagged above).
- A recalibration eval (`eval:recalibrate`) for the standalone prompt variants; the fixtures are
  weekly pools, and the weekly prompt text is unchanged. The manual dev run stands in.
- Automatic generation or publication of standalone episodes, a standalone schedule, a separate
  feed, or `kind` in the public JSON or feed.
- Hybrid (semantic) search in the finder; it uses the admin list's text match.
- Any change to the admin auth context, admin layout or server auth routes (another agent's work).
