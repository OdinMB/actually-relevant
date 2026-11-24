# Prompt Design (GPT-5/GPT-6 reasoning models)

Prompts are written for OpenAI's reasoning models following the GPT-5 and GPT-5.2 prompting guides, and since phase 2 of the GPT-6 migration (2026-09-24) they are tuned for the defaults gpt-6-luna and gpt-6-sol (`.context/llm-analysis.md`). The large tier moved to gpt-6.1-sol on 2026-10-27 with its prompts unchanged, so the gpt-6-sol lessons below are not yet re-measured on it. The structure below carries over; the calibration lessons further down are Luna-specific. Read this before modifying any prompt in `server/src/prompts/`.

## Structure

Each prompt follows Role + Goal + Constraints:

1. `<ROLE>` — Who the model is (e.g., relevance analyst, editorial curator)
2. `<GOAL>` — What to produce, with key constraints inline (e.g., the fields a rating depends on)
3. Constraint sections — XML-tagged blocks for guidelines, requirements, criteria

## House order

Every prompt is laid out for the prompt cache, cached or not (owner, 2026-11-18: one structure everywhere, valued above an extra calibration run; ADR-0069):

1. **Fixed first**: the role, goal, rules, examples and the task, byte for byte the same on every call.
2. **Fixed for the run next**: blocks every call of one run shares (the issue list of a pre-assessment run, the story a research run extracts for).
3. **Per call last**: the article, the stories, the facts, the draft.
4. **The call's values in a closing `<REQUEST>` block.** A date, count, character limit or id a rule needs is never written into the rule: the rule names the block ("Select exactly as many articles as `<REQUEST>` asks for", "before the old-news date `<REQUEST>` gives"), and `<REQUEST>` at the end holds the values. So the rules stay one string, and a value can never end up above the breakpoint.

Each builder's doc comment states `Cache: on` or `Cache: off` with the reason, and its house order. Reordering is meant to keep each prompt's meaning: every rule, block and value is still there, only placed differently. A wording change made for the move (a rule that said "above" now names the block it means) keeps its sense. Each changed prompt still goes through its eval ("Checking a changed prompt" below), since order can shift a model's answers.

## Prompt caching

How the cache is asked for and priced is in `.context/llm-analysis.md`, "Prompt caching". The decision per prompt:

- **On** when both hold: the stable part (fixed and run-fixed blocks, plus the response schema, which OpenAI counts in the prefix) reaches the cache's 1,024-token minimum, and the same stable part is sent at least twice within the cache's 30 minutes (several calls in one run, or one call per story of a daily-edition batch). A cached builder has `build…PromptParts()` returning `{ stable, data }` (`promptParts`), and the plain `build…Prompt()` returns their joined text, which versions and tests read. A write costs 1.25 times the input price once, a read 0.1 times after it; parallel first calls on a cold cache all write.
- **Off** otherwise: one call a run (selection, newsletter, podcast), or rules under the minimum (dedup, social posts, related stories, the research queries, earlier coverage and derived fields, the later pass's note). Off is a plain string with no breakpoint, which explicit mode never writes.
- **At the minimum** (about 1,050 tokens): on where a run repeats it many times (the context structure call, the later pass's judge); off for reclassification, an editor's rare bulk action, where the saving is small and the prefix may fall under the minimum.

On today: full assessment, pre-assessment, research's extraction (a pass's with the structured fields too), write, repair and fact check, the context structure, gap list, extraction and card write, a later pass's judge and update, the overview link confirmation (its rules and schema pass the minimum, and a night sends 9 to 60 of them; the founding draft and check are off: a handful a night), and the overview stands write (several refreshes a night, dozens while a backfill drains; the review and the re-center's draft and check are off: rare, each input its own).

**The prefix test.** `prompts/cachedPrompts.test.ts` holds every cached builder: two calls with different inputs share one stable part, the stable part holds none of the call's values, and the stable part plus the data is the plain builder's text. Add a builder there when it turns cached; a rule that interpolates a per-call value fails it.

## Checking a changed prompt

