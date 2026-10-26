# UI Conventions

Standards and patterns for building public and admin pages.

## SEO Checklist

Each page should:

- [ ] Use Helmet with title, description
- [ ] Have unique, descriptive title
- [ ] Have unique meta description (150-160 chars)
- [ ] Be listed in `shared/routes.json` for prerendering and the sitemap (`.context/seo.md`)
- [ ] Render JSON-LD through `<StructuredData>` or, inside Helmet, `toJsonLd()` (`client/src/lib/structured-data.ts`), never plain `JSON.stringify`: story and episode text comes from crawled pages, and an unescaped `</script>` would break out of the element in prerendered HTML
- [ ] No hardcoded counts (source count, story count, language count) -- use `useSources()` hook or omit. These values change as feeds are added/removed.

## CSS Utility Classes

Defined in `client/src/index.css`:

**Layout:**

- `.page-section` -- Standard page wrapper (max-w-3xl, responsive padding)
- `.page-section-wide` -- Wider page wrapper (max-w-4xl)

**Typography:**

- `.page-title` -- Page headings (text-4xl/5xl, bold, centered)
- `.page-intro` -- Subtitle text below page title
- `.prose` -- Body text container (text-neutral-600, relaxed leading, auto-styled links)
- `.section-heading` -- Section headings (text-2xl)
- `.section-heading-lg` -- Larger section headings (text-3xl)

## Public URLs

The site URL and the Ko-fi, Bluesky, Mastodon and GitHub addresses are constants in `client/src/config.ts` (`SITE_URL`, `KOFI_URL`, `BLUESKY_PROFILE_URL`, `MASTODON_PROFILE_URL`, `GITHUB_REPO_URL`); `SEO.siteUrl` is `SITE_URL`. Import them rather than writing an address inline. `index.html` and the build scripts in `client/scripts/` cannot import them and keep their own copies, as does the server's newsletter email template (`config.links` in `server/src/config.ts`).

## Bundle Splitting

The client uses `React.lazy()` to split code and reduce initial bundle size. Homepage visitors only download homepage code; other pages load on demand.

**Rules:**

- **HomePage** (`client/src/pages/HomePage.tsx`): Static import in `App.tsx` -- this is the critical landing page
- **Other public pages** (`client/src/pages/*.tsx`): Use **`React.lazy()`** in `App.tsx`, wrapped in `LazyPage` -- prerendering waits for the chunk because the route fallback carries `routeFallbackProps` (`client/src/lib/renderComplete.ts`). A new route-level Suspense fallback must spread them too, or a slow chunk ships the spinner as the page's static HTML.
- **Admin pages** (`client/src/pages/admin/*.tsx`): Use **`React.lazy()`** in `App.tsx`. Must use `export default` (not named exports).
- **Admin-only npm packages** (`@headlessui/react`, `@heroicons/react`): Automatically code-split via lazy loading.
- **Error boundary:** `ChunkErrorBoundary` and `LazyPage` wrapper handle chunk load failures with reload button. Without a `fallback` prop the boundary takes over the screen with a full-page "Failed to load page" and its own h1, which is right for a whole route; a boundary around a widget inside a page passes `fallback` with an inline message, so a failed widget leaves the page's own h1 and content in place.
- **Preloading:** `LoginPage` calls `preloadAdminChunks()` on mount.
- **Heavy widgets inside a public page** get their own `React.lazy()` chunk inside the page, with a skeleton fallback. The prerenderer snapshots once no route fallback is showing (checked from 100ms after start, at most 5s; `signalRenderComplete` in `lib/renderComplete.ts`). It does not wait for the page's own data or nested Suspense, and a page chunk that bundles a multi-MB library delays every snapshot or, past 5s, is captured as a spinner. Mount the lazy widget only after the page's first commit (a `useEffect`-set flag, plain skeleton until then): if it suspends in the page's first render, React throttles revealing the nested fallback and the snapshot still shows the route spinner. Wrap it in a `ChunkErrorBoundary` with an inline `fallback`. Example: `DevelopersPage` lazy-loads `components/developers/ApiReference.tsx` (Scalar); if that chunk fails, the reference's spot says so (`role="alert"`) with a reload button and a link to the raw OpenAPI spec (`OPENAPI_SPEC_URL` in `lib/api.ts`), and the rest of the page stays.

## Route Error Page

Whatever a route throws, during render or loading, that no `ChunkErrorBoundary` catches first (those wrap every lazy page and the admin, so this means the homepage, the public layout's header and footer, and the not-found page) lands on the root route's `errorElement`, `RouteErrorPage` (`client/src/pages/RouteErrorPage.tsx`), instead of React Router's default "Unexpected Application Error" screen. Its rules:

- **Standalone**: logo, one h1 "Something went wrong", one sentence, a "Reload page" button and a "Go to the homepage" link. No site header or footer, since the layout may be what failed. The link is a plain `<a href="/">`, a full page load that also drops whatever in-memory state failed.
- **No error text** is ever shown to readers; the title is "Something Went Wrong" and the page is `noindex`.
- **Focus** moves to the h1 (`tabIndex={-1}`) when it appears, so a screen reader announces it.
- **Logging**: `main.tsx` passes `logRouteError` to `RouterProvider` as `onError`, which logs each route error once with `console.error` and its route pattern (`Route error on /stories/:slug:`), replacing React Router's own console line. No error leaves the browser.

## Accessibility (WCAG 2.2 AA)

See `.context/accessibility.md` for full WCAG patterns, ARIA, and testing checklist.

**Common requirements:**

- **Links/buttons**: `focus-visible:ring-2 focus-visible:ring-brand-500`
- **Link color**: Use `text-brand-700` (not brand-600) for AA contrast
- **Images**: Always include `alt` text (use `alt=""` for decorative)
- **Forms**: Every input needs a `<label>` with matching `htmlFor`/`id`
- **Touch targets**: Minimum 24x24px

## Spelling & Language

All hardcoded static text (UI labels, headings, descriptions, error messages, tooltips, meta tags) must use **American English** spelling. Examples: "analyzed" (not "analysed"), "color" (not "colour"), "organize" (not "organise"). Proper nouns that use British spelling (e.g. organization names like "Centre for...") are exempt.

Use em dashes sparingly in user-facing copy. One per paragraph at most. Overuse is a tell for AI-generated text. Prefer commas, periods, or rewriting the sentence instead.
