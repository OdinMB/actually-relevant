/**
 * What makes an overview public (`.context/overviews.md`, "Public"), in each form a reader of it
 * needs: its scope is `ongoing`, it is not hidden, and it has its slug (`isPublicOverview` in code, the
 * Prisma filter `PUBLIC_OVERVIEW`, the SQL condition `publicOverviewSql`); a db test holds the three to
 * one answer. The entries readers see are one filter too (`SHOWN_ENTRY`). Nothing is public while the
 * step is off (`overviewStepOn`), which the readers ask first.
 */
import { Prisma } from '@prisma/client'

export { isPublicOverview } from './overviewTypes.js'

/** An overview readers may see, once the step is on. */
export const PUBLIC_OVERVIEW = { scope: 'ongoing', hidden: false, slug: { not: null } } satisfies Prisma.OverviewWhereInput

/** `PUBLIC_OVERVIEW` in SQL, over the overviews row named `alias`. */
export const publicOverviewSql = (alias: string): Prisma.Sql =>
  Prisma.sql`(${Prisma.raw(alias)}.scope = 'ongoing' AND NOT ${Prisma.raw(alias)}.hidden AND ${Prisma.raw(alias)}.slug IS NOT NULL)`

/**
 * Active entries of published stories with a page (a slug and a publication date): the ones readers
 * see. The page's timeline, the index's and the sitemap's counts and "public" itself all read this one
 * filter, so a count never names a story the page leaves out.
 */
export const SHOWN_ENTRY = {
  status: 'active',
  story: { status: 'published', slug: { not: null }, datePublished: { not: null } },
} satisfies Prisma.OverviewEntryWhereInput
