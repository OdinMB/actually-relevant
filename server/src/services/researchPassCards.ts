/**
 * A research pass's card stage (`.context/research-passes.md`, "The steps", steps 4 to 6 and 9),
 * context's steps over the pass's pool: the structure call on the pages' facts without fields, the gap
 * list and its searches, whose facts join the pool (`gapStep`), and the cards from the pool's
 * supported facts and the linked earlier stories' offered ones, on the new version's text when the
 * pass made one (`writeCards`); a cited offered fact joins the pool under the ref the card cites. No
 * I/O of its own: the call and the searches are the pass's.
 */
import type { StoryText } from '../prompts/storyContext.js'
import type { PassDeps, PassInput } from './researchPass.js'
import type { WorkingPool } from './researchPassPool.js'
import { gapSearches, readPages } from './researchPassPlan.js'
import { contextFact, usable, type ArticleVersionData } from './researchPool.js'
import type { ContextFactData, DraftBox } from './storyContextChecks.js'
import { storyLayout, type StoryLayout } from './storyContextLayout.js'
import {
  CONTEXT_PROMPT_VERSIONS,
  gapStage,
  responseNotFound,
  structureFacts,
  writeBoxes,
  type ContextRunRecord,
  type ContextStepCall,
  type GapStageResult,
} from './storyContextPipeline.js'
import { boxRefs } from './storyContextRecords.js'

/** The text the gap list and the cards read: the title and the layout's items. */
function storyText(title: string, storyDay: string, layout: StoryLayout): { story: StoryText; text: string } {
  return {
    story: { title, date: storyDay, paragraphs: layout.paragraphs, points: layout.points, caveats: layout.caveats },
    text: [title, ...layout.paragraphs.map(p => p.text), ...layout.points.map(p => p.text), ...layout.caveats].join('\n'),
  }
}

/** The places the cards are written for: the new version's when the pass made one, else the story's as readers see it. */
export function cardsLayout(input: Pick<PassInput, 'story' | 'current'>, version: ArticleVersionData | null): StoryLayout {
  if (!version) return input.current.layout
  return storyLayout({
    url: input.story.original.url,
    summary: version.summary,
    relevanceReasons: version.relevanceReasons,
    antifactors: version.antifactors,
    research: version.research,
  })
}

export interface GapStepInput {
  input: PassInput
  pool: WorkingPool
  deps: Pick<PassDeps, 'search' | 'sourcePolicy'>
  call: ContextStepCall
  context: ContextRunRecord
  spent: { credits: number }
  optOutChecked: boolean
}

/** Steps 4-6: the structure call on the pages' facts without fields, the gap list over the pool, its searches and extraction; the new facts join the pool. Throws on a failure. */
export async function gapStep({ input, pool, deps, call, context, spent, optOutChecked }: GapStepInput): Promise<GapStageResult> {
  const toStructure = pool.pages().flatMap(s => pool.factsOf(s, f => f.structured === null).map(f => ({ s, f })))
  const structure = await structureFacts(
    toStructure.map(({ s, f }) => ({
      id: f.ref,
      statement: f.statement,
      supportingSentence: f.supportingSentence,
      measures: f.measures,
      source: { outlet: s.outlet, date: s.date, kind: s.kind },
    })),
    call,
  )
  for (const [ref, answer] of structure.answers)
    pool.update(ref, { structured: { ...answer, by: { model: structure.model, promptVersion: CONTEXT_PROMPT_VERSIONS.structure } } })
  context.facts.research = toStructure.length
  context.facts.leftOut = toStructure.length - structure.answers.size

  const before = storyText(input.current.title, input.storyDay, input.current.layout)
  // Offered first, so the gap searches number their pages after the refs the offered facts hold
  const offered = pool.offer(input.reusable)
  const gap = await gapStage(
    {
      story: before.story,
      storyText: before.text,
      title: input.current.title,
      summary: input.current.summary,
      storyDay: input.storyDay,
      facts: [...pool.pages().flatMap(s => pool.factsOf(s, f => f.structured !== null && f.verdict !== 'rejected').map(f => contextFact(f, s))), ...offered],
      known: readPages({ sources: pool.sources, dropped: input.pool.dropped }),
      plan: (g, text) => gapSearches(g, text, input.pool),
      firstSource: pool.nextPageNumber(),
    },
    deps,
    call,
    context,
    spent,
  )
  pool.admitGapFacts(gap.facts, optOutChecked)
  return gap
}

export type CardsResult =
  | { kind: 'written'; boxes: DraftBox[]; facts: Map<string, ContextFactData>; writer: { model: string; promptVersion: string } | null }
  | { kind: 'skipped' }
  | { kind: 'error'; err: unknown }

/**
 * Step 9: the write from the pool's supported, structured facts and the offered ones, on the new
 * version's text (else the story's own); the offered facts a kept card cites join the pool under the
 * refs the cards cite them by. Skipped without the gap stage's result; a failure is returned, never thrown.
 */
export async function writeCards(
  input: PassInput,
  pool: WorkingPool,
  gap: GapStageResult | null,
  version: ArticleVersionData | null,
  call: ContextStepCall,
  context: ContextRunRecord,
): Promise<CardsResult> {
  if (!gap) return { kind: 'skipped' }
  const pages = pool.pages()
  const supported = pages.flatMap(s => pool.factsOf(s, f => usable(f) && f.structured !== null).map(f => contextFact(f, s)))
  const reused = pool.offer(input.reusable)
  const layout = cardsLayout(input, version)
  const { story } = storyText(version?.title ?? input.current.title, input.storyDay, layout)
  try {
    const all = [...supported, ...reused]
    const written = await writeBoxes(
      {
        story,
        layout,
        storyDay: input.storyDay,
        supported: all,
        slots: gap.gap.slots,
        responseInStory: gap.plan.storyReports !== null,
        voices: new Map(pages.map(s => [s.ref, s.voices])),
      },
      call,
      context,
    )
    context.responseNotFound = responseNotFound(gap.plan, all, written.boxes)
    const cited = new Set(written.boxes.flatMap(boxRefs))
    for (const f of reused) if (cited.has(f.ref)) pool.admitOffered(f)
    return { kind: 'written', boxes: written.boxes, facts: new Map(all.map(f => [f.ref, f])), writer: written.writer }
  } catch (err) {
    return { kind: 'error', err }
  }
}
