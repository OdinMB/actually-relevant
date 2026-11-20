import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import type { AdminOverviewDetail } from '@shared/types'
import { useOverview, useOverviewAction } from '../../hooks/useOverviews'
import { adminApi, ApiError } from '../../lib/admin-api'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Input } from '../../components/ui/Input'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { ErrorState } from '../../components/ui/ErrorState'
import { EmptyState } from '../../components/ui/EmptyState'
import { Badge } from '../../components/ui/Badge'
import { OverviewCharter } from '../../components/admin/OverviewCharter'
import { OverviewFlags, StepOffNote } from '../../components/admin/OverviewFlags'
import { OverviewEntries } from '../../components/admin/OverviewEntries'
import { OverviewStands } from '../../components/admin/OverviewStands'
import { OverviewDecisionLog, OverviewStatusHistory } from '../../components/admin/OverviewDecisionLog'
import { SCOPE_LABELS, STATUS_LABELS } from '../../components/admin/overviewLabels'

/*
 * `/admin/overviews/:id` (`.context/overviews.md`, "Admin"): an overview's title, flags and the
 * editor's actions on it (retitle, freeze, hide, close and reopen), its charter with "Edit charter"
 * (`OverviewCharter`), entries, "Where this stands" versions, status history and decision log with
 * Undo. Every action is logged and undoable.
 */

const TITLE_MAX = 200

export default function OverviewDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: overview, isLoading, error, refetch } = useOverview(id)
  const notFound = error instanceof ApiError && error.status === 404

  return (
    <>
      <Helmet>
        <title>{overview?.title || 'Overview'} — Admin — Actually Relevant</title>
      </Helmet>

      <div className="mb-4">
        <Link
          to="/admin/overviews"
          className="inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" /> Back to Overviews
        </Link>
      </div>

      {isLoading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}
      {notFound && <EmptyState title="Overview not found" description="It may have been deleted." />}
      {error && !notFound && <ErrorState message="Failed to load the overview" onRetry={() => refetch()} />}
      {overview && <OverviewDetail overview={overview} />}
    </>
  )
}

function OverviewDetail({ overview: o }: { overview: AdminOverviewDetail }) {
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">{o.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
          <Badge variant="purple">{SCOPE_LABELS[o.scope]}</Badge>
          <Badge variant={o.status === 'closed' ? 'gray' : 'blue'}>{STATUS_LABELS[o.status]}</Badge>
          <OverviewFlags overview={o} />
        </p>
      </div>
      {!o.on && <StepOffNote />}
      <OverviewActions overview={o} />
      <OverviewCharter overview={o} />
      <OverviewEntries overview={o} />
      <OverviewStands versions={o.stands} />
      <OverviewStatusHistory decisions={o.statusHistory} />
      <OverviewDecisionLog decisions={o.decisions} total={o.decisionsTotal} />
    </div>
  )
}

/** The editor's actions on the overview itself; each one is a logged decision Undo can reverse. */
function OverviewActions({ overview: o }: { overview: AdminOverviewDetail }) {
  const action = useOverviewAction()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(o.title)
  const [confirmClose, setConfirmClose] = useState(false)
  const trimmed = title.trim()
  const titleError = trimmed.length === 0 ? 'A title is needed' : trimmed.length > TITLE_MAX ? `At most ${TITLE_MAX} characters` : undefined

  const retitle = (e: FormEvent) => {
    e.preventDefault()
    if (titleError) return
    action.mutate({ run: () => adminApi.overviews.retitle(o.id, trimmed), done: 'Overview retitled' }, { onSuccess: () => setEditing(false) })
  }

  if (editing)
    return (
      <form onSubmit={retitle} noValidate className="flex max-w-2xl flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input id="overview-title" label="Title" value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} error={titleError} autoFocus />
        </div>
        <div className="flex gap-2 pt-6">
          <Button type="submit" size="sm" loading={action.isPending} disabled={!!titleError}>
            Save title
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setTitle(o.title)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    )

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Overview actions">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setTitle(o.title)
          setEditing(true)
        }}
      >
        Retitle
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={action.isPending}
        onClick={() => action.mutate({ run: () => adminApi.overviews.setFrozen(o.id, !o.frozen), done: o.frozen ? 'Overview unfrozen' : 'Overview frozen' })}
      >
        {o.frozen ? 'Unfreeze' : 'Freeze'}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({
            run: () => adminApi.overviews.setHidden(o.id, !o.hidden),
            done: o.hidden ? 'Overview shown to readers' : 'Overview hidden from readers',
          })
        }
      >
        {o.hidden ? 'Show to readers' : 'Hide from readers'}
      </Button>
      {o.status === 'closed' ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={action.isPending}
          onClick={() => action.mutate({ run: () => adminApi.overviews.setClosed(o.id, false), done: 'Overview reopened' })}
        >
          Reopen
        </Button>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmClose(true)}>
          Close
        </Button>
      )}
      <ConfirmDialog
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={() =>
          action.mutate({ run: () => adminApi.overviews.setClosed(o.id, true), done: 'Overview closed' }, { onSettled: () => setConfirmClose(false) })
        }
        title="Close this overview?"
        description="No story joins it while it is closed, and the pipeline never reopens it. Reopen, or Undo in the log, brings it back."
        confirmLabel="Close overview"
        variant="danger"
        loading={action.isPending}
      />
    </div>
  )
}