| Prompt | Check |
|------|-------|
| Pre-assessment, full assessment, dedup | `eval:recalibrate --steps preassess,assess` (and `dedup`), on a fresh sample with `--repeat 3` (`.context/model-eval.md`, "A rating-prompt change on a fresh sample") |
| Reclassification, Actually Uplifting selection | `eval:recalibrate --steps reclassify`, `--steps uplifting-select` |
| Selection, podcast selection and dialogue, social posts | `eval:recalibrate --steps selection`, `podcast`, `social-post`; newsletter selection with `eval:models --suites large` |
| Related stories | `eval:models --suites related` |
| Research's steps | `eval:research`; the fact check also `eval:overviews --steps fact-check` |
| Context card steps, a pass's first pass | `eval:overviews --steps context` |
| A later pass's judge, update and note | `eval:overviews --steps update` |
| Overview link confirmation, founding draft and check | `eval:overviews --steps link,found,role` (tune on `--half tune`, read the bars on `--half judge`) |
| Overview stands write | `eval:overviews --steps pass-pool,stands,fact-check --facts stands` (same halves) |
| Overview review | `eval:overviews --steps review` |
| Overview re-center draft and its blind check | `eval:overviews --steps recenter` (planted narrowed charters, the anchor breach, Colorado's center once reviewed); the signal fields of the link confirmation with `link` |

Emotion-only tagging has no check of its own: the preassess step is its proxy (the same classification task).

## Key Principles

**Declarative over procedural.** Content requirements describe *what* the output should contain, not step-by-step procedures. The model's internal reasoning determines the analysis path. Do not add procedural instructions like "First do X, then do Y."

**No legacy CoT triggers.** GPT-5 and GPT-6 reasoning models handle chain-of-thought internally. Never add:
- "Think step by step"
- "Take a deep breath"
- "Follow this prompt exactly as written"
- "Go through the steps one by one"

These waste reasoning tokens and can degrade performance.

**XML scaffolding for constraint sections.** Use XML tags for distinct rule blocks:
- `<ANALYSIS_REQUIREMENTS>` — field-by-field content expectations
- `<SELECTION_CRITERIA>` — evaluation criteria for selection
- `<GUIDELINES>` — cross-cutting rules
- `<GENERIC_LIMITING_FACTORS>` — common reasons that reduce relevance

**Concrete length constraints.** Always specify exact counts and word limits rather than vague quality directives:
- Good: "exactly 4 bullet points, each 2-4 sentences"
- Bad: "incredibly detailed bullet points"

**Schema carries format guidance.** Markdown formatting, field structure, and enum definitions belong in the Zod `.describe()` annotations in `server/src/schemas/llm.ts`, not duplicated in prompts. If format instructions appear in both places, the model may waste reasoning tokens reconciling contradictions.

**No contradictions.** Reasoning models spend reasoning tokens trying to reconcile conflicting instructions rather than ignoring one. If the schema says one thing and the prompt says another, fix the conflict.

**Rating wording is calibration.** Directional words in a rating instruction ("conservative", "verify it truly meets", "large reductions are justified") shift a model's whole rating distribution, and models differ in how literally they take them: gpt-6-luna rated about 0.6 lower than gpt-5-mini on the same wording. Keep the schema `.describe()` in step with the prompt, and never change rating wording without an `eval:recalibrate` run (`.context/model-eval.md`): a site whose ratings drift is no longer comparable with its archive. What the Luna recalibration (2026-09-24) showed:
- Neutral anchors ("the level whose description it matches best") closed most of the mean gap but left Luna's pre-assessments piled at 4. The share passing the ≥5 gate only moved when the 5-6 anchor text itself changed, so check the share at the threshold, not only the mean.
- Rating instructions can leak into the other fields of the same call: wording about who is affected appeared to pull issue choices toward human development (about 4 points less issue agreement over three runs each). Say explicitly that the issue follows the subject, not the rating.
- One run moves agreement rates by about ±3 points on 150 stories with no prompt change. Compare wordings on repeated runs, not on a single run: `eval:recalibrate --repeat N` on the fresh sample in `DOCS/2026-11-01_rating-eval` reports the spread between runs (`.context/model-eval.md`).

**Published fields never talk about the input.** Models write about the text they were given ("the article does not quantify…", "the supplied excerpt") unless the prompt says the fields are published as written and shows Bad/Good pairs. A prohibition on one field does not carry over to the others: gpt-6-luna did it in 29 of 50 full assessments with only the relevance-summary rule, 5 with a general rule, 2 with the rule plus examples (2026-09-24). Rewording the factor and limiting-factor schema descriptions at the same time coincided with a 0.08 lower mean rating (one run each, so not conclusive) and was reverted: treat text next to the rating fields as calibration too.

**Impact in plain terms, not rating vocabulary.** The published assessment fields (factors, limiting factors, relevance summary) borrowed the rubric's words ("moderate governance risk", "limit the impact", "constrain"), named agreements and systems without saying what they were, and some headlines only made sense next to their label ("Conditions worsened in 16 of 38 countries"). Since 2026-11-01 (owner's homepage plain-language review) the assess prompt's `<GUIDELINES>` keep the impact analysis but ask for it concretely (who, how many, how soon, what could stop it) with Bad/Good pairs, explain a named thing on first mention in each field, and the title rules require a headline that names its own subject. The new text sits next to the rating fields, so it counts as calibration (above): it ships only after an `eval:recalibrate` run on the full assessment shows the rating distribution unchanged.

