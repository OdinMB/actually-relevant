---
status: implemented
type: feature
complexity: complex
---

# Context cards: no In numbers box, no repeated source or label, flush single figures

Odin's feedback of 17 Nov, with screenshots of live cards: "Side note not optimal yet. Redundancy in info strings and sources, unnecessary indentation when there's only one thing in the context box. Case in numbers is weird, too, as quite different things are presented there in one card. The thing that supposedly holds it together is that it's numbers. But that's not useful." Screenshot 1, a "Who it reaches" side note: heading "Organizations whose resources were accessed", an indented block with a left rail holding "55", the label "organizations whose resources were accessed, 2026" and a source chip "Mallory", then the footer "Mallory · As of 2026". Screenshot 2, the "In numbers" card "The case in numbers": unrelated figures (80/80+/80+ losses of control from three sources, $2,500 a violation, about 700 agents) grouped only because they are numbers. The three changes below were promised to him in reply, so the plan is approved as written (owner asked). Context: `.context/story-context.md`, `.context/public-website.md` ("Story context"), `.context/prompting.md`, `.context/model-eval.md` (the `context` step), `.context/ai-transparency.md` row 16, ADR-0063 (the tile rule, which names the In numbers tiles). The handbook's skills were not loaded when this plan was written, so it has no handbook header or decision stubs; the hard-to-reverse choice is a dated amendment of ADR-0063.

## Approach

### 1. A single figure sits flush

`FigureTiles` draws a card's one tile with no left rail and no indent: the figure, its label and its chips sit flush in the card. Several tiles keep the rail, which is what tells them apart. One tile counts as one figure whether it shows one value or several sources' values side by side.

### 2. Nothing said twice on a card

- **Source chips:** a tile value's chip shows only when the card cites more than one source; the footer already names a sole source. Where a tile shows disagreeing sources side by side, each value keeps its chip, whatever the card's source count.
- **Labels** (`tileLabel`, a new pure module `services/storyContextLabels.ts`, applied by the public view when it serves a tile, so stored cards get it too):
  - a trailing year in the label that is the card's as-of year (", 2026", " in 2026", " (2026)", " 2026") goes, since the footer says "As of …";
  - then, on a card with one tile, the label goes when every content word of it is in the heading (case, punctuation, a plural "s" and a few function words ignored); the heading then says what the number counts. With several tiles each keeps its label, which tells the tiles apart.
  - The write prompt and the tile label's `.describe()` ask for the same: a label adds what the heading does not say, is empty on a one-tile card whose heading already says what the number counts, and gives no date the card's footer gives.
  - The box check judges a tile with an empty label as "heading: value", so the check reads what the reader reads.
- The client shows a tile with no label as the number alone; with disagreeing values and no label, the line reads "Depending on whose count".

### 3. No In numbers box

- **The write** (`buildBoxesPrompt`, `boxesSchema`): the `figures` field goes. A figure is shown only as a tile of the box whose slot it answers (a cost in the response box, a count of people in "who it reaches", a record in "compared"); a figure that answers no slot the story needs is left out, and no box holds figures for being figures. A box may be tiles alone. The prompt's version changes by itself (`CONTEXT_PROMPT_VERSIONS`), so the eval gate's `context` step must run again before the step is switched on.
- **Types:** a box's type is a slot (`ContextSlot`); `BOX_TYPES` and the `figures` member of the client's `ContextBoxType` go. The database enum keeps `figures` for the rows already stored: no migration.
- **Old stored figures boxes are not served:** `contextRecords` reads only boxes whose type is a slot, for the newest run that wrote any and for its boxes, so the page, the admin and the eval never see one; nothing is deleted. A run whose only kept box was the figures box counts as a run that wrote no box, so the cards of the run before it show (the edge case is rare: a step switched off, and editor runs).
- **Placement:** `placeable` and the "figures box always in the section" rule go.
- **Admin:** no In numbers row; `movable` goes from the admin view and the shared type, the place select is disabled only for a hidden card or while a change is saving; the PATCH loses its figures refusal. "What the run did" no longer lists In numbers as found.
- **Caps:** `maxBoxes` 6 (one per slot), `maxSentences` 3 and `maxTiles` 4 stay; the comments lose the figures box.
- **Synthetic data:** the figures box goes; its two figures move to the cards they answer. A "who it reaches" card beside `P2` with one tile (600,000 pupils, one source), whose label repeats the heading so the served page shows the label rule; the "What comes next" card in More context gains a cost tile on which the province's office ($48m) and Plains Budget Watch (about $52m) disagree, so its values keep their chips.
- **The eval** has no figures scoring: its fixtures and fake answers lose the `figures` field.

### Docs

`.context/story-context.md` (the write, caps, places, records, what readers get, admin, checking locally, the tile labels, the eval gate rerun), `.context/public-website.md` (tiles), `.context/admin-dashboard.md` (the place select), `.context/database-migrations.md` (the synthetic set), `.context/ai-transparency.md` row 16 (up to 6 cards, figures inside them), ADR-0063's dated amendment and its index line.

## Verification

TDD for the logic: `tileLabel`, the box check's empty label, `structuralBoxes` without the figures box, `contextRecords` skipping old figures rows, the view applying the label rule, `FigureTiles` (flush single tile, chips by the card's sources, empty label). Playwright on the synthetic story: 1440 (margin notes and More context), a close crop of the single-figure card, and a 390-wide phone with a sheet open.

## Outcome

Implemented as planned, with two departures:

- **The chart's visible source line follows the chip rule too.** The 1440 check showed a sole-source chart card naming its source three times (the chart's "Source:" line, the sentence's chip and the footer). `ContextChart` now takes `soleSource` and drops that line on a card citing one source; the hidden table still names every value's source. A sentence's citation chip stays: it is research's citation group, cited per sentence.
- **A tile with disagreeing values and no label** reads "depending on whose count", lower case like every label, not "Depending".

Playwright passed at 1440, 900 (in the column) and 390 (sheet open); screenshots in `/mnt/project-files/story-directions/build/` (`context-cards-1440.png`, `context-card-single-figure.png`, `context-cards-phone-sheet.png`).
