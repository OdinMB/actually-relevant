import { useState, type FormEvent } from 'react'
import type { Podcast, PodcastEpisodeStory, PodcastStoryCandidate, PodcastStoryFilters } from '@shared/types'
import { Button } from '../ui/Button'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import { ApiError } from '../../lib/admin-api'
import { useIssues } from '../../hooks/useIssues'
import { usePodcastStorySearch, useSuggestPodcastStories } from '../../hooks/usePodcasts'
import { moveStory, usePodcastStoryDraft } from './podcastStoryDraft'
import { StoryDraftErrors, StoryDraftFooter } from './PodcastStoryDraftControls'

const PAGE_SIZE = 20
const INPUT = 'rounded-md border border-neutral-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500'

/** What the chosen list shows of a story. */
type StoryFacts = Pick<PodcastEpisodeStory, 'id' | 'title' | 'publisher' | 'issue'>

interface FilterForm {
  from: string
  to: string
  issueId: string
  search: string
}

const EMPTY_FORM: FilterForm = { from: '', to: '', issueId: '', search: '' }

/** The form's dates as whole UTC days, and only the filters that are set. */
export function toStoryFilters(form: FilterForm): PodcastStoryFilters {
  return {
    ...(form.from ? { crawledAfter: `${form.from}T00:00:00.000Z` } : {}),
    ...(form.to ? { crawledBefore: `${form.to}T23:59:59.999Z` } : {}),
    ...(form.issueId ? { issueId: form.issueId } : {}),
    ...(form.search.trim() ? { search: form.search.trim() } : {}),
  }
}

function StoryLine({ story }: { story: StoryFacts | undefined }) {
  if (!story) return <span className="text-neutral-500 italic">Unknown story</span>
  return (
    <span>
      <span className="text-neutral-900">{story.title}</span>{' '}
      <span className="text-neutral-500">({story.publisher}, {story.issue})</span>
    </span>
  )
}

function suggestErrorMessage(err: unknown): string {
  const body = err instanceof ApiError ? (err.body as { errors?: string[] } | undefined) : undefined
  return body?.errors?.join(' ') ?? (err instanceof Error ? err.message : 'Failed to suggest stories')
}

interface PodcastStoryFinderProps {
  podcast: Podcast
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Choosing a standalone episode's stories from all published stories: filters (when the story was
 * found, its issue, a text search), paginated results to add from, "Suggest stories" (the AI's
 * proposal from the filtered stories, which replaces the draft), and the chosen list in episode order.
 */
