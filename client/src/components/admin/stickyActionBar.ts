/**
 * A page's action bar (the podcast episode's, the story editor's Save and Cancel): at the end of the
 * page in flow, stuck to the bottom of the admin's view, so it never covers content. `<main>`
 * scrolls and has padding, so a sticky `bottom-0` would stop at its padding edge and let content
 * scroll through the strip below; the negative offsets and margins pin it to the edges. It sits
 * below the toasts (z-10 against z-50). `.context/admin-dashboard.md`, "Sticky bars".
 */
export const STICKY_ACTION_BAR =
  'sticky -bottom-4 z-10 -mx-4 -mb-4 mt-8 border-t border-neutral-200 bg-white/95 px-4 py-2 backdrop-blur lg:-bottom-6 lg:-mx-6 lg:-mb-6 lg:px-6'
