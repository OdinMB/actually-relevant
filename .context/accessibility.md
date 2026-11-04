# Accessibility Standards (WCAG 2.2 AA)

This site targets WCAG 2.2 Level AA compliance.

## Quick Reference

### Interactive Elements

**Buttons and Links**
- All buttons need descriptive text or `aria-label`
- Links should describe their destination (avoid "click here")
- Focus styles: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`. Without `focus-visible:outline-none`, Chrome draws its own black outline beside the ring. Controls take `FOCUS_RING` from `client/src/lib/control-classes.ts`: story cards, bookmarks, pagination, checkboxes and sliders, the news-mix slider, the header, mobile menu, search panel, skip link and footer, and the links on the story, search, topic and topics pages. The issue tabs and `.prose a` get the same classes through `@apply` in `client/src/index.css`. A filled button adds `focus-visible:ring-offset-2`, since the ring on the fill is under 3:1. Other older public controls (the home, about, methodology, podcast and newsletter-issue pages, the info pages, dialogs, toasts, banners, share buttons and forms) still spell the string without `focus-visible:outline-none`; move them to `FOCUS_RING` when touched. `client/src/test/focusColors.test.ts` fails on a brand-100 to -400 focus color in public code, and `PublicLayout.test.tsx` fails on a control in the skip link, header or footer without `FOCUS_RING`'s classes
- Hover-revealed controls (the card bookmark) also appear on focus: `focus-visible:opacity-100 group-focus-within:opacity-100`
- A link or link-styled button inside a sentence takes `TEXT_LINK` from `client/src/lib/control-classes.ts` (the cross-links, "Report an error", "How it works") rather than a copy of the string
- Touch targets: minimum 24x24px (use padding if visual element is smaller); see Target size below

**Target size (2.5.8)**
- Every link and button is at least 24x24px. Grow the hit area with padding or `min-h-*`/`min-w-*`, not bigger text.
- `min-h-*` needs a box: give the link `inline-flex items-center` (or `block`/`flex`). An inline `<a>` ignores min-height, and vertical padding on it overlaps the lines around it instead of making room.
- A list of links: drop the row gap and any fixed row height (`auto-rows-[…]`), and let each row take its link's height, so the space between two lines of text belongs to a link and the spacing looks unchanged. A fixed row lets a label that wraps overflow into the next link, and two hit areas then overlap. Phones get more where the layout allows (the footer: 32px below `md`, 28px from `md` up).
- Icon-only actions get 44x44px on phones (below `md`), a comfortable thumb target; 24x24px from `md` up. In a row of them (the story page's bookmark and share buttons) that is a real box, `ROW_ICON_TARGET` in `client/src/lib/control-classes.ts`, and the row takes a line of its own on phones. An icon that sits beside other content and must not move (a story card's bookmark) keeps its box and grows an invisible `::after` (`relative max-md:after:absolute max-md:after:-inset…`) into the card's padding, reaching toward the neighboring link no further than the gap between them, so two hit areas never overlap (`BookmarkButton.tsx`, "corner").
- WCAG exempts a link inside running text, and an undersized target whose 24px circle (centered on it) meets no other target or circle. Don't build new UI on the spacing exception: it fails silently the next time a gap is tightened.
- jsdom can't measure, so a test checks the classes instead: `SiteFooter.test.tsx` fails when a footer link is inline or under 24px at any breakpoint; `ShareButtons.test.tsx`, `BookmarkButton.test.tsx` and `StoryCard.test.tsx` check the 44px phone targets with the readers in `client/src/test/classes.ts`.

**Forms**
- Every input needs a `<label>` with `htmlFor` matching the input's `id`
- Group related inputs with `<fieldset>` and `<legend>`
- Error messages should be associated with inputs via `aria-describedby`
- Text fields and selects take `FIELD_FOCUS` (brand-500 border and 2px ring on `focus:`) and a resting `border-neutral-500` or darker (4.7:1 on white, 4.5:1 on neutral-50); checkboxes and sliders take `FOCUS_RING`. Tests: `fieldFocusProblems`, `fieldBorderProblems`, `focusRingProblems` (`client/src/test/classes.ts`)

**Expandable Content (Accordions, Menus)**
```tsx
<button
  aria-expanded={isOpen}
  aria-controls="content-id"
>
  Toggle
</button>
<div id="content-id" hidden={!isOpen}>
  Content here