**A headline may reuse the label's core subject word.** Forbidding every shared word hid the subject when the label *is* the subject: label 'HIV funding' gave 'US approves $5.88 billion for global treatment and prevention', 'AI safety' gave 'China creates institute for global cooperation'. Since 2026-11-01 the title rules (prompt and both title `.describe()`s in `schemas/llm.ts`) allow one core word or name from the label (HIV, AI, Wikipedia) and nothing else of its phrasing, with the HIV case as a Bad/Good pair; the eval's `labelTitleDistinct` check (`scripts/eval/checks.ts`) passes at most one shared content word to match. The same change added an agency-acronym example (UNAIDS) to the first-mention rule, after UNAIDS, DARPA, AUKUS and CSIS went unexplained in the eval, and an American-spelling line for every written field ('tyre makers' came out once). Not yet checked with `eval:recalibrate`.

**gpt-6-sol overshoots a stated length, so the podcast aim sits below the band's middle.** The podcast dialogue (`prompts/podcast.ts`) states one aim, `config.podcast.spokenCharAim` (whole episode, 4,900; about 4,700 for the model's own turns after the code-added opener and sign-off), and restates it as a per-story target, a turn count and a word equivalent (`podcastLengthTargets`); the band (`spokenCharBand`, 4,200–6,200) only validates. Evidence on the eval sample (2026-10-06), model's own turns against a 4,022–6,022 budget: asked for 4,700, six first drafts ran 5,192–5,917; asked for 4,100, 5,399 and 5,707 (a lower aim barely shortens drafts); asked for 5,000 (the band's middle, runs `DOCS/2026-10-06_podcast-eval-r6` to `-r8`), 6,118 and 6,155, one of three valid (a higher aim does lengthen them). Back at 4,700 after the top was raised (`-r9` to `-r11`): 6,317, 5,902 and 5,589, two of three valid. Sol writes roughly 20% over the aim with a spread of several hundred characters, so the aim is set for the overshoot, not at the middle, and production's one regeneration with the length error catches the tail. Don't move the aim back to the band's middle, and don't expect lowering it further to buy much. All of this was measured on gpt-6-sol; gpt-6.1-sol (the large tier since 2026-10-27) has not been measured. The large-tier eval writes one dialogue per arm, which shows a band miss as a validation error but measures no overshoot, so re-measure on several drafts as above before relying on the 20% for 6.1 Sol.

**The podcast prompts carry a per-kind wording record** (`KIND_WORDING` at the top of `prompts/podcast.ts` and `podcast-select.ts`): the weekly text is unchanged, and the standalone variant never dates a story relative to now, since its stories may span weeks (validation enforces it, `.context/podcast.md`). Change a kind's wording in its record, keep the two kinds' structure the same, and run `eval:recalibrate --steps podcast` for a weekly change (the eval fixtures are weekly pools; a standalone change has no fixture, so read one dev dry run's script instead).

**Tell the model what code adds, or it writes it too.** The podcast prompt said code adds a fixed sign-off after the outro, and gpt-6-sol still closed the outro with its own "Thanks for listening to Actually Relevant.", so every episode thanked listeners twice. Knowing what follows is not enough; the constraint has to say what the model's own text leaves out ("It does not thank listeners, say goodbye or sign off: the fixed sign-off that code adds after it already does"), with validation behind it (`closingErrors`, `.context/podcast.md`). With that constraint (2026-10-07, `DOCS/2026-10-07_podcast-eval-thanks`, one run on the cached sample) the outro ended on a thought about the stories, with no thank-you, and the dialogue passed validation first time inside the band. Apply the same pattern to any code-added text (the AI opener before the intro).

**A writer follows the source text it is shown, so show it none the checks can't see.** Research drafts written from the original article's full text plus cited facts, a citation after every sentence, came out as close translations of a source's sentences in several small passages per story (2026-11-13): a sentence tied to one fact reads most naturally as that fact's source sentence, restated. Since then (`prompts/research.ts`, `.context/story-research.md`, "Own words") the write prompt carries no article text, only facts, their supporting sentences and the voices' quotes, which are exactly what the copying checks compare against, under the ids their flags name (a judge's flag quotes the line, so the repair sees what it echoed); it cites per paragraph, and an `<OWN_WORDS>` block asks for a synthesis that merges sources, keeps no run of a source's words beyond names, figures and scope, and puts quotation marks only in the key quote, with a Bad/Good pair (a close English rendering of a German sentence against the same facts merged with a second source's). The extraction prompt has a fact's statement restate the fact in its own order and phrasing, since the writer reads statements too: a statement that translates its sentence carries the copying into the draft. Not yet measured: check it with `eval:research` before relying on it. The fact-check judge, asked only for a "close rendering", flagged a plain restatement of a figure-laden fact in its source's order (2026-11-13); its rules now define copying as reproducing a source's expression, say that a plainly stated fact is not copying, and show a generic Not copying / Copying pair (`.context/story-research.md`, "Own words"). Also not yet measured.

