import { useState } from 'react'
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import type { NewsletterEdition } from '@shared/types'
import { Input } from '../ui/Input'
import { Button } from '../ui/Button'
import { BRAND } from '../../config'

interface CreateContentDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (title: string, edition: NewsletterEdition) => Promise<void>
  type: ContentType
  loading?: boolean
}

/** Newsletters only: podcast episodes are created from the podcast page's own controls. */
type ContentType = 'newsletter'

const LABELS: Record<ContentType, string> = { newsletter: 'Newsletter' }

const EDITIONS: { value: NewsletterEdition; label: string }[] = [
  { value: 'full', label: 'Actually Relevant (full)' },
  { value: 'uplifting', label: BRAND.upliftingEdition },
]

export function CreateContentDialog({ open, onClose, onSubmit, type, loading }: CreateContentDialogProps) {
  const [title, setTitle] = useState('')
  const [edition, setEdition] = useState<NewsletterEdition>('full')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(title, edition)
    setTitle('')
    setEdition('full')
  }

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="mx-auto max-w-sm w-full rounded-lg bg-white p-6 shadow-xl">
          <DialogTitle className="text-base font-semibold text-neutral-900 mb-4">New {LABELS[type]}</DialogTitle>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id="content-title"
              label="Title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={`Enter ${type} title`}
              required
              autoFocus
            />
            {/* Which subscribers the issue goes to, and which stories it is built from */}
            <fieldset>
              <legend className="text-sm font-medium text-neutral-700 mb-1">Edition</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {EDITIONS.map(option => (
                  <label key={option.value} className="flex items-center gap-1.5 text-sm text-neutral-700 cursor-pointer">
                    <input
                      type="radio"
                      name="content-edition"
                      value={option.value}
                      checked={edition === option.value}
                      onChange={() => setEdition(option.value)}
                      className="accent-brand-600"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={loading} disabled={!title.trim()}>
                Create
              </Button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
