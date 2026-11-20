/**
 * Link results as the linking step returns them, for the overview tests: a story left alone, a join,
 * a founding; and the case a review reads of an overview's rows. Test-only.
 */
import type { Rows } from '../../services/overviewChanges.js'
import type { LinkResult } from '../../services/overviewLink.js'
import type { ReviewCase } from '../../services/overviewReview.js'
import type { Charter, LinkStory, Shared } from '../../services/overviewTypes.js'

export const fixtureCharter: Charter = { in: 'The Ebola outbreak in Ituri.', out: ['Ebola in Uganda'], endEvent: 'The ministry declares it over' }
export const fixtureShared: Shared = {
  cause: { story: 'Ebola', other: 'Ebola' },
  place: { story: 'Ituri', other: 'Ituri' },
  end: { story: 'over', other: 'over' },
}

export const linkStory = (s: { id: string; datePublished: Date | null; title?: string | null }, issueId: string | null = null): LinkStory => ({
  id: s.id,
  title: s.title ?? 'Title',
  label: '',
  summary: 'Summary.',
  datePublished: s.datePublished!,
  date: s.datePublished!.toISOString().slice(0, 10),
  issueId,
  facts: [],
})

export const linkResult = (story: LinkStory, over: Partial<LinkResult> = {}): LinkResult => ({
  story,
  outcome: 'none',
  role: { role: 'routine', roleKind: null },
  join: null,
  founding: null,
  shown: { overviews: [], partners: [] },
  answer: null,
  proposed: 0,
  refusals: [],
  signals: [],
  heldBy: null,
  model: 'small-model',
  promptVersion: 'v1',
  costUsd: 0.001,
  ...over,
})

export const joinResult = (story: LinkStory, overviewId: string, reportsEndEvent = false, charter = fixtureCharter): LinkResult =>
  linkResult(story, {
    outcome: 'joined',
    role: { role: 'turning_point', roleKind: 'spread' },
    join: {
      candidate: { id: overviewId, title: 'Ebola in Ituri', charter, entries: [], ref: 'O1', distance: 0.2, frozen: false },
      answer: { id: 'O1', belongs: 'yes', ...fixtureShared, reportsEndEvent, scope: 'inside', centerMoved: false, signalQuote: '', confidence: 0.8 },
      shared: fixtureShared,
      reportsEndEvent,
    },
    shown: { overviews: [{ ref: 'O1', id: overviewId, distance: 0.2 }], partners: [] },
  })

/** The case a review is asked on, read from these rows as `reviewCase` reads the tables: the active entries of published stories, oldest first (every role routine). */
export const reviewCaseOf = ({ overview: o, entries }: Rows): ReviewCase => ({
  overviewId: o.id,
  title: o.title,
  charter: o.charter,
  scope: o.scope,
  frozen: o.frozen,
  entries: entries
    .filter(e => e.status === 'active' && e.published && e.datePublished !== null)
    .sort((a, b) => a.datePublished!.getTime() - b.datePublished!.getTime())
    .map(e => ({
      entryId: e.id,
      storyId: e.storyId ?? '',
      title: 'Title',
      label: '',
      summary: 'Summary.',
      date: e.datePublished!.toISOString().slice(0, 10),
      role: { role: 'routine', roleKind: null },
      locked: e.locked,
    })),
  closingStoryId: o.status === 'closing' ? o.closingStoryId : null,
  lockedOut: o.lockedOut,
})

export const foundResult = (
  story: LinkStory,
  partner: LinkStory,
  shownPartners = [{ ref: 'F1', id: partner.id, distance: 0.2 }],
  charter = fixtureCharter,
): LinkResult =>
  linkResult(story, {
    outcome: 'founded',
    role: { role: 'routine', roleKind: null },
    founding: {
      partner,
      outcome: 'founded',
      draft: { title: 'Ebola in Ituri', charter, roles: { a: { role: 'turning_point', roleKind: 'spread' }, b: { role: 'routine', roleKind: null } } },
      answers: { draft: null, check: null },
      shared: fixtureShared,
      confidence: 0.85,
      costUsd: 0.04,
      model: 'large-model',
    },
    shown: { overviews: [], partners: shownPartners },
  })
