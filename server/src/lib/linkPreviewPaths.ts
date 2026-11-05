/**
 * Where the site's dynamic pages get their link-preview tags (.context/seo.md, "Link previews"). The
 * backend serves `/<section>/…` of the site at `/api/page/<section>/…` (`routes/public/pagePreview.ts`)
 * for each section here; the static site's rewrite `/<section>/*` in render.yaml sends it there, and
 * `blueprint.test.ts` holds render.yaml to this list. Story pages keep their own, older rewrite to
 * `/api/story-page/*`, which the same code serves.
 */
export const PAGE_PREVIEW_MOUNT = '/api/page'

export const PREVIEWED_SECTIONS = ['stories', 'newsletter', 'podcast', 'issues'] as const

export type PreviewedSection = (typeof PREVIEWED_SECTIONS)[number]

/**
 * Where the section preview images are served (`routes/public/sectionImages.ts`): `newsletter.png`,
 * `podcast.png` and `issues/<topic slug>.png`, on the API's public origin.
 */
export const SECTION_IMAGE_MOUNT = '/api/section-images'
