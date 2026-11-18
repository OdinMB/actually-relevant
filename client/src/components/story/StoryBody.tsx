import type { CSSProperties, ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { PublicStoryDetail, PublicStoryUpdate, ResearchedCitedText, ResearchedStory } from '@shared/types'
import { shiftHex, type CategoryColor } from '../../lib/category-colors'
import { parsePoints } from '../../lib/parse-points'
import { quoteAttributionLine } from '../ai/aiDisclosureCopy'
import { Citation, type SourcesById } from '../research/Citation'
import { CitedParagraphs, CitedSentences } from '../research/CitedText'
import { SourcesList } from '../research/SourcesList'
import { StoryUpdates, UpdatedMark } from '../research/StoryUpdates'
import { updateMarks, type UpdateMarks } from '../research/updateMarks'

// ---------------------------------------------------------------------------
// Analysis section with ruled heading + numbered points
// ---------------------------------------------------------------------------

function AnalysisSection({
  title,
  points,
  accentColor,
  numberColor,
  aiField,
  notes = [],
}: {
  title: string
  /** The points, rendered: Markdown from the plain fields, or cited sentences from the researched version */
  points: ReactNode[]
  /** The heading's dot */
  accentColor: string
  /** The points' numbers: 24px bold, large text, so 3:1 is the bar; the 700 text shade clears it with room */
  numberColor: string
  /** API field name of the AI-generated text, for the machine-readable marker */
  aiField: string
  /** A context note under a point, by point index: in the point's text column, past its number */
  notes?: ReactNode[]
}) {
  return (
    <section className="mb-10" data-ai-generated={aiField}>
      {/* Ruled heading with colored dot — larger text. An h2 under the headline, like "Related Stories" */}
      <h2 className="ruled-heading mb-6 !text-sm !tracking-wider">
        <span className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accentColor }} aria-hidden="true" />
          {title}
        </span>
      </h2>

      {/* Numbered points — fixed-width number column for alignment */}
      <div className="space-y-6">
        {points.map((point, idx) => (
          // A point with a note is the box the note places itself in
          <div key={idx} className={notes[idx] ? 'relative flex gap-4' : 'flex gap-4'}>
            <span
              className="font-nexa text-2xl font-bold leading-none pt-1 select-none text-right"
              style={{ color: numberColor, width: '2ch' }}
              aria-hidden="true"
            >
              {idx + 1}
            </span>
            <div className="prose flex-1 min-w-0">
              {point}
              {notes[idx]}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** One analysis section's points and the API field its marker names. */
interface AnalysisPoints {
  points: ReactNode[]
  aiField: string
}

/** Analysis points from a plain field's Markdown bullets. */
const markdownPoints = (text: string | null): ReactNode[] => (text ? parsePoints(text).map(point => <Markdown>{point}</Markdown>) : [])

/** Analysis points from the researched version's cited bullets; a point in `marked` ends with the "Updated" mark. */
const citedPoints = (bullets: ResearchedCitedText[], sources: SourcesById, marked: ReadonlySet<number>): ReactNode[] =>
  bullets.map((bullet, i) => (
    <p>
      <CitedSentences items={[bullet]} sources={sources} />
      {marked.has(i) && <UpdatedMark />}
    </p>
  ))

/**
 * Why This Matters and Caveats: the researched version's cited bullets, marked `research`, or the
 * plain fields' Markdown bullets, marked by their own field names.
 */
function analysisOf(
  story: Pick<PublicStoryDetail, 'relevanceReasons' | 'antifactors'>,
  research: ResearchedStory | null,
  sources: SourcesById,
  marks: UpdateMarks,
): { reasons: AnalysisPoints; caveats: AnalysisPoints } {
  if (research) {
    return {
      reasons: { points: citedPoints(research.whyThisMatters, sources, marks.whyThisMatters), aiField: 'research' },
      caveats: { points: citedPoints(research.caveats, sources, marks.caveats), aiField: 'research' },
    }
  }
  return {
    reasons: { points: markdownPoints(story.relevanceReasons), aiField: 'relevanceReasons' },
    caveats: { points: markdownPoints(story.antifactors), aiField: 'antifactors' },
  }
}

/**
 * The story's body, from the text under the header to the end of the analysis: the researched
 * paragraphs or the summary, the key quote (cited in the researched format), Why This Matters and
 * Caveats, and a researched story's Sources list. Story context comes in from the page: a note after
 * a paragraph (the single-source summary counts as one) or inside a Why This Matters point, by index,
 * and the More context section (`context`) after Caveats. A researched story's Updates (ADR-0068)
 * follow Caveats, before the context, and every paragraph and point an Update rewrote ends with an
 * "Updated" mark linking them.
 */
export function StoryBody({
  story,
  research,
  colors,
  paragraphNotes = [],
  pointNotes = [],
  context,
  updates = [],
}: {
  story: PublicStoryDetail
  research: ResearchedStory | null
  colors: CategoryColor
  paragraphNotes?: ReactNode[]
  pointNotes?: ReactNode[]
  context?: ReactNode
  /** The story's Updates, newest first; shown only with the researched version they changed */
  updates?: PublicStoryUpdate[]
}) {
  const sources: SourcesById = new Map((research?.sources ?? []).map(source => [source.id, source]))
  const shownUpdates = research ? updates : []
  const marks = updateMarks(shownUpdates)
  const { reasons, caveats } = analysisOf(story, research, sources, marks)
  const dropCap = { '--drop-cap-color': colors.hex } as CSSProperties
  const paragraphMarks = research?.paragraphs.map((_, i) => (marks.paragraphs.has(i) ? <UpdatedMark key={i} /> : null))

  return (
    <>
      {/* The researched story in place of the summary, or the summary */}
      {research ? (
        <section className="mb-10" data-ai-generated="research">
          <div className="prose drop-cap" style={dropCap}>
            <CitedParagraphs paragraphs={research.paragraphs} sources={sources} notes={paragraphNotes} after={paragraphMarks} />
          </div>
        </section>
      ) : (
        story.summary && (
          <section className="mb-10" data-ai-generated="summary">
            <div className={paragraphNotes[0] ? 'prose drop-cap relative' : 'prose drop-cap'} style={dropCap}>
              <Markdown>{story.summary}</Markdown>
              {paragraphNotes[0]}
            </div>
          </section>
        )
      )}

      {/* Key quote — editorial pull-quote style */}
      {story.quote && (
        <div className="py-6 md:py-8 text-center max-w-2xl mx-auto mb-10" data-ai-generated="quote quoteAttribution">
          <div className="relative">
            <span
              aria-hidden="true"
              className="block text-brand-200 leading-none select-none pointer-events-none"
              style={{ fontSize: '6rem', fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              &ldquo;
            </span>
            <blockquote className="-mt-8">
              {/* No italic — avoids loading Roboto-Italic; decorative quotes provide visual distinction */}
              <p className="text-xl md:text-2xl text-neutral-700 leading-relaxed px-4">{story.quote}</p>
            </blockquote>
            <p className="text-sm text-neutral-500 mt-3">
              <span>{quoteAttributionLine(story.quoteAttribution)}</span>
              {research?.quoteSourceId && (
                <>
                  {' '}
                  <Citation citations={[{ sourceId: research.quoteSourceId, sentence: null }]} sources={sources} />
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Why This Matters */}
      {reasons.points.length > 0 && (
        <AnalysisSection
          title="Why This Matters"
          points={reasons.points}
          accentColor={colors.hex}
          numberColor={colors.textHex}
          aiField={reasons.aiField}
          notes={pointNotes}
        />
      )}

      {/* Caveats: a shade darker than "Why This Matters" */}
      {caveats.points.length > 0 && (
        <AnalysisSection
          title="Caveats"
          points={caveats.points}
          accentColor={shiftHex(colors.hex, -0.25)}
          numberColor={shiftHex(colors.textHex, -0.25)}
          aiField={caveats.aiField}
        />
      )}

      <StoryUpdates updates={shownUpdates} />

      {/* More context: the cards not beside the text */}
      {context}

      {research && <SourcesList sources={research.sources} />}
    </>
  )
}
