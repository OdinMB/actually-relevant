/**
 * Everything that differs between the newsletter's two editions (ADR-0052,
 * `.context/newsletter-podcast.md`, "Editions"): what an issue of each is called, its subject and slug
 * prefix, its Plunk campaign name, the email's masthead line and footer switch link, and the Plunk
 * audience its live send goes to. Which stories an issue carries is `upliftingIssue.ts` and
 * `newsletter.ts`; the lifecycle's moves read the rest from here.
 */
import type { NewsletterEdition, Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { config } from '../config.js'
import { anyoneOnUplifting } from './knownEditions.js'

/** The template variable Plunk fills with each recipient's contact id in a campaign body. */
export const PLUNK_CONTACT_ID_VARIABLE = '{{id}}'

export interface EditionCopy {
  /** What readers call the edition */
  name: string
  /** In front of the subject and the Plunk campaign name ('' for the full edition, as before the editions) */
  label: string
  /** In front of the slug of its issues' web editions ('' for the full edition) */
  slugPrefix: string
  /** The email's line under the logo, in brand pink, and the tagline under it; none for the full edition */
  masthead: { line: string; tagline: string } | null
  /** The footer link's wording, offering the other edition */
  switchText: string
}

const COPY: Record<NewsletterEdition, EditionCopy> = {
  full: { name: 'Actually Relevant', label: '', slugPrefix: '', masthead: null, switchText: 'Get Actually Uplifting instead' },
  uplifting: {
    name: 'Actually Uplifting',
    label: 'Actually Uplifting · ',
    slugPrefix: 'actually-uplifting-',
    masthead: { line: 'Actually Uplifting', tagline: 'Only positive news from Actually Relevant.' },
    switchText: 'Get the full picture instead',
  },
}

export function editionCopy(edition: NewsletterEdition): EditionCopy {
  return COPY[edition]
}

/** The other edition: what an issue's switch link offers. */
export function otherEdition(edition: NewsletterEdition): NewsletterEdition {
  return edition === 'full' ? 'uplifting' : 'full'
}

/**
 * An issue's title led by its edition's label, "Actually Uplifting · Week 45, 2026" (the full edition's
 * as it is): the Plunk campaign name of its sends, so complaint and bounce notices name the edition,
 * and its RSS item title.
 */
export function labeledTitle(edition: NewsletterEdition, title: string): string {
  return `${COPY[edition].label}${title}`
}

/**
 * The footer switch link of an issue of this edition: the page that switches a reader to the other
 * edition, with Plunk's per-recipient contact id, which Plunk fills in when it sends.
 */
export function switchLinkUrl(edition: NewsletterEdition): string {
  return `${config.siteUrl}/newsletter-edition?c=${PLUNK_CONTACT_ID_VARIABLE}&to=${otherEdition(edition)}`
}

/** Who a live send goes to, or why it may go to nobody. */
export type EditionAudience = { audienceType: 'ALL' } | { audienceType: 'SEGMENT'; segmentId: string } | { refused: string }

/**
 * The audience of a live send of this edition's issue.
 * - Editions open: each edition's own Plunk segment.
 * - Not open: the full edition goes to all subscribers, as before the editions, unless anyone got onto
 *   Actually Uplifting while they were open and is still on it as far as this server knows (a
 *   confirmed signup or a footer switch, the newer per contact; `knownEditions.ts`), who would get it
 *   too; then, and for Actually Uplifting itself, it goes to nobody.
 */
export async function editionAudience(edition: NewsletterEdition, db: Prisma.TransactionClient = prisma): Promise<EditionAudience> {
  if (config.newsletter.editionsOpen) {
    return { audienceType: 'SEGMENT', segmentId: edition === 'uplifting' ? config.plunk.upliftingSegmentId : config.plunk.fullEditionSegmentId }
  }
  if (edition === 'uplifting') {
    return {
      refused:
        'Actually Uplifting has no audience while the editions are closed (PLUNK_FULL_EDITION_SEGMENT_ID and PLUNK_UPLIFTING_SEGMENT_ID unset), so this issue was not sent.',
    }
  }
  if (await anyoneOnUplifting(db)) {
    return {
      refused:
        'Readers chose Actually Uplifting while the editions were open, and the edition segment variables (PLUNK_FULL_EDITION_SEGMENT_ID, PLUNK_UPLIFTING_SEGMENT_ID) are unset now, so a send to all subscribers would reach them too. This issue was not sent; set both variables again to send it to the full edition.',
    }
  }
  return { audienceType: 'ALL' }
}
