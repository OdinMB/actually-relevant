---
id: ADR-0062
title: "Story context runs with no person in the loop; a person steps in only by switching the step off or by hiding and moving a story's cards"
status: accepted
date: 2026-11-16
deciders: ["Odin Mühlenbein", "claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [ai-risk, architecture]
tags: ["story-context", "overviews", "admin", "review"]
---

# ADR-0062 · Story context runs with no person in the loop; a person steps in only by switching the step off or by hiding and moving a story's cards

## Context

The overviews roadmap (`.plans/2026-11-16_story-overviews.md`, decision D3, the owner's on
2026-11-16) has every step run automatically: a person steps in only by switching a step off or
setting it to review. Story context, module 1, is the first code it governs. Without any manual
control, a wrong number a reader reports would stay on the page until someone edited the database,
and switching the step off keeps the cards already shown. The owner decided on 2026-11-16 (plan
`.plans/2026-11-16_story-context.md`, "For Odin" 5) that the admin may hide and move a story's
cards.

## Decision

- **No person reviews what the step writes before readers see it.** Each card goes live as the
  step's checks leave it; the checks drop what fails (ADR-0061, ADR-0057's amendment of
  2026-11-16).
- **A person steps in by switching the step off** on the Jobs page, which stops new context and
  keeps what was built, **or on one story's cards** in its edit form's Context section: hide or show
  one card, hide or show all, and move a card beside another paragraph or point or into the "More
  context" section. Hiding sets a box's status to `demoted` and showing sets it back to
  `unreviewed`; nothing is deleted. A moved card keeps its place in every placement mode, under the
  same limits.
- No review status gates serving: `reviewed` exists on the records for module 2, and nothing sets
  it yet.

## Consequences

- A bad card reaches readers until the next person who notices hides it; the checks and the eval
  gate before switching on are what keep that rare.
- Who hid or moved a card, and when, is not recorded (follow-up, should it matter).
- "Run now" writes live cards too, even while the step is off; the job's note says so.

## Alternatives considered

- **Only "Hide all context"**: less work, but one wrong number takes down all of a story's context.
- **A review queue before publishing cards:** a person in the loop, which D3 rules out.
