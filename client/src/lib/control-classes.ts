/*
 * Class strings for controls that several components share (.context/accessibility.md).
 */

/**
 * A link, or a button that reads as one, inside a sentence: brand color and underlined (1.4.1).
 * Keyboard focus shows only the brand ring: `focus-visible:outline-none` drops the browser's own
 * outline, which would draw beside it. Tailwind's `outline-none` is a transparent outline, so
 * forced-colors mode still shows one.
 */
export const TEXT_LINK =
  'text-brand-700 underline hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/**
 * An icon-only action in a row of them (the story page's bookmark and share buttons): a box
 * centered on the icon, 44x44 on phones for a comfortable tap and 24x24 from `md` up (WCAG 2.5.8).
 */
export const ROW_ICON_TARGET = 'inline-flex items-center justify-center min-w-11 min-h-11 md:min-w-6 md:min-h-6'