export function PodcastStoryFinder({ podcast, onDirtyChange }: PodcastStoryFinderProps) {
  const draft = usePodcastStoryDraft(podcast, onDirtyChange)
  const { chosen, setChosen } = draft
  const issues = useIssues()
  const suggest = useSuggestPodcastStories()
  const [form, setForm] = useState<FilterForm>(EMPTY_FORM)
  const [filters, setFilters] = useState<PodcastStoryFilters>({})
  const [page, setPage] = useState(1)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  // Facts of every story seen, so the chosen list names stories that are not on the current page.
  const [facts, setFacts] = useState<Map<string, StoryFacts>>(() => new Map((podcast.episodeStories ?? []).map(s => [s.id, s])))
  const results = usePodcastStorySearch(filters, page, PAGE_SIZE)

  const remember = (stories: PodcastStoryCandidate[]) => setFacts(prev => new Map([...prev, ...stories.map(s => [s.id, s] as const)]))
  const minStories = results.data?.minStories ?? 4
  const maxStories = results.data?.maxStories ?? 5
  const countOk = chosen.length >= minStories && chosen.length <= maxStories

  const applyFilters = (e: FormEvent) => {
    e.preventDefault()
    setFilters(toStoryFilters(form))
    setPage(1)
  }

  const add = (story: PodcastStoryCandidate) => {
    remember([story])
    setChosen([...chosen, story.id])
  }

  const handleSuggest = () => {
    setSuggestError(null)
    suggest.mutate({ id: podcast.id, filters }, {
      onSuccess: ({ stories }) => {
        remember(stories)
        setChosen(stories.map(s => s.id))
      },
      onError: err => setSuggestError(suggestErrorMessage(err)),
    })
  }

  return (
    <section aria-labelledby="podcast-stories-heading" className="bg-white rounded-lg border border-neutral-200 p-4 space-y-4">
      <div>
        <h2 id="podcast-stories-heading" className="text-sm font-semibold text-neutral-900">Choose this episode&apos;s stories</h2>
        <p className="text-xs text-neutral-600 mt-1">
          {minStories} to {maxStories} published stories from any date, in the order they are discussed. Suggest stories lets the AI pick from the stories that match your filters.
        </p>
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3" aria-label="Story filters">
        <div className="flex flex-col gap-1">
          <label htmlFor="finder-from" className="text-xs font-medium text-neutral-700">Found from</label>
          <input id="finder-from" type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="finder-to" className="text-xs font-medium text-neutral-700">Found until</label>
          <input id="finder-to" type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} className={INPUT} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="finder-issue" className="text-xs font-medium text-neutral-700">Topic</label>
          <select id="finder-issue" value={form.issueId} onChange={e => setForm({ ...form, issueId: e.target.value })} className={INPUT}>
            <option value="">All topics</option>
            {(issues.data ?? []).map(issue => (
              <option key={issue.id} value={issue.id}>{issue.parent ? `${issue.parent.name}: ${issue.name}` : issue.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <label htmlFor="finder-search" className="text-xs font-medium text-neutral-700">Search</label>
          <input id="finder-search" type="search" value={form.search} onChange={e => setForm({ ...form, search: e.target.value })} className={INPUT} />
        </div>
        <Button type="submit" size="sm" variant="secondary">Apply filters</Button>
        <Button type="button" size="sm" variant="secondary" onClick={handleSuggest} loading={suggest.isPending}>Suggest stories</Button>
      </form>
      {suggestError && <p role="alert" className="text-sm text-red-700">{suggestError}</p>}

      <div>
        <h3 className="text-sm font-medium text-neutral-800">Chosen ({chosen.length})</h3>
        {chosen.length === 0
          ? <p className="mt-1 text-sm italic text-neutral-500">No stories chosen yet.</p>
          : (
            <ol className="mt-2 space-y-2" aria-label="Chosen stories">
              {chosen.map((id, i) => (
                <li key={id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-5 text-neutral-500">{i + 1}.</span>
                  <span className="flex-1 min-w-[12rem]"><StoryLine story={facts.get(id)} /></span>
                  <Button variant="ghost" size="sm" onClick={() => setChosen(moveStory(chosen, i, -1))} disabled={i === 0} aria-label={`Move story ${i + 1} up`}>Up</Button>
                  <Button variant="ghost" size="sm" onClick={() => setChosen(moveStory(chosen, i, 1))} disabled={i === chosen.length - 1} aria-label={`Move story ${i + 1} down`}>Down</Button>
                  <Button variant="ghost" size="sm" onClick={() => setChosen(chosen.filter(c => c !== id))} aria-label={`Remove story ${i + 1}`}>Remove</Button>
                </li>
              ))}
            </ol>
          )}
      </div>

      <div>
        <h3 className="text-sm font-medium text-neutral-800">
          Published stories{results.data ? ` (${results.data.total})` : ''}
        </h3>
        <p className="text-xs text-neutral-500">Sorted by relevance rating, highest first, then by date found, newest first.</p>
        {results.isLoading && <div className="flex justify-center py-4"><LoadingSpinner /></div>}
        {results.error && <p role="alert" className="text-sm text-red-700">Failed to load the stories.</p>}
        {results.data && results.data.data.length === 0 && <p className="mt-1 text-sm italic text-neutral-500">No published stories match these filters.</p>}
        {results.data && results.data.data.length > 0 && (
          <ul className="mt-2 space-y-2" aria-label="Matching stories">
            {results.data.data.map(s => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="flex-1 min-w-[12rem]"><StoryLine story={s} /></span>
                <span className="text-xs font-medium text-neutral-700">Rating {s.relevance ?? '—'}</span>
                <span className="text-xs text-neutral-500">{s.dateCrawled.slice(0, 10)}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => add(s)}
                  disabled={chosen.includes(s.id) || chosen.length >= maxStories}
                  aria-label={`Add ${s.title}`}
                >
                  {chosen.includes(s.id) ? 'Added' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {results.data && results.data.totalPages > 1 && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <Button variant="ghost" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>Previous</Button>
            <span className="text-neutral-600">Page {page} of {results.data.totalPages}</span>
            <Button variant="ghost" size="sm" onClick={() => setPage(page + 1)} disabled={page >= results.data.totalPages}>Next</Button>
          </div>
        )}
      </div>

      <StoryDraftErrors errors={draft.errors} />
      <StoryDraftFooter draft={draft} canSave={countOk} />
    </section>
  )
}
