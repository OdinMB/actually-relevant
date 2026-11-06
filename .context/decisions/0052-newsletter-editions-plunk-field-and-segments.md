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
  | closed | full, with any subscriber whose latest known edition is Actually Uplifting | refused: `no_audience` |
  | closed | uplifting | refused: `no_audience` |

- **The issue's edition.** The issue records its edition in `newsletters.edition`. A signup records its edition in `pending_subscriptions.edition`, which is forced to `full` while the editions are closed.
- **What the server knows of each subscriber's edition.** The closed-editions guard cannot ask Plunk which contacts are on Actually Uplifting, since the segment ids are unset by then. So both writes of the field leave a local trace, keyed by Plunk contact id:
  - a confirmed signup: its `pending_subscriptions` row (edition, `plunk_contact_id`, `confirmed_at`);
  - a footer switch: one `edition_switches` row per contact (`plunk_contact_id`, `edition`, `switched_at`), its latest switch, with no address.

  A contact's *latest known edition* is the newer of the two (`anyoneOnUplifting` in `services/knownEditions.ts`). Wherever the record cannot tell, it errs toward Actually Uplifting: a tie, a confirmed Uplifting signup whose contact id never came back from Plunk, and a switch to Actually Uplifting, recorded before Plunk is written; a switch to the full edition is recorded only once Plunk has it.
- **The footer link.** It names the reader by Plunk's per-recipient `{{id}}`. The page it opens switches only on a button click (owner decision), so a link scanner that runs JavaScript cannot switch anyone.

Rules:
- Never write `edition: ""`, which matches neither segment condition.
- Never name a contact data field `id` or `email`: Plunk's template variables of those names would be overwritten.
- Never send the full edition to `ALL` while anyone is on Actually Uplifting, by the latest known edition.
- Every write of a contact's `edition` field leaves its local trace too, or the guard cannot see it.

## Consequences

- Deploying changes nothing until the owner sets both variables in one step. Until then the signup form shows no choice, issues carry no switch link, and the full issue still goes to `ALL`.
- The owner has steps before opening the editions:
  1. Create the two segments.
  2. Compare the Full segment's count with the admin Subscribers page's per-edition count.
  3. Set both variables at once.
  4. Check that a `[TEST]` issue's footer link carries a contact id.
- A wrong segment id fails at Plunk as a 4xx, which the lifecycle already records as "sent nothing". It never widens the audience.
- Removing the variables later closes the editions again. The full send is then refused, rather than sent to `ALL`, while anyone's latest known edition is Actually Uplifting, whether they chose it at signup or switched to it from a footer. A reader who switched back to the full edition no longer counts.
- The local record does not see unsubscribes. A reader who left while on Actually Uplifting keeps the closed full send refused; reopening the editions sends again. That errs toward sending nothing.
- The field name and the segment conditions live in Plunk, outside this repository. Changing them means editing the segments and, for a renamed field, every contact. This makes the choice hard to reverse.

## Alternatives considered

- **`audienceType: 'FILTERED'` with an inline filter on each campaign.** No dashboard step, but the hosted API's filter shape is unverified. A filter Plunk ignored would send to everyone, the one failure that must not happen.
- **Writing `edition: 'full'` to every existing contact.** The owner asked for no bulk write, and the `notExists` branch of the Full segment makes it unnecessary.
- **A local `subscribers` table as the source of truth.** Plunk already holds the list and the unsubscribes, so a second copy would drift. The local trace above is no such copy: it holds only what the server itself wrote, and only the guard reads it.
- **The guard reading confirmed signups only.** That was the first version. It missed footer switches, which were written only to Plunk, and so sent the full issue to `ALL` after a full reader switched to Actually Uplifting. It also kept counting a reader who had switched back.
- **Writing a switch onto the contact's `pending_subscriptions` rows.** A contact may have none (the subscribers imported into Plunk) or several (a returning reader), so it needed a second place anyway, and it would rewrite what the reader chose at signup.
- **A switch link that switches on GET, or a signed per-reader token.** Every prefetching scanner would follow a GET link. Plunk cannot compute a signed token per recipient, and storing one per contact needs the bulk write.
