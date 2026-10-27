import { Link } from 'react-router-dom'
import { getCategoryColor } from '../../lib/category-colors'
import { API_BASE } from '../../lib/api'
import { APPLE_PODCASTS_URL, BRAND, BLUESKY_PROFILE_URL, GITHUB_REPO_URL, KOFI_URL, MASTODON_PROFILE_URL } from '../../config'
import { FOOTER_LEGAL, FOOTER_NAV, ISSUE_LINKS } from './navLinks'
import { CategoryColorStrip, PodcastIcon } from './icons'

/*
 * Tap targets (WCAG 2.2 target size, 2.5.8): every footer link is at least 24px tall. The list
 * links are 32px tall on phones and 28px from `md` up, with the text centered. The lists have no
 * row gap and no fixed row height, so the space between two lines of text belongs to a link while
 * the spacing looks as it did, and a label that wraps (narrow phones, the five columns at `md`)
 * grows its row instead of overlapping the next link. `min-h-*` needs a box: hence `inline-flex`.
 */
const LINK_TARGET = 'inline-flex items-center min-h-8 md:min-h-7 py-1'

/** Social icon buttons (Bluesky, Mastodon, Apple Podcasts, GitHub) in the brand column. */
const SOCIAL_LINK =
  'flex items-center justify-center w-8 h-8 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-brand-500'

/** Links in the Navigate, Connect and Issues columns. */
const LIST_LINK = `${LINK_TARGET} text-sm leading-5 text-neutral-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5`

/** Links in the Connect column; the image icons brighten with the text on hover (`group`). */
const CONNECT_LINK = `group gap-1.5 ${LIST_LINK}`

const CONNECT_ICON = 'w-3.5 h-3.5 shrink-0 transition-[filter] group-hover:brightness-[10]'

/** The links inside the "Free API (Intro, Docs)" line: inline boxes, so the line reads as before. */
const INLINE_LINK = `${LINK_TARGET} hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded`

/** 32px tall on phones like the list links; 24px from `md` up, where they sit under the social icons. */
const LEGAL_LINK =
  'inline-flex items-center min-h-8 md:min-h-6 text-xs text-neutral-400 hover:text-neutral-200 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5'

/** The bottom margin allows for the space `LINK_TARGET` adds above the first link's text. */
const COLUMN_HEADING = 'text-xs font-bold uppercase tracking-widest text-neutral-400 mb-1.5 md:mb-2 leading-none'

