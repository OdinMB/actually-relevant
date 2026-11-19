import type { PublicOverview } from '@shared/types'
import type { SourcesById } from '../research/Citation'
import { CitedSentences } from '../research/CitedText'
import { dayOf } from './overviewCopy'

/** A ruled section heading with the area's dot, as a researched story's sections have. */
export function OverviewHeading({ id, accent, children }: { id: string; accent: string; children: string }) {
  return (
    <h2 id={id} className="ruled-heading mb-6 !text-sm !tracking-wider">
      <span className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: accent }} aria-hidden="true" />
        {children}
      </span>
    </h2>
  )
}

/**
 * "Where this stands" and, under it, "What's being done" (only when something sourced exists), each
 * line cited as a researched story's are, its source cards naming the story of ours each came through.
 * The page shows it only while the API serves one: none is written until the stories' research holds
 * enough checked facts, and none of it stands once its facts are gone.
 */
export function OverviewStands({ stands, sources, accent }: { stands: NonNullable<PublicOverview['stands']>; sources: SourcesById; accent: string }) {
  return (
    <section aria-labelledby="stands-heading" className="mb-10" data-ai-generated="stands">
      <OverviewHeading id="stands-heading" accent={accent}>
        Where this stands
      </OverviewHeading>
      {stands.sentences.length > 0 && (
        <p className="text-lg leading-relaxed text-neutral-800">
          <CitedSentences items={stands.sentences} sources={sources} />
        </p>
      )}
      {stands.doing.length > 0 && (
        <p className="mt-4 leading-relaxed text-neutral-800">
          <span className="font-semibold">What&apos;s being done:</span> <CitedSentences items={stands.doing} sources={sources} />
        </p>
      )}
      <p className="mt-3 text-sm text-neutral-500">
        As of <time dateTime={stands.asOf}>{dayOf(stands.asOf)}</time>
      </p>
    </section>
  )
}
