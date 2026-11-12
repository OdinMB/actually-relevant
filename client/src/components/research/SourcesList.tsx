import type { ResearchedSource } from '@shared/types'
import { SourceIcon } from './SourceIcon'
import { SourceLink } from './SourceLink'
import { EARLIER_LABEL, sourceDetails } from './sourceText'

/** The `#sources` heading's id, for the section's name. */
const HEADING_ID = 'sources-heading'

/**
 * A researched story's sources, the `#sources` target of the header's "N sources": per source its
 * icon, outlet, country, kind and date, and its own headline linked. The original article says
 * "initially found here"; our earlier stories come last as "Earlier on Actually Relevant". It takes
 * over from "Also covered by".
 */
export function SourcesList({ sources }: { sources: ResearchedSource[] }) {
  return (
    <section id="sources" aria-labelledby={HEADING_ID} className="mb-10 scroll-mt-24" data-ai-generated="research">
      <h2 id={HEADING_ID} className="ruled-heading mb-6 !text-sm !tracking-wider">
        Sources
      </h2>
      <ul className="space-y-4">
        {sources.map(source => {
          const earlier = source.origin === 'earlier'
          return (
            <li key={source.id} className="flex gap-3">
              <SourceIcon source={source} className="mt-0.5" />
              <div className="min-w-0 text-sm">
                <p className="text-neutral-500">
                  <span className={`font-semibold ${earlier ? 'text-brand-700' : 'text-neutral-900'}`}>{earlier ? EARLIER_LABEL : source.outlet}</span>
                  {sourceDetails(source).map(part => ` · ${part}`)}
                  {source.origin === 'original' && ' · initially found here'}
                </p>
                <p className="mt-0.5 break-words">
                  <SourceLink
                    source={source}
                    className="text-neutral-800 underline hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
                  >
                    {source.title}
                  </SourceLink>
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
