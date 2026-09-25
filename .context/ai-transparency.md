# AI transparency record (EU AI Act, Art. 50)

_Last assessed: 2026-09-25 · by: agent run (ai-act-disclosure skill, improvement mode) · skill facts verified: 2026-09-25 · next re-test: 2026-11-15_

> Not legal advice. This is an engineering record of how this project meets the AI Act's transparency duties. The latest full assessment is `DOCS/2026-09-25_ai-act-disclosure-assessment.md`, which is local and not versioned; its question and decision numbers (q1–q7, 5.1–5.8) are cited below.

**Keep this file true.** Update it in the same change that adds or alters an AI feature, a model id, a label, or an image or export pipeline. Hold current state only: delete finished open items and move their evidence into §3 or §4.

**Deployment state.** The measures dated 2026-09-25 are verified by unit tests in the repo only. They were not deployed in that run, and neither the runtime check (D3: first visit in a browser) nor the served files have been checked on the live site. Re-check both after the next deploy (§11).

## 1. Roles

| Item | Value | Evidence |
|---|---|---|
| Name on the system (F1) | Actually Relevant (actuallyrelevant.news). Story meta names "RelevanceAI by Actually Relevant". Operated by the owner as a natural person. | `client/src/pages/ImprintPage.tsx`; `client/src/pages/StoryPage.tsx` (Helmet meta) |
| Our role | Both: **provider** (pipeline built on the OpenAI API, put into service under the project name [G ¶¶10–11]; thin-wrapper application UNCONFIRMED) and **deployer** (publishes the output on the site, RSS, API, widget, newsletter and social accounts [G ¶15]) | assessment §2 |
| Partner and written role split (F6) | None today. A stewardship handover would move both roles to the new operator; write the split down at handover. | `client/src/pages/StewardshipPage.tsx` |
| Audience; minors or vulnerable users (F2) | Public, no login, general news audience in English; no age gate. Nothing is interactive. | `client/src/routes.ts` |
| Professional or personal (F3) | Treated as professional (conservative): § 5 DDG imprint, § 18(2) MStV editor, donations. Whether donations alone make it professional is open (brief §10 q4); no verdict depends on it. | assessment §2, C0 |
| Open source; hosted instance, and whether it runs today (F5) | AGPL-3.0; hosted on Render and live | `LICENSE`; `.context/deployment.md` |
| Code of Practice signatory | No | — |

Scope gates: not interactive, so Art. 50(1) is N/A (no chat or replies; search ranks stored stories). Ratings, selection, dedup, related stories, emotion tags and search are selection or classification, outside Art. 50(2) [G ¶¶65, 68]. Published AI text is public-interest news, so Art. 50(4) applies; the human-review exception is not available for the site, RSS, API, widget or social posts, because nothing is reviewed before publication (`server/src/jobs/publishStories.ts`).

## 2. AI features

Model ids are the code defaults in `server/src/config.ts` (`config.llm.models`). `OPENAI_MODEL_SMALL/MEDIUM/LARGE`, `OPENAI_EFFORT_*` and `EMBEDDING_MODEL` can override them in production; those values are ASK-OWNER (q5) and change no verdict while the vendor is OpenAI. All chat calls go through `createChatModel()` (`server/src/services/llm.ts`, LangChain `ChatOpenAI`). Tiers: small = gpt-6-luna (effort low), medium = gpt-6-luna (medium), large = gpt-6-sol (medium).