**Ask a check for the fact, and let code apply the rule.** The owner's rule that warnings and reactions never found an overview (ADR-0075) failed as a rule in the founding draft: on 2026-11-22 it changed the charters the draft wrote and cost 3 to 4 points of filing on the tune half. Since 2026-11-23 the founding check (`prompts/overviews.ts`, `buildFoundCheckPrompt`) only answers a per-story fact, `occurred`, defined in an `<OCCURRED>` block of examples on both sides, and `acceptFounding` applies the rule; the draft is untouched. Tune half (2 runs, `DOCS/2026-11-23_founding-tune`): joins right 82.5% to 87.2%, found 81.0% to 83.1%, wrong foundings 75% to 65%. Judged half (3 runs, `DOCS/2026-11-23_founding-eval`, against the rescore of the 2026-11-22 replay, which predates deduplication and the repeat fix, so not all of the gain is the prompt's): joins right 96.9% to 97.5%, found 94.2% to 93.3%, wrong foundings 44.4% to 25.0%. The check is lenient: only about 1 in 10 answers was "no", and it calls a buildup an occurrence ("preparations already under way" for the Iran pre-war threats), which "a response under way" in the block seems to admit.

**A summary writer rounds a fact up unless the prompt names the ways it does.** The overview stands' first judged run (2026-11-24, `DOCS/2026-11-19_upkeep-eval`) had 11.8% of its sentences unsupported by their facts: a proposal stated as in force, a share "before the war" as today's, the date a fact was reported as the day the event happened, the outlet credited as the actor, a response announced written as under way. The rules in `STANDS_RULES` (`prompts/overviews.ts`) now name each: keep the fact's strength and scope (with short examples of wording to keep), the date attribute is when it was reported, credit only as the fact's own text does, "According to X" names who reported and not who acted, a response only as far as its fact states it; and an `<OWN_WORDS>` block carries the 12-word rule with three Bad/Good pairs, since the code's copying check dropped lines the writer had lifted. Judged half, 3 runs: unsupported sentences 0.9%, unsupported lines of "What's being done" 2.7%. A further round that told the writer to lead with the counts and tied each place and purpose to its fact made the tuned half worse (6.4% and 10.3%) and was taken out: more rules about what to include pushed the writer past its facts. Still open: "What's being done" is present 66.7% of the time against a bar of 70%, because the copying check drops the only line at several checkpoints (the owner accepted it for now, 2026-11-24).

## What to Keep in Prompts

- Content quality guidance (good/bad examples for summaries, titles, quotes)
- Domain knowledge (generic limiting factors, what constitutes sensationalist language)
- Evaluation criteria and scoring methodology
- Issue-specific guidelines injected from the database

## What Belongs in the Schema

- Output field formats (Markdown, plain text, date format)
- Field-level constraints (word counts, character limits, enum definitions)
- Structural guidance (bold labels, bullet format patterns)

## References

- [GPT-5 Prompting Guide](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide)
- [GPT-5.2 Prompting Guide](https://cookbook.openai.com/examples/gpt-5/gpt-5-2_prompting_guide)
- [Reasoning Best Practices](https://platform.openai.com/docs/guides/reasoning-best-practices)
