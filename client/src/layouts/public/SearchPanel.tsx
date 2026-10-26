import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { SearchIcon } from './icons'

interface SearchPanelProps {
  query: string
  onQueryChange: (query: string) => void
  onClose: () => void
}

/**
 * The search bar under the header, mounted only while search is open. The
 * query lives in the header so it survives closing and reopening the panel.
 */
export default function SearchPanel({ query, onQueryChange, onClose }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Escape clears the query first, then closes the panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (query) {
          onQueryChange('')
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [query, onQueryChange, onClose])

  // Auto-focus the input when the panel opens
  useEffect(() => {
    // Small delay to allow the DOM to render
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  return (
    <div id="search-panel" className="bg-white border-b border-neutral-200 shadow-lg">
      <div className="max-w-3xl mx-auto px-4 py-4">
        <form
          onSubmit={e => {
            e.preventDefault()
            if (query.trim()) {
              navigate(`/search?q=${encodeURIComponent(query.trim())}`)
              onClose()
            }
          }}
          className="relative"
        >
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search stories..."
            className="w-full pl-10 pr-10 py-3 text-base border border-neutral-300 rounded-lg bg-neutral-50 focus:bg-white focus:border-brand-400 focus:ring-2 focus:ring-brand-200 outline-none transition-colors"
            aria-label="Search stories"
          />
          <button
            type="button"
            onClick={() => {
              if (query) onQueryChange('')
              else onClose()
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-600 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            aria-label="Close search"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </form>
        <p className="text-xs text-neutral-400 mt-2 text-center">Search by meaning, not just keywords.</p>
      </div>
    </div>
  )
}
