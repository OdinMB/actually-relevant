---
status: implemented
type: feature
complexity: complex
---

# Actually Uplifting edition, step 1: the site

Spec: `/mnt/project-files/positive-subbrand/2026-11-06_uplifting-edition-spec.md` ("How a reader is in Actually Uplifting", "How the design shifts"), look chosen by Odin 2026-11-06: `wordmark-variants/2026-11-06_a-pink-desktop.png` and `-phone.png`. Newsletter and podcast steps are not part of this plan.

## Problem

The Mood Dial's far end ("Only uplifting", positivity 100) already filters the site to uplifting stories, but nothing on the page says so. A reader who once chose it keeps it through localStorage and silently sees fewer sections. The owner wants that position to become a visible second edition, "Actually Uplifting", with its own wordmark, a cue row with a way back, and a landing page at `/uplifting` that pitches and directory listings can link.

## Approach

The dial stays the only switch. "In the edition" means `positivity === 100`, nothing else. Three visible things follow from it, and one URL sets it.

**1. One predicate, in the dial's own module.** `PositivityContext.tsx` gains `UPLIFTING_MIX = 100`, `UPLIFTING_PATH = '/uplifting'` and a hook `useUpliftingEdition(): boolean` (`positivity === UPLIFTING_MIX`). BrandLogo, the new row and the landing page all read it, which is three call sites today, so the hook is justified. It lives with the dial because the spec defines the edition as a dial position. A separate "edition" context was rejected: it would be a second source of truth for one number.

**2. `/uplifting` sets the dial in the provider, not in the page.** `PositivityProvider` already turns `?mix=` into the dial value, both in its `useState` initializer and in its `[fromUrl]` effect. It now also treats the path `/uplifting` (and `/uplifting/`, which Render serves the same file at) as "mix 100". An explicit `?mix=` wins over the path. As with `?mix=uplifting`, the value is saved as the reader's preference (spec: "It puts the dial at the far end"). The alternative was the page calling `setPositivity(100)` in an effect. That was rejected because the first render, and so the prerendered HTML, would show the balanced homepage and the Actually Relevant logo. It would also write `?mix=uplifting` into the landing page's address. Doing it in the provider means the prerendered `/uplifting` HTML already carries the wordmark, the row and the intro.

- **Prerender guard (new behavior, needed by this change).** While `isPrerendering()` (`lib/renderComplete.ts`), the provider neither reads nor writes localStorage. Prerendering `/uplifting` would otherwise store 100 in the prerender browser and could bake the edition into every page snapshotted after it, if the prerenderer shares storage between routes (not verified, so the guard makes it irrelevant). Prerendered pages other than `/uplifting` therefore always start balanced, as they effectively do today.
- **Known lag, kept:** on an in-app link to `/uplifting` from a page at another position, the existing `[fromUrl]` effect flips the dial one render later, as it does for `?mix=` links today. This is not a CLS concern: the shift follows a click.

**3. Wordmark: an inline SVG inside BrandLogo, in the existing logo box.** At 100, `BrandLogo` renders a private `UpliftingWordmark` in place of the `<picture>`. Its markup:

