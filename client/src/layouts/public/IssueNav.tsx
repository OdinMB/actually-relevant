import { Link, useLocation } from 'react-router-dom'
import { getCategoryColor } from '../../lib/category-colors'
import { ISSUE_LINKS, isActiveIssue } from './navLinks'
import { SearchIcon } from './icons'

interface IssueNavProps {
  searchOpen: boolean
  onToggleSearch: () => void
}

/** Desktop issue category bar, with the search toggle as its first item. */
export default function IssueNav({ searchOpen, onToggleSearch }: IssueNavProps) {
  const { pathname } = useLocation()

  return (
    <nav className="hidden lg:block border-b border-neutral-200" aria-label="Issue categories">
      <ul className="max-w-6xl mx-auto px-4 flex items-center justify-center gap-0">
        {/* Search button as first item */}
        <li>
          <button
            onClick={onToggleSearch}
            className={`issue-nav-link ${searchOpen ? '!text-brand-700' : ''}`}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            aria-expanded={searchOpen}
            aria-controls="search-panel"
          >
            <SearchIcon className="w-5 h-5" />
          </button>
        </li>
        {ISSUE_LINKS.map(link => {
          const colors = getCategoryColor(link.slug)
          const active = isActiveIssue(pathname, link.href)
          return (
            <li key={link.href}>
              <Link to={link.href} className="issue-nav-link" data-active={active} style={{ '--issue-color': colors.hex } as React.CSSProperties}>
                <span className={`w-2.5 h-2.5 rounded-full -translate-y-px ${colors.dotBg} ${active ? 'opacity-100' : 'opacity-60'}`} aria-hidden="true" />
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
