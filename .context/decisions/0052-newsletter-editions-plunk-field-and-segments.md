---
id: ADR-0052
title: Hold each subscriber's newsletter edition in a Plunk contact field, edition, and send each edition to a Plunk segment the owner creates, with the two segment ids as the one switch that opens the editions
status: accepted
date: 2026-11-06
deciders: ["claude-code (AI)"]
context-repo: OdinMB/actually-relevant
themes: [personal-data, architecture]
tags: ["newsletter", "subscription", "plunk"]
---

# ADR-0052 · Hold each subscriber's newsletter edition in a Plunk contact field, edition, and send each edition to a Plunk segment the owner creates, with the two segment ids as the one switch that opens the editions

## Context

The newsletter gains a second edition, Actually Uplifting. There is still one subscriber list. Each subscriber gets exactly one edition: they choose it at signup and can switch from any issue's footer. Until now every issue went to Plunk's whole audience (`audienceType: 'ALL'`).

Once anyone is on Actually Uplifting, the Saturday full send must stop going to everyone. The owner set three conditions:

- The roughly 160 existing Plunk contacts get no bulk write.
- No code path emails anyone on its own.
- Deploying the change alters nothing readers or the Saturday send see.

Plunk already holds the list and does the unsubscribing.

## Decision

- **Where the edition lives.** A subscriber's edition is the Plunk contact data field `edition`, `'full'` or `'uplifting'`. Only two writes set it:
  - confirming a signup, whose upsert sends `data: { edition }`;
  - the footer switch (`POST /api/subscribe/edition`), which merges the field into the contact's existing data and never resubscribes anyone.

  Nothing writes the field in bulk.
- **Who gets each edition.** The owner creates two segments in Plunk's dashboard:
  - *Full edition*: subscribed contacts matching `edition notEquals uplifting` OR `edition notExists`. The OR is needed because `notEquals` alone does not match a contact that lacks the field, and existing contacts lack it.
  - *Actually Uplifting*: `edition equals uplifting`.
- **The switch.** The two segment ids reach the server as `PLUNK_FULL_EDITION_SEGMENT_ID` and `PLUNK_UPLIFTING_SEGMENT_ID`. Setting both is the one switch for the whole feature (`config.newsletter.editionsOpen`). The config parser refuses to start in three cases: only one id is set, both ids are equal, or either equals `PLUNK_TEST_SEGMENT_ID`.
- **Choosing the audience.** One function, `editionAudience` in `services/newsletterEdition.ts`, decides each live send's audience. It runs before the send is claimed, so a refusal claims nothing.

  | Editions | Edition | Audience |
  |---|---|---|
  | open | full | the Full segment |
  | open | uplifting | the Uplifting segment |
  | closed | full | `ALL` |
  | closed | full, with any confirmed signup that chose Actually Uplifting | refused: `no_audience` |
  | closed | uplifting | refused: `no_audience` |

- **The issue's edition.** The issue records its edition in `newsletters.edition`. A signup records its edition in `pending_subscriptions.edition`, which is forced to `full` while the editions are closed.
- **The footer link.** It names the reader by Plunk's per-recipient `{{id}}`. The page it opens switches only on a button click (owner decision), so a link scanner that runs JavaScript cannot switch anyone.

Rules:
- Never write `edition: ""`, which matches neither segment condition.
- Never name a contact data field `id` or `email`: Plunk's template variables of those names would be overwritten.
- Never send the full edition to `ALL` while anyone is on Actually Uplifting.

## Consequences

- Deploying changes nothing until the owner sets both variables in one step. Until then the signup form shows no choice, issues carry no switch link, and the full issue still goes to `ALL`.
- The owner has steps before opening the editions:
  1. Create the two segments.
  2. Compare the Full segment's count with the admin Subscribers page's per-edition count.
  3. Set both variables at once.
  4. Check that a `[TEST]` issue's footer link carries a contact id.
- A wrong segment id fails at Plunk as a 4xx, which the lifecycle already records as "sent nothing". It never widens the audience.
- Removing the variables later closes the editions again. The full send is then refused, rather than sent to `ALL`, as soon as anyone has chosen Actually Uplifting.
- The field name and the segment conditions live in Plunk, outside this repository. Changing them means editing the segments and, for a renamed field, every contact. This makes the choice hard to reverse.

## Alternatives considered

- **`audienceType: 'FILTERED'` with an inline filter on each campaign.** No dashboard step, but the hosted API's filter shape is unverified. A filter Plunk ignored would send to everyone, the one failure that must not happen.
- **Writing `edition: 'full'` to every existing contact.** The owner asked for no bulk write, and the `notExists` branch of the Full segment makes it unnecessary.
- **A local `subscribers` table as the source of truth.** Plunk already holds the list and the unsubscribes, so a second copy would drift.
- **A switch link that switches on GET, or a signed per-reader token.** Every prefetching scanner would follow a GET link. Plunk cannot compute a signed token per recipient, and storing one per contact needs the bulk write.