function LegalLinks({ className }: { className: string }) {
  return (
    <ul className={className}>
      {FOOTER_LEGAL.map(link => (
        <li key={link.label}>
          <Link to={link.href} className={LEGAL_LINK}>
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function Copyright({ className }: { className: string }) {
  return <p className={className}>&copy; {new Date().getFullYear()} Actually Relevant. All rights reserved.</p>
}

export default function SiteFooter() {
  return (
    <footer className="bg-neutral-900 text-neutral-300">
      {/* Category color strip */}
      <CategoryColorStrip />

      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-5 md:gap-10">
          {/* Brand column */}
          <div className="col-span-2">
            <Link
              to="/"
              className="inline-block min-h-7 mb-3 font-nexa text-xl font-bold text-white hover:text-brand-300 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              Actually Relevant
            </Link>
            <p className="text-sm text-neutral-400 leading-relaxed max-w-sm">{BRAND.claim}</p>
            <div className="flex gap-2 mt-4">
              <a
                href={BLUESKY_PROFILE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={SOCIAL_LINK}
                aria-label="Follow us on Bluesky (opens in new tab)"
              >
                <img src="/images/optimized/social/bluesky-thumb-w.webp" alt="" width={18} height={18} className="w-[18px] h-[18px]" aria-hidden="true" />
              </a>
              <a
                href={MASTODON_PROFILE_URL}
                target="_blank"
                rel="noopener noreferrer me"
                className={SOCIAL_LINK}
                aria-label="Follow us on Mastodon (opens in new tab)"
              >
                <img src="/images/optimized/social/mastodon-thumb-w.webp" alt="" width={18} height={18} className="w-[18px] h-[18px]" aria-hidden="true" />
              </a>
              <a
                href={APPLE_PODCASTS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={SOCIAL_LINK}
                aria-label="Listen on Apple Podcasts (opens in new tab)"
              >
                {/* Apple Podcasts glyph from Simple Icons (CC0) */}
                <svg className="w-[18px] h-[18px] text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.224 1.272 1.912 2.619 2.264 4.392.12.59.12 2.2.007 2.864a8.506 8.506 0 01-3.24 5.296c-.608.46-2.096 1.261-2.336 1.261-.088 0-.096-.091-.056-.46.072-.592.144-.715.48-.856.536-.224 1.448-.874 2.008-1.435a7.644 7.644 0 002.008-3.536c.208-.824.184-2.656-.048-3.504-.728-2.696-2.928-4.792-5.624-5.352-.784-.16-2.208-.16-3 0-2.728.56-4.984 2.76-5.672 5.528-.184.752-.184 2.584 0 3.336.456 1.832 1.64 3.512 3.192 4.512.304.2.672.408.824.472.336.144.408.264.472.856.04.36.03.464-.056.464-.056 0-.464-.176-.896-.384l-.04-.03c-2.472-1.216-4.056-3.274-4.632-6.012-.144-.706-.168-2.392-.03-3.04.36-1.74 1.048-3.1 2.192-4.304 1.648-1.737 3.768-2.656 6.128-2.656zm.134 2.81c.409.004.803.04 1.106.106 2.784.62 4.76 3.408 4.376 6.174-.152 1.114-.536 2.03-1.216 2.88-.336.43-1.152 1.15-1.296 1.15-.023 0-.048-.272-.048-.603v-.605l.416-.496c1.568-1.878 1.456-4.502-.256-6.224-.664-.67-1.432-1.064-2.424-1.246-.64-.118-.776-.118-1.448-.008-1.02.167-1.81.562-2.512 1.256-1.72 1.704-1.832 4.342-.264 6.222l.413.496v.608c0 .336-.027.608-.06.608-.03 0-.264-.16-.512-.36l-.034-.011c-.832-.664-1.568-1.842-1.872-2.997-.184-.698-.184-2.024.008-2.72.504-1.878 1.888-3.335 3.808-4.019.41-.145 1.133-.22 1.814-.211zm-.13 2.99c.31 0 .62.06.844.178.488.253.888.745 1.04 1.259.464 1.578-1.208 2.96-2.72 2.254h-.015c-.712-.331-1.096-.956-1.104-1.77 0-.733.408-1.371 1.112-1.745.224-.117.534-.176.844-.176zm-.011 4.728c.988-.004 1.706.349 1.97.97.198.464.124 1.932-.218 4.302-.232 1.656-.36 2.074-.68 2.356-.44.39-1.064.498-1.656.288h-.003c-.716-.257-.87-.605-1.164-2.644-.341-2.37-.416-3.838-.218-4.302.262-.616.974-.966 1.97-.97z" />
                </svg>
              </a>
              <a href={GITHUB_REPO_URL} target="_blank" rel="noopener noreferrer" className={SOCIAL_LINK} aria-label="View source on GitHub (opens in new tab)">
                <svg className="w-[18px] h-[18px] text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>
            </div>
            <LegalLinks className="hidden md:flex gap-4 mt-4" />
            <Copyright className="hidden md:block text-xs text-neutral-400 mt-2" />
          </div>

          {/* Navigation column */}
          <div>
            <p className={COLUMN_HEADING} role="presentation">
              Navigate
            </p>
            <ul className="grid">
              {FOOTER_NAV.map(link => (
                <li key={link.label} className="flex items-center">
                  <Link to={link.href} className={LIST_LINK}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect column */}
          <div>
            <p className={COLUMN_HEADING} role="presentation">
              Connect
            </p>
            <ul className="grid">
              <li className="flex items-center">
                <Link to="/newsletter" className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/newsletter-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Newsletter
                </Link>
              </li>
              <li className="flex items-center">
                <Link to="/podcast" className={CONNECT_LINK}>
                  <PodcastIcon className="w-3.5 h-3.5 shrink-0" />
                  Podcast
                </Link>
              </li>
              <li className="flex items-center">
                <a href={`${API_BASE}/feed`} className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/rss-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  RSS Feed
                </a>
              </li>
              <li className="flex items-center">
                <Link to="/widgets" className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/code-embed-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  For Your Website
                </Link>
              </li>
              <li className="flex items-center">
                <span className="text-sm leading-5 text-neutral-400 px-0.5">
                  <img
                    src="/images/optimized/icons/code-api-thumb-w.webp"
                    alt=""
                    width={14}
                    height={14}
                    className="inline-block w-3.5 h-3.5 shrink-0 mr-1.5 -mt-0.5"
                    aria-hidden="true"
                  />
                  <Link to="/free-api" className={INLINE_LINK}>
                    Free API
                  </Link>{' '}
                  (
                  <Link to="/free-api" className={INLINE_LINK}>
                    Intro
                  </Link>
                  ,{' '}
                  <Link to="/developers" className={INLINE_LINK}>
                    Docs
                  </Link>
                  )
                </span>
              </li>
              <li className="flex items-center">
                <Link to="/stewardship" className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/stewardship-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Stewardship
                </Link>
              </li>
              <li className="flex items-center">
                <a href={KOFI_URL} target="_blank" rel="noopener noreferrer" className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/heart-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Support Us
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              </li>
              <li className="flex items-center">
                <Link to="/feedback" className={CONNECT_LINK}>
                  <img src="/images/optimized/icons/feedback-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Feedback
                </Link>
              </li>
            </ul>
          </div>

          {/* Issues column */}
          <div className="col-span-2 md:col-span-1">
            <p className={COLUMN_HEADING} role="presentation">
              Issues
            </p>
            <ul className="grid grid-cols-2 gap-x-6 md:grid-cols-1">
              {ISSUE_LINKS.map(link => {
                const colors = getCategoryColor(link.slug)
                return (
                  <li key={link.href} className="flex items-center">
                    <Link to={link.href} className={`gap-2 ${LIST_LINK}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${colors.dotBg} opacity-70 shrink-0`} aria-hidden="true" />
                      {link.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Legal links + copyright — mobile only */}
        <div className="mt-5 md:hidden text-center">
          <LegalLinks className="flex justify-center gap-5" />
          <Copyright className="text-xs text-neutral-400 mt-2" />
        </div>
      </div>
    </footer>
  )
}
