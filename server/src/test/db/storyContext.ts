/**
 * Fixtures for the story context db tests: a research run with facts, a context run, its facts and
 * its boxes, as the step stores them.
 */
import type { Prisma } from '@prisma/client'
import prisma from '../../lib/prisma.js'

export interface ResearchFactFixture {
  id: string
  statement?: string
  supportingSentence?: string
}

/** A completed research run whose sources hold the given facts (`S0` first), linking `earlier` story ids. */
export async function createResearchRun(
  storyId: string,
  sources: { id: string; url?: string; facts: ResearchFactFixture[] }[],
  options: { earlier?: string[]; status?: 'completed' | 'failed'; startedAt?: Date } = {},
) {
  const result = {
    sources: sources.map(s => ({
      id: s.id,
      origin: s.id === 'S0' ? 'original' : 'search',
      url: s.url ?? `https://${s.id.toLowerCase()}.example/${storyId}`,
      title: `Title ${s.id}`,
      outlet: `Outlet ${s.id}`,
      date: '2026-11-12',
      favicon: null,
      usedRawContent: false,
      kind: 'news-report',
      country: 'Indonesia',
      relation: 'same-development',
      facts: s.facts.map(f => ({
        id: f.id,
        statement: f.statement ?? `Statement ${f.id}`,
        supportingSentence: f.supportingSentence ?? `Sentence ${f.id}.`,
        measures: '',
        found: true,
      })),
      voices: [],
    })),
    earlier: (options.earlier ?? []).map((id, i) => ({
      id: `E${i + 1}`,
      storyId: id,
      slug: null,
      title: 'Earlier',
      date: '2026-11-01',
      relation: 'background',
      facts: [],
    })),
  }
  return prisma.storyResearchRun.create({
    data: {
      storyId,
      status: options.status ?? 'completed',
      trigger: 'pipeline',
      costUsd: 0.05,
      result: result as unknown as Prisma.InputJsonObject,
      startedAt: options.startedAt ?? new Date(),
      finishedAt: new Date(),
    },
  })
}

export async function createContextRun(storyId: string, data: Partial<Prisma.StoryContextRunUncheckedCreateInput> = {}) {
  return prisma.storyContextRun.create({ data: { storyId, status: 'completed', outcome: 'built', finishedAt: new Date(), ...data } })
}

export async function createContextFact(storyId: string, runId: string, data: Partial<Prisma.ContextFactUncheckedCreateInput> & { ref: string }) {
  return prisma.contextFact.create({
    data: {
      storyId,
      runId,
      origin: 'search',
      sourceUrl: `https://${data.ref.replace(/F\d+$/, '').toLowerCase()}.example/a`,
      sourceOutlet: `Outlet ${data.ref}`,
      sourceTitle: `Title ${data.ref}`,
      sourceDate: new Date('2026-11-12T00:00:00Z'),
      sourceKind: 'news-report',
      supportingSentence: `Sentence of ${data.ref}.`,
      statement: `Statement of ${data.ref}.`,
      verdict: 'supported',
      model: 'test-model',
      promptVersion: 'abcd1234',
      ...data,
    },
  })
}

export async function createContextBox(storyId: string, runId: string, data: Partial<Prisma.ContextBoxUncheckedCreateInput> & { position: number }) {
  return prisma.contextBox.create({
    data: {
      storyId,
      runId,
      type: 'compared',
      heading: `Heading ${data.position}`,
      teaser: `Teaser ${data.position}`,
      sentences: [],
      model: 'test-writer',
      promptVersion: 'efgh5678',
      ...data,
    },
  })
}
