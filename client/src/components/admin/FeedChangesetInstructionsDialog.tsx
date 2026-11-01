import { useMemo } from 'react'
import { Description, Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import type { Issue } from '@shared/types'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { buildChangesetInstructions } from './feedChangesetInstructions'

interface FeedChangesetInstructionsDialogProps {
  open: boolean
  onClose: () => void
  issues: Issue[]
}

/** The agent instructions for writing a feed changeset, with the site's current issue slugs, ready to copy. */
export function FeedChangesetInstructionsDialog({ open, onClose, issues }: FeedChangesetInstructionsDialogProps) {
  const instructions = useMemo(() => buildChangesetInstructions(issues), [issues])
  const { toast } = useToast()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(instructions)
      toast('success', 'Instructions copied')
    } catch {
      toast('error', 'Could not copy. Select the text and copy it instead.')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white p-6 shadow-xl">
          <DialogTitle className="text-base font-semibold text-neutral-900">How to prepare a changeset</DialogTitle>
          <Description className="mt-2 text-sm text-neutral-600">
            Give these instructions to an AI agent that researches feed changes. It writes a JSON file, which you upload with Import changes, check in the
            preview and apply in one step. The issue slugs are this site&apos;s current ones.
          </Description>
          <pre
            role="region"
            aria-label="Agent instructions"
            tabIndex={0}
            className="mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            {instructions}
          </pre>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={copy}>Copy instructions</Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