</div>
```

### Images

**Meaningful Images**
```tsx
<img src="..." alt="Descriptive text explaining the image content" />
```

**Decorative Images**
```tsx
<img src="..." alt="" />
```

**Icons and Emojis**
```tsx
// Decorative - hide from screen readers
<span aria-hidden="true">...</span>
<svg aria-hidden="true">...</svg>

// Meaningful - provide label
<svg aria-label="Settings" role="img">...</svg>
```

### Text and Color

**Color Contrast**
- Normal text: 4.5:1 minimum (use `text-brand-700` for links, not brand-600)
- Grey text on white: `text-neutral-500` (4.7:1) is the lightest that passes; `text-neutral-400` (2.5:1) fails at any size, so never use it for text. On a dark background (the footer) the light greys are fine
- Placeholder text: one rule in `index.css` (`input::placeholder, textarea::placeholder`) sets `neutral-500` for every field, 4.5:1 on the public forms' `bg-neutral-50` and 4.7:1 on white; don't override it with a `placeholder:` class
- Large text (18pt+ or 14pt+ bold): 3:1 minimum
- UI components: 3:1 minimum, icons that are a control or name a field included (the search toggle, the search field's icon): `text-neutral-500` or darker, as for text
- Text in a category hue uses `getCategoryColor(slug).textHex` (the 700 shade, at least 4.5:1 on white) at full opacity, never `hex` (the 400 shade, 1.7:1 to 3:1) or the 500 `dot` shade. The topics page's "View stories" links use it, and their hover underlines rather than fades, since a fade drops below 4.5:1. The story page's analysis numbers use it too ("Caveats" a quarter darker, `shiftHex(textHex, -0.25)`); they are 24px bold, large text, so their bar is 3:1 and the 700 shade clears it with room. Tests: `IssuesPage.test.tsx`, `StoryPage.test.tsx`

**Don't Rely on Color Alone**
- A link inside running text is underlined (`underline`, as in `CrossLinks.tsx` and `.prose a`): `text-brand-700` against the grey body text is under 3:1, so color alone does not mark it (1.4.1). A link that stands on its own line, such as a title in a list or a "back" link, needs no underline
- Add text labels, icons, or patterns alongside color indicators
- Example: Error states should have text, not just red color

### Navigation

**Skip Link** (implement in PublicLayout)
```tsx
<a href="#main-content" className="sr-only focus:not-sr-only ...">
  Skip to main content
