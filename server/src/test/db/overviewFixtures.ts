/**
 * Link results as the linking step returns them, for the overview db tests: a story left alone, a
 * join, a founding. Test-only.
 */
import type { LinkResult } from '../../services/overviewLink.js'
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
      answer: { id: 'O1', belongs: 'yes', ...fixtureShared, reportsEndEvent, confidence: 0.8 },
      shared: fixtureShared,
      reportsEndEvent,
    },
    shown: { overviews: [{ ref: 'O1', id: overviewId, distance: 0.2 }], partners: [] },
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