- An `<svg viewBox="0 0 250 100">` (the current logo's 5:2) with the same classes as today's image, `h-14 md:h-16 aspect-[5/2]`, so the box is identical and swapping logos cannot move anything.
- The 'ar' mark is an SVG `<image>` of `logo-no-text`. Add an optimized variant with `npm run images:optimize-single --prefix client -- images/logo-no-text.png small-h`. It is 160px tall, enough for about 44px CSS at 3x.
- Two `<text>` lines in `font-nexa font-bold` (Nexa Bold is preloaded and documented for "logo text"): "actually" in `#333` and "uplifting" in `#ec268f` (brand-500). Size and position them against the mockups at 390px and 1280px.
- `role="img"` with `aria-label="Actually Uplifting"`, so the home link's name is "Actually Uplifting" plus the claim, as today it is "Actually Relevant" plus the claim.
- At every other position, BrandLogo is byte-for-byte as today.

Why not a raster asset: the logo type would have to be rendered into a PNG or WebP. `.context/seo.md` records that no licence on record covers drawing Nexa Bold into images, while web use of Nexa is already licensed. Why not HTML text: a box sized by text could change width when the font swaps. A fixed SVG viewBox scales identically at every breakpoint, keeps the glyphs inside the box when a fallback font is used, and needs no per-breakpoint tuning. "uplifting" in #ec268f on white is about 4.0:1. That is fine because WCAG 1.4.3 exempts logotypes, and the existing logo uses the same pink. SVG text is outside axe's color-contrast rule.

The home link keeps going to `/`. With the dial stored at 100, `/` is already the edition.

**4. The row: a new `UpliftingEditionRow` in `client/src/layouts/public/`.** SiteHeader renders it between the logo bar and `IssueNav`, so on phones it sits above the category color strip as in the mockup. It renders only when `useUpliftingEdition()` is true.

- **Look and text:** `bg-brand-50 border-b border-brand-100`, centered `text-sm` (14px). Text: `<strong className="text-brand-700">Only positive news from Actually Relevant.</strong>` then a "See all news" link styled with `TEXT_LINK` (underlined brand-700).
- **Width:** it fits one line at 390px, as the mockup shows. Below about 375px it may wrap onto two centered lines, which is deliberate: no `nowrap`, for reflow at 320px.
- **The link sets the dial to balanced (50) and keeps the other URL parameters**, through `withMix(searchParams, 50)`, as `MixHasNoStories` does:
  - On any page but the landing page it stays on the current path with `replace` and `preventScrollReset`, like the slider.
  - On `/uplifting` it goes to `/` with a push, since the reader is leaving the edition's page. RouteAnnouncer then handles focus.
- **Focus:** the link disappears with the row, so its click handler first moves focus to `<main>` with `focusWithoutTabStop(main, { preventScroll: true })` (`lib/focusTarget`), the way RouteAnnouncer does. Otherwise focus falls to `<body>` (WCAG 2.4.3).
- **Own file:** the row is a distinct responsibility (the edition cue and its exit). SiteHeader's job is composing the header and owning menu and search state, so the row's link logic does not belong in it.

**5. `/uplifting`: the homepage body behind an intro.**

- **HomePage split:** `HomePage.tsx` splits into `HomePage` (its Helmet plus the body) and an exported `HomeStories` component holding everything HomePage renders today below its Helmet. `HomeStories` takes a `heroHeading?: 'h1' | 'h2'` prop (default `'h1'`) that `HeroSection` uses for its headline element. Both stay in the same file, since they share one responsibility, the homepage feed. HomePage's output is unchanged.
- **New page:** `client/src/pages/UpliftingPage.tsx` is lazy-loaded through `LazyPage`, per the bundle rules. It renders:
  - its own Helmet: title, description, canonical, `og:title`, `og:description`, `og:type` website, `og:url`, and `CommonOgTags({})` with the default site image;
  - an intro block while the dial is at 100, holding the page's single `<h1>`, "Actually Uplifting", and the copy below;
  - `<HomeStories heroHeading="h2" />`, so the hero story's headline is an h2 and the page keeps one h1.
- **Dial moved off 100 on the page:** the intro disappears and `<HomeStories />` gets its default h1 hero, so the page always has exactly one h1 and never claims "only uplifting" over a balanced mix. The reader stays at `/uplifting?mix=…` with focus still on the slider.
  - Rejected alternative: redirect to `/`. RouteAnnouncer moves focus to `<main>` on any path change after the first navigation, so a keyboard reader arrowing the slider would lose the slider after one step.
- **Route registration:** `shared/routes.json` gets `{ "path": "/uplifting", "priority": 0.7, "changefreq": "daily" }`, an important landing page whose stories change daily. `App.tsx` gets the route, and `render.yaml` gets the page rewrite `/uplifting` → `/uplifting/index.html` (`server/src/blueprint.test.ts` prints the exact lines and position).
- **Server deploy:** the server sitemap reads `shared/routes.json` only at boot, and Render redeploys the server only for changes under `server/`. The change therefore includes a server test assertion (below) so both services redeploy (`.context/seo.md`, "Deploys").

**Draft copy (American English, no em dashes; Odin to confirm the intro's AI sentence, which the spec leaves to him):**

- `<title>` / og:title: "Actually Uplifting - Only Uplifting News from Actually Relevant"
- description / og:description, 150-160 characters; the implementer counts and trims: "Actually Uplifting: only the stories AI tagged uplifting from Actually Relevant's daily selection of news that matters to humanity. New ones as they arrive."
- Intro h1: "Actually Uplifting"
- Intro paragraph 1: "Only the uplifting stories from Actually Relevant's daily selection of news that matters to humanity. AI tags each story's tone; Actually Uplifting shows the ones tagged uplifting." The second sentence is the spec's draft wording.
- Intro paragraph 2: "Fewer stories make the cut, so this page changes more slowly. For the full picture, see all news." Here "see all news" links to `/?mix=balanced` (other parameters kept).

The intro is product description, not an AI label. It changes no wording in `aiDisclosureCopy.ts` or `aiLabelCopy.ts`, and every story on the page keeps its badge through `StoryCard`/`StoryTitleLabel`. The header AI line stays on every page at every position. The intro's AI sentence still describes AI selection, so it is recorded in `.context/ai-transparency.md` (below) and flagged for the owner.

**Strings:** `BRAND` in `client/src/config.ts` gets `upliftingEdition: 'Actually Uplifting'`, used for the wordmark's label, the intro h1 and the title. The row and intro sentences stay in their components, as other page copy does.

**Alternatives considered for the overall shape:**

- **Minimal:** a `?mix=uplifting` redirect from `/uplifting`. Rejected: the page needs its own title, canonical and prerendered HTML.
- **Separate edition context with its own storage:** rejected, as two sources of truth for one dial.
- **The chosen balance:** derive everything from the dial and extend the provider's existing URL rule to one path.

**Debt named, not taken on:** `HomePage.tsx` is a large file (hero, sections, layouts, quote dividers, the latest-issue slot). This change only lifts its body into an exported component with one prop and does not decompose the rest.

## Changes

| File | Change |
|------|--------|
| `client/src/contexts/PositivityContext.tsx` | Export `UPLIFTING_MIX`, `UPLIFTING_PATH`, `useUpliftingEdition()`. In `PositivityProvider`, `fromUrl` becomes `parseMixParam(mix) ?? (isUpliftingPath(pathname) ? 100 : null)` (private helper, trailing slash tolerated; pathname via `useLocation`). `readStored()` and the storage write skip while `isPrerendering()`. |
| `client/src/components/BrandLogo.tsx` | Read `useUpliftingEdition()`. Render a private `UpliftingWordmark` (inline SVG, `role="img"`, `aria-label={BRAND.upliftingEdition}`, same box classes) instead of the `<picture>` at 100. Update the doc comment. |
| `client/public/images/optimized/logo-no-text-small-h.webp` | New, generated by `images:optimize-single` from the existing `logo-no-text.png`. |
| `client/src/layouts/public/UpliftingEditionRow.tsx` | New. *Responsibility:* the edition's cue row under the logo bar and its "See all news" exit to the balanced mix. *Exports:* default `UpliftingEditionRow`. |
| `client/src/layouts/public/SiteHeader.tsx` | Render `<UpliftingEditionRow />` between the logo bar `div` and `IssueNav`. |
| `client/src/pages/HomePage.tsx` | Move the body below the Helmet into an exported `HomeStories({ heroHeading })`. `HeroSection` takes `heading: 'h1' \| 'h2'` for its headline element. `HomePage` renders Helmet + `<HomeStories />`, with output unchanged. |
| `client/src/pages/UpliftingPage.tsx` | New. *Responsibility:* the edition's landing page (head tags, intro, the homepage feed). *Exports:* default `UpliftingPage`. |
| `client/src/App.tsx` | `const UpliftingPage = lazy(...)`. Add a `<Route path="/uplifting">` in `LazyPage` inside the PublicLayout group. |
| `client/src/config.ts` | `BRAND.upliftingEdition = 'Actually Uplifting'`. |
| `shared/routes.json` | Add `/uplifting` (0.7, daily). |
| `render.yaml` | Page rewrite `/uplifting` → `/uplifting/index.html` where `blueprint.test.ts` says. |
| `server/src/routes/public/sitemap.test.ts` | Assert `/uplifting` is in the sitemap. This also gives the commit a server diff so the server redeploys and serves it. |
| `.context/public-website.md` | Routes table row for `/uplifting`. New "Actually Uplifting edition" subsection under Positivity Slider: edition = 100, the `/uplifting` path rule (mix wins), the prerender storage guard, wordmark (inline SVG, same box, logotype contrast exemption), the row and its link and focus rules, the landing page's behavior off 100. BrandLogo entry in Shared Components and the SiteHeader line in Key Files mention the row. |
| `.context/ai-transparency.md` | §2 row 2 destination: add "and its Actually Uplifting edition (`/uplifting`, the dial at 'Only uplifting')". §3 listings row: the header AI line stays in the edition, and the `/uplifting` intro says "AI tags each story's tone; Actually Uplifting shows the ones tagged uplifting." as product description, not a label, with no change to approved label wording. |
| `.context/seo.md` | One line under "Priority Guidelines" or "The static route list" only if `/uplifting`'s 0.7/daily needs explaining. Otherwise no change. |

## Tests

Following `PositivitySlider.test.tsx`, `HomePage.mix.test.tsx` (MemoryRouter, `LocationProbe`, mocked `publicApi`), `PublicLayout.test.tsx` and the axe checks the page tests use.

- **PositivityContext** (in `PositivitySlider.test.tsx` or a new `PositivityContext.test.tsx`):
  - `/uplifting` with stored 50 starts at 100 on the first render and stores 100;
  - `/uplifting/` the same;
  - `/uplifting?mix=balanced` starts at 50;
  - navigating from `/uplifting` to `/` keeps 100;
  - an in-app navigation from `/` at 50 to `/uplifting` ends at 100;
  - while prerendering (flag set), stored 100 is ignored (starts at 50) and nothing is written.
- **Header** (`PublicLayout.test.tsx`):
  - at `?mix=uplifting` the home link is named starting "Actually Uplifting", the row's text is present and the header AI line is still there;
  - at `?mix=mostly-uplifting` the home link is "Actually Relevant…" and there is no row;
  - "See all news" on `/search?q=x&mix=uplifting` leads to `/search?q=x&mix=balanced` (replace), removes the row, restores the logo and leaves focus on `<main>`;
  - on `/uplifting` it leads to `/?mix=balanced`.
- **UpliftingPage** (`UpliftingPage.test.tsx`, homepage data mocked with uplifting stories):
  - on arrival with stored 50: one h1 "Actually Uplifting", the hero headline is an h2, and only uplifting sections are shown;
  - Helmet title, canonical and og:url are `/uplifting`'s;
  - the intro link targets `/?mix=balanced`;
  - moving the dial to balanced hides the intro and the hero headline becomes the single h1;
  - axe passes.
- **HomePage:** the existing tests stay green (the hero headline is still the h1), with no new test.
- **Routes:** `client/src/routes.test.ts` checks `/uplifting` is prerendered and in the sitemap. `server/src/routes/public/sitemap.test.ts` checks it is in the XML. `blueprint.test.ts` holds the rewrite (existing test, no edit).
- **Manual, with Playwright** (the dev server is already running; clear `.playwright-mcp/` afterwards):
  - `/uplifting` and `/?mix=uplifting` at 390px and 1280px against the two mockups: wordmark size and placement, the row on one line at 390px, the AI line intact;
  - `/` at balanced looks unchanged;
  - with `ar-positivity=100` in localStorage, load a prerendered page (e.g. `/about`) and read the Layout Instability API for any shift from the logo swap or the row. `.context/public-website.md` records 0 for the Saved link's equivalent case.
- No tests for copy, the SVG geometry or the routes.json entry itself.

## Out of Scope

- Newsletter and podcast editions (spec steps 2 and 3), and the product-copy changes the spec ties to them: the homepage newsletter card ("Actually Uplifting, once a week") and the podcast card.
- An edition-specific share image or link-preview card for `/uplifting`. It uses the site default `og-image.png`.
- Any palette or accent change beyond the wordmark and the row. No change to story pages, AI labels and badges, issue areas or search (search keeps ignoring the dial).
- The spec's earlier "You're reading Actually Uplifting…" line wording, superseded by Odin's row wording.
- Making the home logo link to `/uplifting` inside the edition. `/` already shows the edition while the dial is at 100.
- Decomposing `HomePage.tsx` beyond lifting its body (debt named above).
- Pushing or deploying. After deploy, check that the `/uplifting` rewrite sits among the page rules in Render's Redirects/Rewrites tab (`.context/seo.md`).
