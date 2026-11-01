import { useEffect, useState } from 'react'
import type { FeedChangeResult, FeedChangesetReport } from '@shared/types'
import { adminApi } from '../../lib/admin-api'
import type { BadgeVariant } from '../../lib/constants'
import { useApplyFeedChangeset } from '../../hooks/useFeeds'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { useToast } from '../ui/Toast'
import { EditPanel, PANEL_BODY, PANEL_FOOTER } from './EditPanel'
import { refusalMessage, reportFromRefusal } from './feedChangesetRefusal'

interface FeedChangesetImportPanelProps {
  open: boolean
  onClose: () => void
}

const STATUS_BADGE: Record<FeedChangeResult['status'], { label: string; variant: BadgeVariant }> = {
  ok: { label: 'Ready', variant: 'green' },
  noop: { label: 'No change', variant: 'gray' },
  error: { label: 'Error', variant: 'red' },
}

function plural(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? '' : 's'}`
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('The file could not be read'))
    reader.readAsText(file)
  })
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('This file is not valid JSON')
  }
}

function formatValue(value: string | number | boolean | null): string {
  return value === null || value === '' ? '(empty)' : String(value)
}

function ChangeRow({ result }: { result: FeedChangeResult }) {
  const badge = STATUS_BADGE[result.status]
  return (
    <li className="rounded-md border border-neutral-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-neutral-500">#{result.index + 1}</span>
        <Badge variant="blue">{result.action ?? 'unknown'}</Badge>
        <span className="font-medium text-neutral-900">{result.feedTitle ?? 'No single feed matched'}</span>
        <Badge variant={badge.variant} className="ml-auto">
          {badge.label}
        </Badge>
      </div>
      <p className={`mt-1 ${result.status === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>{result.message}</p>
      {result.diff && result.diff.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-xs text-neutral-600">
          {result.diff.map(change => (
            <li key={change.field} className="break-all">
              <span className="font-medium">{change.field}</span>: {formatValue(change.from)} <span aria-hidden="true">→</span>
              <span className="sr-only">to</span> {formatValue(change.to)}
            </li>
          ))}
        </ul>
      )}
      {result.reason && <p className="mt-1 text-xs text-neutral-500">Reason: {result.reason}</p>}
    </li>
  )
}

/**
 * The changeset import: choose a JSON file, see the server's preview of every change, and apply it
 * in one step, which is possible only while no change has an error (`.context/feed-management.md`,
 * "Changesets").
 */
export function FeedChangesetImportPanel({ open, onClose }: FeedChangesetImportPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [changeset, setChangeset] = useState<unknown>(null)
  const [report, setReport] = useState<FeedChangesetReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const applyChangeset = useApplyFeedChangeset()
  const { toast } = useToast()

  const reset = (name: string | null) => {
    setFileName(name)
    setChangeset(null)
    setReport(null)
    setError(null)
  }

  useEffect(() => {
    if (open) reset(null)
  }, [open])

  const handleFile = async (file: File | undefined) => {
    reset(file?.name ?? null)
    if (!file) return
    setChecking(true)
    try {
      const parsed = parseJson(await readText(file))
      const preview = await adminApi.feeds.previewChangeset(parsed)
      setChangeset(parsed)
      setReport(preview)
    } catch (err) {
      setError(refusalMessage(err))
    } finally {
      setChecking(false)
    }
  }

  const handleApply = async () => {
    try {
      const applied = await applyChangeset.mutateAsync(changeset)
      toast('success', `Applied ${plural(applied.counts.ok, 'change')}`)
      onClose()
    } catch (err) {
      const refused = reportFromRefusal(err)
      if (refused) setReport(refused)
      toast('error', err instanceof Error ? err.message : 'Failed to apply the changes')
    }
  }

  const counts = report?.counts
  const canApply = !!counts && counts.error === 0 && counts.ok > 0

  return (
    <EditPanel open={open} onClose={onClose} title="Import feed changes">
      <div className={PANEL_BODY}>
        <div>
          <label htmlFor="feed-changeset-file" className="mb-1 block text-sm font-medium text-neutral-700">
            Changeset file (.json)
          </label>
          <input
            id="feed-changeset-file"
            type="file"
            accept=".json,application/json"
            onChange={e => {
              const file = e.target.files?.[0]
              // Cleared, so that choosing the same file again after fixing it checks it again.
              e.target.value = ''
              handleFile(file)
            }}
            aria-describedby="feed-changeset-file-hint"
            className="block w-full text-sm text-neutral-700 file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-neutral-200"
          />
          <p id="feed-changeset-file-hint" className="mt-1 text-xs text-neutral-500">
            Nothing changes until you apply. Changes apply all together, and only when none has an error.
          </p>
        </div>

        {fileName && (
          <p className="text-sm text-neutral-700">
            {checking ? 'Checking' : 'Checked'} <span className="font-medium">{fileName}</span>
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {report && counts && (
          <section aria-labelledby="feed-changeset-summary">
            <h3 id="feed-changeset-summary" className="text-sm font-medium text-neutral-900">
              {report.title ?? 'Changes'}: {plural(report.results.length, 'change')}
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              {counts.ok} ready, {counts.noop} with nothing to change, {plural(counts.error, 'error')}
              {counts.error > 0 && '. Fix the file and choose it again.'}
            </p>
            <ol className="mt-3 space-y-2">
              {report.results.map(result => (
                <ChangeRow key={result.index} result={result} />
              ))}
            </ol>
          </section>
        )}
      </div>
      <div className={PANEL_FOOTER}>
        <Button onClick={handleApply} disabled={!canApply} loading={applyChangeset.isPending}>
          {counts ? `Apply ${plural(counts.ok, 'change')}` : 'Apply changes'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </EditPanel>
  )
}
