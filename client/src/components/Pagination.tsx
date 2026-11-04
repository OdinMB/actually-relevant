import { FOCUS_RING } from '../lib/control-classes'

/** Previous and Next. */
const STEP_BUTTON = `px-3 py-2 text-sm rounded border border-neutral-200 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING}`

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export default function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages: (number | '...')[] = []
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i)
    } else if (pages[pages.length - 1] !== '...') {
      pages.push('...')
    }
  }

  return (
    <nav aria-label="Pagination" className="flex items-center justify-center gap-1 mt-8">
      <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className={STEP_BUTTON} aria-label="Previous page">
        Previous
      </button>

      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`ellipsis-${i}`} className="px-2 text-neutral-500">
            ...
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`px-3 py-2 text-sm rounded border ${FOCUS_RING} ${
              // White text on brand-700 is 6.6:1; on brand-500 it would be 4.0:1, under the 4.5:1 small text needs.
              // A white gap keeps the brand-500 ring off the brand-700 fill, which it barely differs from.
              p === page ? 'bg-brand-700 text-white border-brand-700 focus-visible:ring-offset-2' : 'border-neutral-200 hover:bg-neutral-50'
            }`}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        ),
      )}

      <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className={STEP_BUTTON} aria-label="Next page">
        Next
      </button>
    </nav>
  )
}
