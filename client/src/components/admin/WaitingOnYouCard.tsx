import { Link } from 'react-router-dom'
import { ExclamationTriangleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import type { JobRun } from '@shared/types'
import { useContinueChain, useJobs } from '../../hooks/useJobs'
import { jobDisplayName } from '../../lib/constants'
import { ApiError } from '../../lib/admin-api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { useToast } from '../ui/Toast'

/** Where a paused chain's work waits to be looked at: the newsletter or podcast draft, or the stories. */
const REVIEW_PAGE: Record<string, { to: string; label: string }> = {
  newsletter_chain: { to: '/admin/newsletters', label: 'Open newsletters' },
  podcast_chain: { to: '/admin/podcasts', label: 'Open podcasts' },
  daily_edition_chain: { to: '/admin/stories', label: 'Open stories' },
  intake_chain: { to: '/admin/stories', label: 'Open stories' },
}

/** A chain that waits for a person: paused by a step's Review switch, or stopped at a failed step. */
const waitsOnPerson = (job: JobRun) =>
  Boolean(job.steps && job.canContinue && job.resumeStep && !job.running && (job.resumeReason === 'review' || job.resumeReason === 'failed'))

function WaitingChain({ chain }: { chain: JobRun }) {
  const continueChain = useContinueChain()
  const { toast } = useToast()
  const name = jobDisplayName(chain.jobName)
  const step = jobDisplayName(chain.resumeStep!)
  const review = chain.resumeReason === 'review'
  const page = review ? REVIEW_PAGE[chain.jobName] : undefined
  const Icon = review ? PauseCircleIcon : ExclamationTriangleIcon
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-sm">
      <Icon className={`h-4 w-4 shrink-0 ${review ? 'text-sky-600' : 'text-red-600'}`} aria-hidden="true" />
      {/* basis-60: on a phone the actions wrap under the text instead of squeezing it */}
      <span className="min-w-0 flex-1 basis-60 text-neutral-900">
        <span className="font-medium">{name}</span>:{' '}
        {review ? `waiting for your review. ${step} runs next.` : `stopped at ${step}. The steps after it did not run.`}
      </span>
      <span className="flex items-center gap-3">
        {/* A stopped chain's error is on the Jobs page, which the card's header links to */}
        {page && (
          <Link to={page.to} className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
            {page.label}
          </Link>
        )}
        <Button
          size="sm"
          variant={review ? 'primary' : 'secondary'}
          disabled={continueChain.isPending}
          onClick={() =>
            continueChain.mutate(chain.jobName, {
              onSuccess: () => toast('success', `${name} continues with ${step}`),
              onError: err => toast('error', err instanceof ApiError ? err.message : 'Failed to continue the chain'),
            })
          }
        >
          {review ? `Continue with ${step}` : `Resume from ${step}`}
        </Button>
      </span>
    </li>
  )
}

/**
 * The dashboard's first card: the chains waiting for a person, either paused after a step whose
 * Review switch is on (a newsletter or podcast draft to approve, stories to check) or stopped at a
 * failed step. A chain held for a step's set time is not here: it goes on by itself. Hidden when
 * nothing waits.
 */
export function WaitingOnYouCard() {
  const jobs = useJobs()
  const waiting = (jobs.data ?? []).filter(waitsOnPerson)
  if (waiting.length === 0) return null
  return (
    <section aria-labelledby="waiting-title" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="waiting-title" className="text-lg font-semibold text-neutral-900">
          Waiting on you
        </h2>
        <Link to="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-700 hover:underline">
          Open jobs
        </Link>
      </div>
      <Card>
        <ul className="-mx-4 -my-3 divide-y divide-neutral-100">
          {waiting.map(chain => (
            <WaitingChain key={chain.jobName} chain={chain} />
          ))}
        </ul>
      </Card>
    </section>
  )
}