| # | Feature | Call site | Vendor · model id | Modality | Length | Mode | Destination | Human review | First public (F4) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Story analysis: headline, title label, summary, "Why This Matters", "Caveats", relevance summary, blurb, key quote (AI-selected, AI-translated if needed) with attribution | `server/src/services/analysis.ts` `assessStory`; `server/src/prompts/assess.ts` | OpenAI · gpt-6-luna (medium tier, `config.assess.modelTier`). One-off backfill scripts (`server/src/scripts/migrations/backfill-*.ts`) wrote some fields with other tiers. | text | **≥200 tokens** per story as rendered (about 280 words, live sample 2026-09-25) | background cron | story page; excerpts on homepage, cards, issue, search, saved, related; public JSON API; RSS; embed and widget; newsletter; social link cards; share prefill | none | 2026-01-30 |
| 2 | Pre-assessment rating, issue classification, emotion tag | `analysis.ts`; `prompts/preassess.ts`, `reclassify.ts`, `emotion-tag.ts` | gpt-6-luna (medium / small) | classification | enum / integer | background | filters, sections, the "Emotional weight" dial; raw values in the API | none | before 2026-08-02 |
| 3 | Selection for publication | `analysis.ts` `selectStories`; `prompts/select.ts` | gpt-6-sol (large) | ranking | ids only | background | decides what is published | none | before 2026-08-02 |
| 4 | Dedup, related-story rerank, semantic search | `services/dedup.ts`; `services/story.ts`; `services/embedding.ts` | gpt-6-luna (small); text-embedding-3-small | ranking | ids only | background; each visitor search | "Also covered by", "Related Stories", search results | none | before 2026-08-02 |
| 5 | Bluesky auto-post (story pick, hook, link card with AI headline and blurb) | `services/bluesky.ts`; `services/socialMedia.ts`; `jobs/socialAutoPost.ts` | gpt-6-luna (medium) | text | <200 tokens (300 graphemes) | background, twice daily | @actuallyrelevant.bsky.social | none on the auto path | 2026-02-10 |
| 6 | Mastodon auto-post | `services/mastodon.ts`; `prompts/mastodon.ts` | gpt-6-luna (medium) | text | <200 tokens (500 chars) | background | @actuallyrelevant@mastodon.social | none on the auto path | 2026-02-14 |
| 7 | Weekly newsletter: story selection, intro (<60 words), story texts from row 1 | `services/newsletter.ts`; `prompts/newsletter-intro.ts`; `jobs/generateNewsletter.ts` | gpt-6-sol (large) | text | each generation <200 tokens; about 300 AI words per email | Saturday cron builds and sends a "[TEST]" campaign; live send by admin click | Plunk email | send gate only; review not enforced (q1, q2) | 2026-01-29 |
| 8 | Podcast script for a TTS voice | `services/podcast.ts` (`getLargeLLM`); `prompts/podcast.ts` | gpt-6-sol (large) | text for audio | ≥200 tokens | admin-triggered | admin UI only; no TTS or public route in the repo | admin | code 2026-01-29; publication ASK-OWNER (q3) |
| 9 | Newsletter carousel: PNG slides and a PDF of AI headline and summary, zipped | `services/carousel.ts` | no image model; text from row 1 | AI text rendered into images and a PDF | about 80 words per slide | admin download | posted by hand; destination ASK-OWNER (q4) | admin | code 2026-01-29 |
| 10 | Share buttons prefill the AI blurb | `client/src/components/ShareButtons.tsx` | row 1 | text | <200 tokens | visitor-initiated | the visitor's own posts | the visitor | 2026-02-07 |

No AI-generated images, audio or video exist in the repo. The eval harness (`server/src/scripts/eval/`) is a developer tool, not a feature.

## 3. Duties and measures

Deadlines: labels (Art. 50(4)) and accessibility (50(5)) have applied since 2 Aug 2026. Marking (50(2)) is **due now** under the strict reading, because a self-run site is "put into service" rather than "placed on the market" and Art. 111(4) grants the grace period only to the latter; under G ¶153 it is due **2 Dec 2026** (brief §10 q2, open). The GPT-6 switch on 2026-09-24 may also count as a substantial modification (§10 q7).

