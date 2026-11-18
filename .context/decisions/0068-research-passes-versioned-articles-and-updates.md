---
id: ADR-0068
title: "Research passes: articles are versioned; a later pass rewrites only the sections new facts make wrong or substantially different, with a public Update that keeps the old text readable"
status: accepted
date: 2026-11-18
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [architecture, data, ai-risk, editorial]
tags: ["research-passes", "article-versions", "updates", "fact-demotion", "eval"]
---

# ADR-0068 · Research passes: articles are versioned; a later pass rewrites only the sections new facts make wrong or substantially different, with a public Update that keeps the old text readable

## Context

ADR-0067 made research one repeatable step over one evidence pool per story. A pass on a story that
already has an article (a later pass) finds what has been reported since; the question is what it
may do to an article readers have already read. The owner's rule (2026-11-17): keep the article as
it is unless new facts make something wrong or substantially different; then the affected section
is rewritten, and an Update records what changed, when and why, keeping the earlier text. Plan:
`.plans/2026-11-17_research-passes.md`, approved on 2026-11-17, its "For Odin" items proceeding on
their recommendations until the owner says otherwise. This entry lands with the plan's phase 3 (the
later pass, versions, undo and revert, the `update` eval); nothing calls it until phase 4 wires the
pass and the owner switches `research_pass` on.

## Decision

- **A section changes only when a fact found since makes it wrong or substantially different.** A
  judge reads each section of the current version with the facts it cites and the facts this pass
  found, and answers `unchanged`, `wrong` or `substantially_different` per section, naming the facts.
  Code acts on a flag only when it names a fact this pass found or a demoted one; a flag naming
  neither is recorded as `unfounded` and the section stays as it is, so every rewrite rests on newer
  reporting, never on the model's own knowledge.
- **A section citing a demoted fact is always rewritten**, whatever the judge says: the code flags
  it. A demotion is a fact the judge names as contradicted by a fact found since; code accepts it
  only for an old usable fact and a contradicting new one. **A newer value of the same measure, as of
  a later moment, supersedes the old one and is no demotion**: the structured `asOf` dates are
  compared at the precision both give, so a correction for the same moment demotes and an update for
  a later one does not.
- **Only the flagged sections are rewritten; every other byte stays.** The rewrite is research's
  repair prompt framed as an update, merged section by section, and the new version's projection
  keeps every untouched section as the very text and citations readers saw. When the opening
  paragraph is rewritten, the title, summary and blurb are checked against it. The rewritten
  sections go through research's checks and repair rounds; one that still fails is dropped when the
  article can do without it (a change with no text after), and when it cannot (the title, the
  opening, the summary, the blurb), **the update fails and the article stays as it is**
  (`update_failed`). Nothing unpublishes a story automatically; phase 4 adds an admin notice.
- **Every change gets an Update note**: at most 60 words, citing a fact found since or one shown
  wrong, no quotation marks, at most one em dash, fact-checked and copying-checked like a paragraph,
  with one repair attempt. A note that still fails, or one the budget or a failed call leaves
  unwritten, is a fixed line naming the sections rewritten and removed and the outlets ("Updated:
  Story paragraph 2 rewritten after new reporting from Reuters."), never an unchecked sentence.
- **Articles are versioned rows** (`article_versions`, ADR-0067), now with a `draft` column holding the
  article with every fact id each section cites (migration `20261118120000_article_version_draft`,
  additive and nullable); a legacy version, which never stored them, reads them from its citations.
  A version records its changes (section, text before, text after) and its note. Numbers grow from
  the story's highest, so an undone version's number is never reused.
- **Undo and revert.** "Undo this update" acts on the newest version only, and only when it is an
  update: the previous version's fields go back on the story through research's fenced write, the
  current version becomes `reverted` (its Update leaves the page) and the previous one current, both
  fenced on their status. "Revert to single-source", and a re-assess, mark every version `reverted`.
- **A later pass writes cards only when its pool changed**: when it gained no supported fact from a
  page and demoted nothing, the cards stay as they are, and they never carry an Update (For Odin 6).
- **A later pass's coverage search covers what is new**: its window opens on the day the story's last
  completed pass, or legacy research run, started, and ends today.
- **The judge, rewrite and note start on the medium tier**; the `update` eval decides whether one
  moves, and gates the switch with its bars (ADR-0066): expected changes flagged on the right section
  at least 90%, false rewrites at most 10%, untouched sections byte-identical (100%, a code
  assertion), planted contradictions demoted at least 90%, false demotions at most 5%, notes accurate
  and complete per the strong judge at least 90%, none unsupported, and notes' copying flags no
  higher than the rewritten sections'.

## Owner decisions

The owner, Odin, answered the plan's "For Odin" 2, 3 and 6 on 2026-11-17 and 2026-11-18, each as the
plan recommended. Like everything here, they take effect only at the switch. They settle what the
page and the admin do, not the words readers see: the header link, the section's heading, its
"Earlier version" disclosures and the marks are drafts in `UPDATE_COPY`
(`client/src/components/research/StoryUpdates.tsx`) that still await his review.

- **Where Updates show (2), decided:** "Updated <date>" in the header, linking to an Updates section
  after Caveats, newest first, each entry giving its date and note, with the earlier text of each
  changed section folded under a closed disclosure with its citations. The page's modified date
  (`dateModified`) is the newest Update's day. The "Updated" mark after each rewritten paragraph or
  point is the plan's, built with the section; his answer did not name it.
- **An editor's pass applies itself (3), decided:** "Research again" writes its version and its Update
  at once, with "Undo this update" one click away. As the plan has it, "Revert to single-source" stays,
  and "Use this version" and the review-before-apply flow go.
- **Cards refresh without an Update (6), decided:** a later pass rewrites the cards, and no Update
  entry lists card changes.

## Open owner decisions

Proceeding on the plan's recommendation, which takes effect only at the switch; recorded here when the
owner answers:

- **A first pass on a published single-source story (5):** recorded as an Update ("Researched with N
  more sources on <date>; the story was rewritten from them"), the earlier version readable.

## Consequences

- Readers see an article change only when newer reporting makes a section wrong or substantially
  different, and always with a dated note and the earlier text; the slug never changes.
- A later pass costs a judge call even when nothing changes, and a rewrite, checks and a note when
  something does; a pass that finds nothing new asks no judge and writes no cards.
- An update that cannot keep its title, opening, summary or blurb leaves the article as it was, which
  can keep a wrong section live until an editor acts on the notice; the alternative, unpublishing,
  was ruled out.
- The fixed-line fallback says less than a note but never states anything unchecked.
- The pass's record keeps every judgment, demotion, check and note attempt, so the admin view and
  the eval can say why a section changed or stayed.

## Alternatives considered

- **Rewriting the whole article on every pass:** readers would see wording churn with no new facts,
  and every untouched sentence would face the checks again.
- **Letting the judge's verdict alone decide:** a flag from the model's own knowledge would rewrite
  published text without newer reporting behind it.
- **Demoting every fact a newer value replaces:** a running count would then read as contradicted
  each time it grew, and the old value would leave the evidence it truthfully was.
- **Unpublishing a story whose update fails:** a reader would lose the story over one section, and
  an automatic unpublish is a decision the owner keeps.
- **A model-written note with no fallback:** a note that fails its checks would either go out
  unchecked or hold the update back.
