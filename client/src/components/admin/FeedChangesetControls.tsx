import { useState } from 'react'
import { InformationCircleIcon } from '@heroicons/react/24/outline'
import type { Issue } from '@shared/types'
import { Button } from '../ui/Button'
import { FeedChangesetImportPanel } from './FeedChangesetImportPanel'
import { FeedChangesetInstructionsDialog } from './FeedChangesetInstructionsDialog'

/** The Feeds page's "Import changes" button and, beside it, the info icon with the agent instructions. */
export function FeedChangesetControls({ issues }: { issues: Issue[] }) {
  const [importOpen, setImportOpen] = useState(false)
  const [instructionsOpen, setInstructionsOpen] = useState(false)

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Button variant="secondary" onClick={() => setImportOpen(true)}>
          Import changes
        </Button>
        <button
          type="button"
          onClick={() => setInstructionsOpen(true)}
          aria-label="How to prepare a changeset"
          title="How to prepare a changeset"
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <InformationCircleIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </span>
      <FeedChangesetImportPanel open={importOpen} onClose={() => setImportOpen(false)} />
      <FeedChangesetInstructionsDialog open={instructionsOpen} onClose={() => setInstructionsOpen(false)} issues={issues} />
    </>
  )
}