</a>
```

**Landmark Regions**
- Use `<header>`, `<main>`, `<footer>`, `<nav>`, `<section>`
- Add `aria-label` when multiple of same landmark exist:
  ```tsx
  <nav aria-label="Main navigation">...</nav>
  <nav aria-label="Footer navigation">...</nav>
  ```

### Semantic HTML

**Headings**
- One `<h1>` per page
- Don't skip levels (h1 -> h2 -> h3, not h1 -> h3)
- Use headings for structure, not styling

**Lists**
- Use `<ul>` or `<ol>` for lists of items
- Use `<dl>` for key-value pairs

## Testing Checklist

Before deploying new pages/components:

1. **Keyboard test**: Tab through entire page, verify all interactive elements are reachable
2. **Focus visible**: Can you see where focus is at all times?
3. **Screen reader**: Test with NVDA (Windows) or VoiceOver (Mac)
4. **Zoom test**: Site usable at 200% browser zoom
5. **Automated**: Run axe DevTools browser extension

## Common Patterns in This Codebase

| Pattern | Location | Notes |
|---------|----------|-------|
| Skip link | `PublicLayout.tsx` | The first tab stop, to `#main-content`, with `FOCUS_RING` |
| Story filters | `StoryFilters.tsx` | To be implemented — use fieldset/legend |
| Admin frame | `AdminLayout.tsx` | All text inside a landmark (axe "region"): desktop sidebar in `<aside>` with a labelled `<nav>`, mobile top bar a `<header>`, content in `<main>` |
| Story list | `StoryList.tsx` | To be implemented — use semantic table or list |
| Focus styles | All interactive elements | `FOCUS_RING` (`control-classes.ts`); see Buttons and Links above |
| Page changes | `RouteAnnouncer.tsx` (root layout), `lib/pageSettled.ts`, `lib/focusTarget.ts`, `hooks/useAnnouncement.ts` | On an in-app change of path (not the first load or a redirect while it loads, not a query-string or hash change, not /admin), focus moves to the section the link's `#hash` names when it is on the page (scrolled into view), else to `<main>` (no scroll). A hash section that comes with the page's data takes focus once the page has loaded, unless the reader has moved focus. A target that is not a control gets tabindex -1 until blur, removed at once if focus does not take (a modal is open). `document.title` is read into a polite `role="status"` once no route fallback shows and no query fetches (at most 5 s). The status empties 5 s later, and at once on a change to /admin. A page without `<main>` gets the announcement but no focus move; the developers page has none until its Scalar reference renders one. Tests: `RouteAnnouncer.test.tsx` (hash target and late hash target, a cluster redirect after a click announces only the final page, page without main, /admin clears), `focusTarget.test.ts`, `useAnnouncement.test.ts`, `pageSettled.test.ts`, `App.test.tsx` |
| List pages | `hooks/usePageTurn.ts`; `SearchPage.tsx`, `IssuePage.tsx`, `NewsletterPage.tsx` ("Past issues") | Choosing a page in `Pagination` moves focus to the list's heading (tabindex -1 until blur, `focus:outline-none`, no scroll from focus; the page scrolls itself, to the top or to "Past issues"). Once that page's own items show (not a skeleton, a failure or the previous page kept as placeholder), "Page N of M" is read into an always-present polite `role="status"`, which empties 5 s later. Tests: `SearchPage.test.tsx`, `IssuePage.test.tsx`, `NewsletterPage.test.tsx` |
| Story metadata | `StoryPage.tsx` (`META_TEXT_ROW`, `PHONE_SEPARATOR`) | The "\|" between the date, source, "Original article" and the AI label is visual only. From `md` up it is an `aria-hidden` span. Below `md` it is a `::before` with alt text `''` in the gap before each item, inside a row that clips its sides (`overflow-x-clip`, 4px of room each side for focus rings), so no line a wrap starts begins with "\|". From `md` up the row is `display: contents` and lays out as before. Test: `StoryPage.test.tsx` (classes; jsdom cannot lay out) |
| Human check (Turnstile) | `SubscribeForm.tsx`, `FeedbackForm.tsx` | Widget is invisible unless Cloudflare needs the visitor to interact, so it adds no tab stop; the submit button's text says "Verifying..." while it runs; a failure is text with `role="alert"` (in `FeedbackForm` also linked to the button by `aria-describedby`) and the form stays usable. Covered by axe in `FeedbackForm.test.tsx` |
| Load failure | `LoadFailure.tsx` | A page's data failed to load: heading and line in a `role="alert"`, announced without moving focus; "Try again" keeps its focus while it runs ("Trying again...") and after a failed retry, which is announced again. Rules: `.context/ui-conventions.md`, "Load failures". Covered by axe in `LoadFailure.test.tsx` |
| Public dialogs | `ModalDialog.tsx`, `useModalDialog.ts` | Native `<dialog>` opened with `showModal()` (focus moves in and stays); Escape, a backdrop click and the Close button ask the parent to close; focus goes back to the opener. Named by its `title` (`aria-label`), not by the form's heading, which a thank-you or notice replaces. `MobileMenu` uses the hook only. Test: `ModalDialog.test.tsx` |
| Signup success | `SubscribeForm.tsx`, `SubscribedPage.tsx` | "Check your email" (after Subscribe, on `/newsletter` and in the dialog) and "Welcome to the newsletter!" (after "Confirm my subscription") replace the button that had focus, so focus moves to their heading (`tabIndex={-1}`, `focus:outline-none`, as on `RouteErrorPage`) and a screen reader announces it; in the dialog it stays inside. Loading `/subscribed` moves no focus. Tests: `SubscribeForm.test.tsx`, `SubscribeModal.test.tsx`, `SubscribedPage.test.tsx` |
| Footer tap targets | `SiteFooter.tsx` | List links at least 32px tall on phones, 28px from `md` up (`LINK_TARGET`), in rows without gap that grow when a label wraps; legal links 32px / 24px; icon links 32x32px. Test: `SiteFooter.test.tsx` |
| Story actions | `StoryPage.tsx`, `ShareButtons.tsx`, `BookmarkButton.tsx` | Bookmark and share icons 44x44px on phones on a line of their own (first icon level with the text above, no separator leading in), 24x24px inline from `md` up. "Copy link" reports through an always-present `role="status"` ("Copied!", or a short line when the browser can't copy), emptied before each result so a repeat is announced again, as on `/podcast`. Tests: `ShareButtons.test.tsx`, `StoryPage.test.tsx` |
| Card bookmark | `BookmarkButton.tsx` (placement "corner"), `StoryCard.tsx` | 24px box beside the title; below `md` an `::after` makes the hit area 44x44px without moving anything. Tests: `BookmarkButton.test.tsx`, `StoryCard.test.tsx` |

## Resources

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
