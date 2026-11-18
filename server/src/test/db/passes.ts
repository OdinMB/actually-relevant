/**
 * Fixtures for the research pass db tests: a pass row, a pool source and fact, and a pass's card,
 * written as rows the way a pass stores them, so `loadPool` and the card readers read them back.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../../lib/prisma.js'
import { normalizedUrl } from '../../services/researchFilter.js'
import { factKey } from '../../services/storyContextRecords.js'

export const createPass = (storyId: string, number: number, data: Partial<Prisma.ResearchPassUncheckedCreateInput> = {}) =>
  prisma.researchPass.create({
    data: { storyId, number, trigger: 'pipeline', kind: number === 1 ? 'first' : 'later', status: 'completed', costUsd: 0.2, finishedAt: new Date(), ...data },
  })

/** A source of the story's pool under `ref`, at `https://<ref>.example/story` unless given. */
export function createPoolSource(storyId: string, ref: string, data: Partial<Prisma.EvidenceSourceUncheckedCreateInput> = {}) {
  const url = data.url ?? `https://${ref.toLowerCase()}.example/story`
  return prisma.evidenceSource.create({
    data: {
      storyId,
      ref,
      origin: ref === 'S0' ? 'original' : 'search',
      url,
      normalizedUrl: normalizedUrl(url),
      outlet: `Outlet ${ref}`,
      title: `Title ${ref}`,
      publishedDate: new Date('2026-11-12T00:00:00Z'),
      kind: 'news-report',
      optOutChecked: true,
      ...data,
    },
  })
}

/** A supported, structured fact of a pool source (`ref` under the source's), as a pass leaves it. */
export function createPoolFact(source: { id: string; storyId: string; url: string }, data: Partial<Prisma.PoolFactUncheckedCreateInput> & { ref: string }) {
  const supportingSentence = data.supportingSentence ?? `Sentence of ${data.ref}.`
  const statement = data.statement ?? `Statement of ${data.ref}.`
  return prisma.poolFact.create({
    data: {
      storyId: source.storyId,
      sourceId: source.id,
      factKey: factKey({ url: source.url, supportingSentence, statement }),
      supportingSentence,
      statement,
      value: 212,
      unit: 'people',
      counted: 'deaths',
      place: 'Kenya',
      validity: 'slow',
      extractModel: 'test-small',
      extractPromptVersion: 'ext00001',
      structureModel: 'test-small',
      structurePromptVersion: 'str00001',
      verdict: 'supported',
      checkModel: 'test-small',
      checkPromptVersion: 'chk00001',
      ...data,
    },
  })
}

export function createPassBox(storyId: string, passId: string, data: Partial<Prisma.PassBoxUncheckedCreateInput> & { position: number }) {
  return prisma.passBox.create({
    data: {
      storyId,
      passId,
      type: 'compared',
      heading: `Pass heading ${data.position}`,
      teaser: `Pass teaser ${data.position}`,
      sentences: [],
      model: 'test-writer',
      promptVersion: 'efgh5678',
      ...data,
    },
  })
}
