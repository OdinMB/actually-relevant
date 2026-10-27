# Accessibility Standards (WCAG 2.2 AA)

This site targets WCAG 2.2 Level AA compliance.

## Quick Reference

### Interactive Elements

**Buttons and Links**
- All buttons need descriptive text or `aria-label`
- Links should describe their destination (avoid "click here")
- Focus styles: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`. Without `focus-visible:outline-none`, Chrome draws its own black outline beside the ring. A link or link-styled button inside a sentence takes `TEXT_LINK` from `client/src/lib/control-classes.ts` (the cross-links, "Report an error", "How it works") rather than a copy of the string
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
| Skip link | `PublicLayout.tsx` | To be implemented |
| Story filters | `StoryFilters.tsx` | To be implemented — use fieldset/legend |
| Admin frame | `AdminLayout.tsx` | All text inside a landmark (axe "region"): desktop sidebar in `<aside>` with a labelled `<nav>`, mobile top bar a `<header>`, content in `<main>` |
| Story list | `StoryList.tsx` | To be implemented — use semantic table or list |
| Focus styles | All interactive elements | `focus-visible:ring-2` |
| Human check (Turnstile) | `SubscribeForm.tsx`, `FeedbackForm.tsx` | Widget is invisible unless Cloudflare needs the visitor to interact, so it adds no tab stop; the submit button's text says "Verifying..." while it runs; a failure is text with `role="alert"` (in `FeedbackForm` also linked to the button by `aria-describedby`) and the form stays usable. Covered by axe in `FeedbackForm.test.tsx` |
| Load failure | `LoadFailure.tsx` | A page's data failed to load: heading and line in a `role="alert"`, announced without moving focus; "Try again" keeps its focus while it runs ("Trying again...") and after a failed retry, which is announced again. Rules: `.context/ui-conventions.md`, "Load failures". Covered by axe in `LoadFailure.test.tsx` |
| Footer tap targets | `SiteFooter.tsx` | List links at least 32px tall on phones, 28px from `md` up (`LINK_TARGET`), in rows without gap that grow when a label wraps; legal links 32px / 24px; icon links 32x32px. Test: `SiteFooter.test.tsx` |
| Story actions | `StoryPage.tsx`, `ShareButtons.tsx`, `BookmarkButton.tsx` | Bookmark and share icons 44x44px on phones on a line of their own (first icon level with the text above, no separator leading in), 24x24px inline from `md` up. "Copy link" reports through an always-present `role="status"` ("Copied!", or a short line when the browser can't copy), emptied before each result so a repeat is announced again, as on `/podcast`. Tests: `ShareButtons.test.tsx`, `StoryPage.test.tsx` |
| Card bookmark | `BookmarkButton.tsx` (placement "corner"), `StoryCard.tsx` | 24px box beside the title; below `md` an `::after` makes the hit area 44x44px without moving anything. Tests: `BookmarkButton.test.tsx`, `StoryCard.test.tsx` |

## Resources

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
