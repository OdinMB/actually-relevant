import { useState, type ReactNode } from 'react'
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useFeedQuality, useFeeds } from '../../hooks/useFeeds'
import { useIssues } from '../../hooks/useIssues'
import { downloadFile } from '../../lib/download'
import { Button } from '../ui/Button'
import { ReasonButton } from '../ui/ReasonButton'
import { useToast } from '../ui/Toast'
import { buildFeedExport, feedExportFileName, type FeedExportInput, type FeedExportScope } from './feedExport'
import { buildCoverageGapsPrompt, buildFixProblemFeedsPrompt } from './feedExportPrompts'
import { findFeedProblems } from './feedProblems'

interface FeedExportDialogProps {
  open: boolean
  onClose: () => void
}

const SCOPE_HINTS: Record<FeedExportScope, string> = {
  problems:
    'Active feeds whose last crawl could not fetch the RSS feed, that lost more than half of their articles to extraction errors, that have gone stale, or none of whose crawled stories was analyzed or published.',
  all: 'Every feed, inactive ones included, with the problems found for each.',
}

/**
 * The feed export (`feedExport.ts`): the feeds with problems or every feed as JSON, to download or
 * copy, and two prompts for an AI agent with the export inside, which answer with a changeset to
 * upload with Import changes (`.context/feed-management.md`, "Export").
 */
export function FeedExportDialog({ open, onClose }: FeedExportDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <DialogTitle className="text-base font-semibold text-neutral-900">Export feeds</DialogTitle>
          <Description className="mt-2 text-sm text-neutral-600">
            Export the feeds as JSON with their settings, crawl state and quality, or copy a prompt for an AI agent with the export inside.
          </Description>
          <FeedExportOptions />
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

/**
 * The dialog's body. Mounted only while the dialog is open, so the full feed list, inactive feeds
 * included, is fetched only then; issues and quality metrics come from the Feeds page's cache.
 */
function FeedExportOptions() {
  const feedsQuery = useFeeds()
  const qualityQuery = useFeedQuality()
  const issuesQuery = useIssues()
  const [scope, setScope] = useState<FeedExportScope>('problems')
  const { toast } = useToast()

  const queries = [feedsQuery, qualityQuery, issuesQuery]
  const feeds = feedsQuery.data
  const quality = qualityQuery.data
  const issues = issuesQuery.data
  const failed = queries.some(query => !!query.error)
  const unavailable = failed ? 'The feeds could not be loaded' : !feeds || !quality || !issues ? 'Loading the feeds' : null
  const problemCount = feeds && quality ? feeds.filter(feed => findFeedProblems(feed, quality[feed.id]).length > 0).length : undefined

  /** Read at the moment of the action, so the export carries that time. */
  const withInput = (action: (input: FeedExportInput) => void) => () => {
    if (feeds && quality && issues) action({ feeds, issues, quality, now: new Date() })
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('success', `${what} copied`)
    } catch {
      toast('error', 'Could not copy to the clipboard')
    }
  }

  const exportJson = (input: FeedExportInput) => JSON.stringify(buildFeedExport(input, scope), null, 2)
  const scopeLabels: Record<FeedExportScope, string> = {
    problems: `Feeds with problems${problemCount === undefined ? '' : ` (${problemCount})`}`,
    all: `All feeds${feeds ? ` (${feeds.length})` : ''}`,
  }

  return (
    <>
      {failed && (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          The feeds could not be loaded.{' '}
          <button
            type="button"
            onClick={() => queries.forEach(query => query.refetch())}
            className="font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Try again
          </button>
        </p>
      )}

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-neutral-900">Feeds to export</legend>
        <div className="mt-2 space-y-3">
          {(['problems', 'all'] as const).map(value => (
            <div key={value} className="flex items-start gap-2">
              <input
                id={`feed-export-scope-${value}`}
                type="radio"
                name="feed-export-scope"
                value={value}
                checked={scope === value}
                onChange={() => setScope(value)}
                aria-describedby={`feed-export-scope-${value}-hint`}
                className="mt-0.5 accent-brand-600"
              />
              <div>
                <label htmlFor={`feed-export-scope-${value}`} className="text-sm font-medium text-neutral-800">
                  {scopeLabels[value]}
                </label>
                <p id={`feed-export-scope-${value}-hint`} className="text-xs text-neutral-500">
                  {SCOPE_HINTS[value]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        <ReasonButton
          variant="secondary"
          reason={unavailable}
          onClick={withInput(input => downloadFile(feedExportFileName(scope, input.now), exportJson(input), 'application/json'))}
        >
          Download JSON
        </ReasonButton>
        <ReasonButton variant="secondary" reason={unavailable} onClick={withInput(input => copy(exportJson(input), 'JSON'))}>
          Copy JSON
        </ReasonButton>
      </div>

      <section aria-labelledby="feed-export-prompts" className="mt-6 border-t border-neutral-200 pt-4">
        <h3 id="feed-export-prompts" className="text-sm font-medium text-neutral-900">
          Prompts for an AI agent
        </h3>
        <p className="mt-1 text-sm text-neutral-600">
          Each prompt holds the task, the changeset instructions and the export. The agent answers with a changeset file, which you upload with Import changes.
        </p>
        <div className="mt-3 space-y-3">
          <PromptOption
            title="Fix problem feeds"
            description="Finds out why each feed with problems fails, and writes the fixes or deletions. Holds the feeds with problems."
          >
            <ReasonButton
              variant="secondary"
              size="sm"
              reason={unavailable ?? (problemCount === 0 ? 'No feed has problems right now' : null)}
              aria-label="Copy prompt: Fix problem feeds"
              onClick={withInput(input => copy(buildFixProblemFeedsPrompt(input), 'Fix prompt'))}
            >
              Copy prompt
            </ReasonButton>
          </PromptOption>
          <PromptOption
            title="Analyze coverage gaps"
            description="Assesses coverage per issue, region and language, and proposes replacement and new sources, fixes first. Holds every feed."
          >
            <ReasonButton
              variant="secondary"
              size="sm"
              reason={unavailable}
              aria-label="Copy prompt: Analyze coverage gaps"
              onClick={withInput(input => copy(buildCoverageGapsPrompt(input), 'Gap analysis prompt'))}
            >
              Copy prompt
            </ReasonButton>
          </PromptOption>
        </div>
      </section>
    </>
  )
}

function PromptOption({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-neutral-200 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-800">{title}</p>
        <p className="text-xs text-neutral-500">{description}</p>
      </div>
      {children}
    </div>
  )
}