| Feature | Duty | Measure | Implemented at | Verdict | Deadline | Last verified |
|---|---|---|---|---|---|---|
| Story page (1) | 50(4) label; 50(5) | Real-text "AI-generated" link in the metadata row under the `h1`, above the summary | `client/src/pages/StoryPage.tsx` | PASS (code evidence; D3 not run) | — | 2026-09-25 (code) |
| Listings: hero, cards, issue, search, saved, related, pull quotes (1) | 50(4) label; 50(5) first exposure | None visible yet. `AiBadge`, `AiLabel` and `SiteAiNotice` are built and unit-tested (ARIA and axe) but **not mounted**, pending the owner's copy review | `client/src/components/ai/` | **FAIL** | now | 2026-09-25 (unit tests) |
| Site-wide sign-off "Curated with care by AI." | 50(5) accessible | Readable by screen readers since 2026-09-25; only the ornament is `aria-hidden`. Sits below the content, so it is not the first-exposure notice. | `client/src/layouts/PublicLayout.tsx`; test `PublicLayout.test.tsx` | PASS for accessibility (the missing top notice is the listings FAIL above) | — | 2026-09-25 (unit test) |
| RSS feeds (1) | 50(4) label | None per item (RSS text is under copy review) | `server/src/routes/public/feed.ts` | **FAIL** | now | assessment 2026-09-25 |
| Public JSON API (1) | 50(4) label; 50(2) interim | Machine-readable `aiGenerated` block on every story object (`fields`, `model`, IPTC `digitalSourceType`); OpenAPI field descriptions name the AI-generated and AI-assigned fields. A request to republishers to label the text (`info.description`) waits for copy review. | `server/src/lib/aiProvenance.ts`; routes `stories.ts`, `homepage.ts`; `server/src/lib/openapi.ts` | **FAIL** (conservative) until the republisher note ships | now | 2026-09-25 (route tests) |
| Embed iframe and `widget.js` (1) | 50(4) label | None beyond "Powered by Actually Relevant" | `client/src/pages/EmbedPage.tsx`; `client/public/widget.js` | **FAIL** | now | assessment 2026-09-25 |
| Bluesky and Mastodon posts (5, 6) | 50(4) label; social pattern | None in the post text; AI mention only in the bios; no bot flags. The Bluesky link-card thumbnail now points at the real `/images/og-image.png` (a bug fix, not a label). | `server/src/services/bluesky.ts`, `mastodon.ts` | **FAIL** | now | assessment 2026-09-25 |
| Story analysis text (1) | 50(2) marking | No watermark: OpenAI text carries no provenance signal (V1). Interim, **not equivalent to the Code's watermark layer**: the API `aiGenerated` block and `data-ai-generated` attributes (API field names) on the story page's AI regions. Both are unsigned and are lost when text is copied; the data attributes also exist only where the page runs JavaScript (story routes are not prerendered). | `server/src/lib/aiProvenance.ts`; `client/src/pages/StoryPage.tsx`; test `StoryPage.test.tsx` | **UPSTREAM-GAP** (owner decision: wait for OpenAI, §5) | now (strict) / 2026-12-02 (G ¶153) | 2026-09-25 (unit tests) |
| Story analysis text (1) | 50(2) detection | None available for OpenAI text [OAI-PROV] | — | **UPSTREAM-GAP** | as above | 2026-09-25 |
| Newsletter (7) | 50(4) label or human-review exception | Notice only at the bottom ("Curated and written with care by AI") | `server/src/services/newsletter.ts` | ASK-OWNER (provisional FAIL) (q1, q2) | now | assessment 2026-09-25 |
| Podcast script (8) | 50(2); audible disclosure | Spoken AI notice depends on the prompt | `server/src/prompts/podcast.ts` | ASK-OWNER (provisional UPSTREAM-GAP) (q3) | now, if published | assessment 2026-09-25 |
| Carousel PNG and PDF (9) | 50(2) containerised; 50(4) on social | Unsigned XMP `Iptc4xmpExt:DigitalSourceType = trainedAlgorithmicMedia` in every PNG (`iTXt`) and in the PDF, plus PDF Info (Creator and Producer "Actually Relevant", Subject "AI-generated", Keywords). No user identity [G ¶94]. No pixel label (copy review). | `server/src/lib/xmp.ts`; `server/src/services/carousel.ts`; tests `xmp.test.ts`, `carousel.test.ts` | ASK-OWNER (provisional **FAIL (against the Code baseline)**: metadata is unsigned) (q4) | now, if used | 2026-09-25 (unit tests; a sample PDF's Info read back with pdftk) |
| All features | E1 documentation; E3 AI literacy; B9 no-removal | This record; §9; README "AI-generated content markings" note | `.context/ai-transparency.md`; `README.md` | done | — | 2026-09-25 |

## 4. Upstream reliance and test results

| Output | Vendor · model | Marking relied on | Detection available | Tested on | Method | Result |
|---|---|---|---|---|---|---|
| Story analysis text | OpenAI · gpt-6-luna | none exists (V1, re-check 2026-11-15) | none | — | — | UPSTREAM-GAP |
| API `aiGenerated` marker | own | own unsigned JSON field | read the field | 2026-09-25 | route tests for list, search, single, related and homepage; `analysis.test.ts` checks the field registry against what `assessStory` writes and `PUBLIC_STORY_SELECT` serves. Each guard was disabled once and its test went red. | pass (not yet on the live API) |
| Carousel PNG and PDF | own | own unsigned XMP and PDF Info | `exiftool -a -G1` | 2026-09-25 | `xmp.test.ts` (chunk order, CRC, decode), `carousel.test.ts`; sample files inspected (pdftk `dump_data`, XMP packet in the PNG); re-checked in review on a generated slide and PDF: every PNG chunk CRC matches zlib's CRC-32, the PNG decodes, and the PDF's uncompressed `/Type /Metadata` stream carries the DigitalSourceType next to PDFKit's own XMP | pass |

## 5. Text-marking feasibility assessment

- **What reaches people:** the story analysis (row 1), about 280 generated words per story on the story page, from OpenAI gpt-6-luna, free-form text of 200 tokens or more. The API and widget serve the same text; the newsletter is a composite of short generations. The podcast script (≥200 tokens, gpt-6-sol) counts only if it is published (q3).
- **Options considered** (fix-patterns §8; assessment 5.1):
  1. Move the `assess` tier to a model with an active text watermark (per [ANT] on 2026-09-25: Claude Fable 5.1, Mythos 5.1, Opus 5.5, Opus 5). Costs a higher per-call price than gpt-6-luna against today's spend of about $30–60/month (`StewardshipPage.tsx`), an Anthropic key, a second processor in the privacy notice and a DPA, and a prompt recalibration (the prompts were tuned for GPT-6 on 2026-09-24). Detection would be Anthropic's private-preview text detector (brief §10 q17).
  2. A third-party or post-hoc text watermark: legally envisaged [G ¶74; CoP 1.1.2], but no production-grade product for third-party model output was verified (UNCONFIRMED).
  3. This documented assessment and the gap analysis in §6: needed whatever is chosen, but documentation, not compliance.
  4. Wait for OpenAI: the goal is stated and tied to its Code commitments, with no date [OAI-HELP].
- **Chosen (owner, 2026-09-25): wait for OpenAI (option 4)**, with options 3 and the interim measures below. Never shorten, split or pad the analysis to get under 200 tokens.
- **Interim measures:** visible labels once the copy is approved (components ready, §7), plus the machine-readable markers in §3 (API `aiGenerated`, story-page `data-ai-generated`, carousel XMP). These are **not equivalent to the Code's watermark layer**: they are unsigned, removable, and do not survive copying, screenshots or paraphrase.
- **Feasibility is objective**, not measured by this project's resources [G ¶81]. Text watermarking is on the market from another vendor (option 1), which weakens an infeasibility argument; implementation cost may be taken into account [G ¶85]. Under the strict reading of Art. 111(4) the gap is open now; under G ¶153 it must close by 2 Dec 2026.
- **Monitoring:** on **2026-11-15**, re-check OpenAI text provenance (https://developers.openai.com/api/docs/guides/content-provenance, https://help.openai.com/en/articles/8912793-provenance-signals-content-credentials-synthid-in-openai-generated-content) and Anthropic's per-model coverage (V3). If OpenAI text is still unmarked, bring option 1 back to the owner with a measured cost (eval harness on the fixtures, `eval:recalibrate`; spending is the owner's call) so a decision lands before 2 Dec 2026.

## 6. Gap analysis against the Code of Practice

| Code measure | What it expects | What we do | Gap | Plan |
|---|---|---|---|---|
| S1 M1.1 multi-layer marking | Watermark for free-form text ≥200 tokens; signed, time-stamped metadata plus watermark for containerised content | Story analysis: no watermark. Unsigned JSON marker and HTML data attributes. Carousel: unsigned XMP only. | Watermark layer missing (upstream); no signed metadata | Wait for OpenAI, review 2026-11-15 (§5); signing tooling for PDF is UNCONFIRMED |
| S1 M1.2 non-removal | Preserve marks; prohibit removal (ToS or, for FOSS, docs); no circumvention tools | README note; no code strips the markers | Whether a README restriction sits well with AGPL-3.0 §7 is unchecked (open item) | Legal check (§11) |
| S1 M2.1 detection | Free detection, public where the public is exposed (expert-only allowed for text watermarks) | The JSON marker and XMP are readable by anyone; no detector for the text itself | Full, upstream | Follows M1.1 |
| S1 Commitment 3 robustness, interoperability | Robust to compression, screenshots, paraphrase; established metadata standards | IPTC DigitalSourceType vocabulary in JSON and XMP | Not robust: copying or re-encoding removes every mark | Only a watermark closes this |
| S1 Commitment 4 compliance process | Documented, tested, proportionate for SMEs | This record; guard tests over the live field registry; dated review | No check after deploy yet | Verify live after deploy (§11) |
| S2 M1.1–1.2 labels | "AI" main element, at first exposure, accessible | Story-page label; accessible site sign-off (below content); `AiBadge`/`AiLabel`/`SiteAiNotice` built with "AI" as the main element, unmounted | Listings, RSS, API note, widget, social, newsletter top | Owner copy review, then mount (§11) |
| S2 Commitment 2 labelling process | Internal documentation, label checks, correction of mislabelling | This record; component tests | No published correction invitation (feedback page exists, invitation copy pending, assessment 5.7) | Copy review |
| S2 Commitment 3 creative works | Non-hampering disclosure | — | N/A: news, not creative work | — |
| S2 Commitment 4 human review | Policy naming the editorially responsible person | Not relied on for site, RSS, API, widget or social | Newsletter open (q2) | Owner decision 5.3 |

## 7. Label policy and correction channel

- **Labels in use:** the story-page "AI-generated" link (`StoryPage.tsx`) and the site-wide sign-off "Curated with care by AI." (`client/src/config.ts` `BRAND.claimSupport`, rendered in `PublicLayout.tsx`, readable by screen readers). Built but **unmounted**: `AiBadge` (visible "AI", announced as "AI-generated"), `AiLabel` (badge plus text, announced once) and `SiteAiNotice` (a `role="note"` paragraph with a link to `/methodology`, no dismiss control) in `client/src/components/ai/`. Their wording is a DRAFT in `aiDisclosureCopy.ts`, taken from assessment 5.2.
- **Owner decision (2026-09-25):** all visible label copy is under the owner's separate review. Mount nothing and change no visible copy (RSS item text, social post text, bios, bot flags, page meta, OpenAPI `info.description`) until that review settles the wording.
- **Machine-readable markers:** API `aiGenerated` (`withAiGeneratedMarker()`, applied in the public routes; `.context/public-website.md`); `data-ai-generated="<API field names>"` on the story page's AI regions; carousel XMP (`server/src/lib/xmp.ts`). When a new model-written field is added to `assessStory` and the public select, add it to `AI_GENERATED_STORY_FIELDS`; `analysis.test.ts` fails until you do. The registry lists `quote` and `quoteAttribution` because the model writes (and may translate) them; this is more conservative than assessment B1, which treats the extracted quote as outside Art. 50(2), and it means a republisher may label a verbatim quote from a named person as AI-generated (open item, §11).
- **How labels are checked:** unit tests today; a first-visit browser check (D3) on each release once labels are mounted.
- **Correction channel:** the feedback page (`/feedback`). Substantiated mislabelling is fixed without undue delay. A visible invitation to report missing or wrong labels waits for copy review.

## 8. Human-review policy

Not applicable: the human-review exception is not relied on. The newsletter could rely on it only with a written review policy (assessment 5.3, q2).

## 9. AI literacy (Art. 4)

A solo operator (the project owner) runs every AI feature. Model behavior, limits and calibration are documented in `.context/llm-analysis.md`, `prompting.md` and `model-eval.md`, and model or prompt changes go through the eval harness before they ship.

## 10. Adjacent rules

| Item | Status | Where |
|---|---|---|
| Art. 5 safeguards for images of real people (from 2 Dec 2026) | N/A: no image generation or editing | — |
| Privacy notice names the AI vendors and the transfers | **Gap (GDPR, high):** visitor search queries go to OpenAI embeddings, and the notice does not say so; "nothing is stored on your device" is inaccurate (localStorage) | `client/src/pages/PrivacyPage.tsx`; assessment 5.5 |
| Imprint (§ 5 DDG / § 18 MStV) | Present, names the editorially responsible person | `client/src/pages/ImprintPage.tsx` |
| Vendor terms (OpenAI Sharing & Publication Policy) | Unlabelled social posts breach it; fixed by the social labels | assessment F-4 |
| § 18(3) MStV social bots | Not researched in the brief; have it checked | assessment 5.4 |
| Consumer law (B2C only) | N/A: no B2C contract | — |

## 11. Open items

| Item | Check | Who | Due |
|---|---|---|---|
| Re-check OpenAI text provenance and Anthropic coverage (V1, V3); decide whether to move the `assess` tier (§5) | B6, B8 | owner | 2026-11-15, decision before 2026-12-02 |
| **Visible copy** (one review): top-of-page notice and card, hero and pull-quote badges (mount `SiteAiNotice`, `AiBadge`); quote note; story-page label upgrade and EU "AI" icon (optional, asset not downloaded); RSS item prefix and channel descriptions; OpenAPI `info.description` republisher note; embed and widget header; newsletter top label or the human-review exception (5.3); social post suffix and bios; share prefill suffix; methodology correction and correction invitation (5.7); podcast fixed spoken first line and carousel pixel label (5.8). Recommended by the assessment: ship the top notice, card badge, RSS prefix and social "AI-generated" together. | C4, C7, D1 | owner | now |
| Bot flags: Mastodon `bot=true`; Bluesky `bot` self-label (5.4) | C7 pattern | owner (accounts) | — |
| Privacy notice: OpenAI as recipient of search queries, transfer basis, localStorage (5.5) | F-2 | owner | now |
| Machine-readable authorship for non-JS readers: shell `meta name="author"`/`article:author` name the owner personally; JSON-LD has no AI flag (5.6; page meta is under copy review) | consistency | owner | — |
| Is `PLUNK_TEST_SEGMENT_ID` set in production? If unset, the Saturday "[TEST]" issue goes to all subscribers (q1) | C3, C4 | owner | now |
| Is each newsletter read and fact-checked before the live send, with no regeneration after (q2)? | C3 | owner | now |
| Is the podcast voiced or published, with which TTS and where (q3)? | B5, B6, A6, C8 | owner | — |
| Are the carousel files still posted, and where (q4)? | B7, C7 | owner | — |
| Production values of `OPENAI_MODEL_*`, `OPENAI_EFFORT_*`, `EMBEDDING_MODEL`; is `OPENAI_BASE_URL` set (q5)? | record | owner | — |
| Do Ko-fi donations arrive regularly (q6, F3)? | F3 | owner | — |
| Stewardship handover planned; would the site keep its name and imprint (q7)? | F1, F6 | owner | at handover |
| Keep `quote`/`quoteAttribution` in `aiGenerated.fields`, or move them to a separate AI-selected list (§7; assessment B1 counts extraction as out of scope)? Also: `aiGenerated.model` is the model configured at serve time, not per story | B1 | owner | — |
| Does the README no-removal note sit well with AGPL-3.0 §7 (no further restrictions)? | B9 | Legal & Integrity | — |
| After the next deploy: confirm `aiGenerated` on the live API, a carousel export's XMP (`exiftool`), and the sign-off in a screen reader or the accessibility tree | E1, D2 | owner or agent | next deploy |
