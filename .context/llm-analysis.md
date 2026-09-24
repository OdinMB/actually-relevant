# LLM Analysis Pipeline

The analysis pipeline uses LangChain + OpenAI to evaluate story relevance through three stages. All stages use `withStructuredOutput` + Zod schemas for reliable parsing. Schema `.describe()` annotations carry format guidance (including Markdown instructions for longer text fields), so prompts use declarative constraints rather than procedural step-by-step instructions.

## Model Configuration

Configuration is centralized in `server/src/config.ts`. Three model tiers are available:

| Tier | Default Model | Reasoning Effort | Used By |
|------|--------------|-----------------|---------|
| Small | `gpt-5-nano` | `medium` | Dedup confirmation, related-stories re-rank, reclassification and emotion-only tagging |
| Medium | `gpt-5-mini` | `medium` | Pre-assessment, full assessment, social story pick, social post text |
| Large | `gpt-5.2` | `medium` | Editorial selection, newsletter selection and intro, podcast script |

Environment variables:
- `OPENAI_MODEL_SMALL` / `OPENAI_MODEL_MEDIUM` / `OPENAI_MODEL_LARGE` — defaults as in the table
- `OPENAI_EFFORT_SMALL` / `OPENAI_EFFORT_MEDIUM` / `OPENAI_EFFORT_LARGE` — reasoning effort per tier, default `medium`. One of `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; any other value throws at startup. Each model accepts a subset: GPT-6 rejects `minimal`, gpt-5-mini/nano reject `none`, and `createChatModel` throws for those pairs.
- `LLM_DELAY_MS` — rate limit delay between calls (default 500ms)

Every chat client is built by `createChatModel()` in `server/src/services/llm.ts`: the tier getters, the backfill scripts in `scripts/migrations/`, and the eval harness. Do not construct `ChatOpenAI` elsewhere.

Before changing a tier's model or effort, run the model eval harness (`.context/model-eval.md`); it compares candidates against today's models on stored data without writing to the database.

### Prompts recalibrated for GPT-6 ship with the switch, not before

Prompts are shared by whichever model runs them. For the GPT-6 migration the rating prompts were recalibrated so gpt-6-luna's 1-10 ratings line up with the stored archive (Luna rated about 0.6 lower than gpt-5-mini on the old wording):
- **Pre-assessment** (`prompts/preassess.ts`): the 5-6 anchor also covers broad change in the important systems of a single country or region; the model rates the development or risk rather than the article's format, counts people exposed to a risk it changes, and, since this rating is only a screen, takes the higher of two adjacent levels. A closing line keeps the issue choice independent of the rating.
- **Full assessment** (`prompts/assess.ts`): the base rating is the best-matching level of the issue's criteria, generic limiting factors apply only where they clearly fit and in proportion, and "final rating" replaces "conservative rating". The marketing blurb asks for 25-30 words, never over 230 characters.
- **Dedup** (`prompts/dedup.ts`): different developments of one ongoing story are not duplicates.

These changes are tuned for Luna and would shift gpt-5-mini and gpt-5-nano: on the new wording gpt-5-mini's full-assessment ratings rose by about 0.3 and 54% instead of 36% of the eval stories reached 5. So **they ship together with the phase-2 model switch, never ahead of it**: do not deploy them while production still runs gpt-5-mini/nano. The ≥5 gate and the per-issue `promptRatings` criteria (the scale readers see) are unchanged. Acceptance is checked with `eval:recalibrate` (`.context/model-eval.md`).

### GPT-6 and LangChain

`@langchain/openai` forwards its `reasoning: { effort }` option only for model IDs it recognises as reasoning models (`o*`, `gpt-5*`), and silently drops it for `gpt-6-*`. `createChatModel` therefore sends effort as `modelKwargs: { reasoning_effort }`, which reaches every Chat Completions request. Never set `temperature`, `topP` or `maxTokens` on these clients: GPT-6 rejects sampling parameters above effort `none`, and LangChain would send `max_tokens` for `gpt-6-*`. Never use `method: 'functionCalling'` or bound tools either: GPT-6 Chat Completions function calling works only at effort `none`. The default `withStructuredOutput` method (`response_format` json_schema) is fine.

## Prompts Directory

Prompt templates live in `server/src/prompts/`:

| File | Contents |
|------|----------|
| `shared.ts` | `Guidelines` interface, `buildGuidelinesXml()`, `escapeXml()`, `containsChineseCharacters()` |
| `preassess.ts` | `buildPreassessPrompt()` — batch screening + issue classification |
| `reclassify.ts` | `buildReclassifyPrompt()` — issue + emotion reclassification (no rating) |
| `assess.ts` | `buildAssessPrompt()` — full analysis |
| `select.ts` | `buildSelectPrompt()` — editorial curation |
| `podcast.ts` | `buildPodcastPrompt()` — podcast script generation |
| `index.ts` | Barrel re-exports all builders and types |

## Schema-Driven Format Guidance

The Zod schemas in `server/src/schemas/llm.ts` use `.describe()` to tell the LLM how to format each field. Key format decisions:

- **Markdown output**: `factors`, `limitingFactors`, `relevanceCalculation`, and `relevanceSummary` use Markdown with bold labels (e.g., `**Factor name:** explanation`)
- **Plain text**: `summary`, `quote`, `relevanceTitle`, `marketingBlurb` remain plain text
- **Emotion tags**: The five emotion definitions are embedded in the schema description

## Shared Batch Classification

Both pre-assessment and reclassification use `runBatchClassification()` in `analysis.ts` — a generic helper that handles DB fetching, issue slug resolution, batching, semaphore-gated concurrent LLM calls, progress reporting, and DB transaction writes. Callers provide the LLM instance, schema, prompt builder, and an update function that determines which fields to write per story. The `fallbackToFeedIssue` option controls whether stories omitted from the LLM response get their `issueId` overwritten to the feed default (enabled for pre-assessment, disabled for reclassification to preserve existing assignments).

## Analysis Stages

### 0. Reclassification (Batch, Non-destructive)

Re-runs issue classification and emotion tagging without changing ratings or status. Uses the small model. Triggered manually via the admin bulk "Reclassify" action. Does not overwrite any fields for stories the LLM omits from its response.

**Zod schema**: `reclassifyResultSchema` — array of `{ articleId, issueSlug, emotionTag }`

**Use case**: Fix misclassified issues or update emotion tags after issue definitions change, without re-running the full pipeline.

### 1. Pre-assessment (Batch)

Screens multiple stories per LLM call (`config.preassess.batchSize`, 10 per batch). The caller cuts batches by count; `formatArticlesBlock()` renders every story it receives, so nothing is dropped between batching and the prompt. In a single call, the LLM classifies each story into the most relevant issue, assigns a relevance rating (1-10) on the generic impact scale, and assigns an emotion tag. Uses the medium model with medium reasoning effort. All stories are batched together regardless of issue — pre-assessment uses only the generic rating scale (1-10 impact criteria), not issue-specific guidelines. Falls back to `story.feed.issueId` if the LLM returns an invalid issue slug.

**Zod schema**: `preAssessResultSchema` — array of `{ articleId, issueSlug, rating, emotionTag }`

**Threshold**: Only stories rated >= `config.assess.fullAssessmentThreshold` (5) proceed to full assessment; an issue's `minPreRating` overrides it for that issue.

**Precedence**: Downstream code (assessStory, podcast, RSS feeds) uses `story.issue ?? story.feed.issue`.

### 2. Full Assessment (Individual)

Detailed analysis of a single story. Produces structured fields covering relevance factors, limiting factors, ratings, summary, title, and marketing blurb. Uses the medium tier (`config.assess.modelTier`).

**Zod schema**: `assessResultSchema` — the largest schema, with detailed `.describe()` annotations guiding Markdown format for analytical fields.

### 3. Selection (Batch)

Takes all recently analyzed stories, formats them as XML with their AI metadata, and asks the LLM to select the top 50% by comparing articles directly. Uses the large model (important final curation step) with medium reasoning effort.

**Zod schema**: `selectResultSchema` — `{ selectedIds: string[] }`

## Issue-Specific Guidelines

Each Issue (topic category) has three prompt sections stored in the database:
- `promptFactors` — relevance factors specific to this topic
- `promptAntifactors` — topic-specific limiting factors
- `promptRatings` — rating criteria (1-10 scale definitions)

These are injected into prompt templates as `<FACTORS>`, `<TOPIC-SPECIFIC LIMITING FACTORS>`, and `<CRITERIA>` XML sections. They are used only in full assessment (stage 2), not in pre-assessment.

## Modifying Prompts or Output Format

To change prompts: edit the relevant file in `server/src/prompts/`. To change output format: update both the prompt AND the Zod schema in `server/src/schemas/llm.ts`. The schema `.describe()` annotations directly affect LLM output format.

See `.context/prompting.md` for GPT-5 prompt design principles that must be followed when modifying prompts.

## Key Files

| File | Role |
|------|------|
| `server/src/config.ts` | Centralized config: model names, reasoning effort (`parseEffort`), rate limits, batch sizes |
| `server/src/services/llm.ts` | LLM client: `createChatModel()`, `getSmallLLM()`, `getMediumLLM()`, `getLargeLLM()`, rate limiting |
| `server/src/prompts/` | Prompt builders (shared, preassess, assess, select, podcast) |
| `server/src/services/analysis.ts` | Orchestration: runBatchClassification, preAssessStories, reclassifyStories, assessStory, selectStories |
| `server/src/schemas/llm.ts` | Zod schemas with `.describe()` format guidance for all LLM output |
