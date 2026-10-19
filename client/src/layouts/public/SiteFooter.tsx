import { Link } from "react-router-dom";
import { getCategoryColor } from "../../lib/category-colors";
import { API_BASE } from "../../lib/api";
import {
  BRAND,
  BLUESKY_PROFILE_URL,
  GITHUB_REPO_URL,
  KOFI_URL,
  MASTODON_PROFILE_URL,
} from "../../config";
import { FOOTER_LEGAL, FOOTER_NAV, ISSUE_LINKS } from "./navLinks";
import { CategoryColorStrip, PodcastIcon } from "./icons";

/** Social icon buttons (Bluesky, Mastodon, GitHub) in the brand column. */
const SOCIAL_LINK =
  "flex items-center justify-center w-8 h-8 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-brand-500";

/** Links in the Connect column; the image icons brighten with the text on hover (`group`). */
const CONNECT_LINK =
  "group inline-flex items-center gap-1.5 text-sm leading-5 text-neutral-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5";

const CONNECT_ICON =
  "w-3.5 h-3.5 shrink-0 transition-[filter] group-hover:brightness-[10]";

const INLINE_LINK =
  "hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded";

const LEGAL_LINK =
  "text-xs text-neutral-400 hover:text-neutral-200 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5";

const COLUMN_HEADING =
  "text-xs font-bold uppercase tracking-widest text-neutral-400 mb-3 leading-none";

function LegalLinks({ className }: { className: string }) {
  return (
    <ul className={className}>
      {FOOTER_LEGAL.map((link) => (
        <li key={link.label}>
          <Link
            to={link.href}
            className={LEGAL_LINK}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Copyright({ className }: { className: string }) {
  return (
    <p className={className}>
      &copy; {new Date().getFullYear()} Actually Relevant. All rights
      reserved.
    </p>
  );
}

export default function SiteFooter() {
  return (
    <footer className="bg-neutral-900 text-neutral-300">
      {/* Editorial sign-off, first in the footer so it sits inside a landmark (axe "region").
          The AI statement stays readable by screen readers (AI Act Art. 50(5)); only the ornament is hidden. */}
      <div className="bg-neutral-50 border-t border-neutral-200 py-10 md:py-14 text-center">
        <div className="max-w-md mx-auto px-4">
          <div className="flex items-center justify-center gap-4 mb-4" aria-hidden="true">
            <span className="flex-1 border-t border-neutral-200" />
            <span className="text-brand-300 text-sm">&#9670;</span>
            <span className="flex-1 border-t border-neutral-200" />
          </div>
          <p className="text-lg italic text-neutral-500 leading-relaxed">
            {BRAND.claimSupport}
          </p>
        </div>
      </div>

      {/* Category color strip */}
      <CategoryColorStrip />

      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-5 md:gap-10">
          {/* Brand column */}
          <div className="col-span-2">
            <Link
              to="/"
              className="inline-block mb-3 font-nexa text-xl font-bold text-white hover:text-brand-300 transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded"
            >
              Actually Relevant
            </Link>
            <p className="text-sm text-neutral-400 leading-relaxed max-w-sm">
              {BRAND.claim}
            </p>
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
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={SOCIAL_LINK}
                aria-label="View source on GitHub (opens in new tab)"
              >
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
            <ul className="grid auto-rows-[1.25rem] gap-y-2">
              {FOOTER_NAV.map((link) => (
                <li key={link.label} className="flex items-center">
                  <Link
                    to={link.href}
                    className="text-sm leading-5 text-neutral-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5"
                  >
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
            <ul className="grid auto-rows-[1.25rem] gap-y-2">
              <li className="flex items-center">
                <Link
                  to="/newsletter"
                  className={CONNECT_LINK}
                >
                  <img src="/images/optimized/icons/newsletter-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Newsletter
                </Link>
              </li>
              <li className="flex items-center">
                <Link
                  to="/podcast"
                  className="inline-flex items-center gap-1.5 text-sm leading-5 text-neutral-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5"
                >
                  <PodcastIcon className="w-3.5 h-3.5 shrink-0" />
                  Podcast
                </Link>
              </li>
              <li className="flex items-center">
                <a
                  href={`${API_BASE}/feed`}
                  className={CONNECT_LINK}
                >
                  <img src="/images/optimized/icons/rss-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  RSS Feed
                </a>
              </li>
              <li className="flex items-center">
                <Link
                  to="/widgets"
                  className={CONNECT_LINK}
                >
                  <img src="/images/optimized/icons/code-embed-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  For Your Website
                </Link>
              </li>
              <li className="flex items-center">
                <span className="text-sm leading-5 text-neutral-400 px-0.5">
                  <img src="/images/optimized/icons/code-api-thumb-w.webp" alt="" width={14} height={14} className="inline-block w-3.5 h-3.5 shrink-0 mr-1.5 -mt-0.5" aria-hidden="true" />
                  <Link to="/free-api" className={INLINE_LINK}>Free API</Link> (<Link to="/free-api" className={INLINE_LINK}>Intro</Link>, <Link to="/developers" className={INLINE_LINK}>Docs</Link>)
                </span>
              </li>
              <li className="flex items-center">
                <Link
                  to="/stewardship"
                  className={CONNECT_LINK}
                >
                  <img src="/images/optimized/icons/stewardship-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Stewardship
                </Link>
              </li>
              <li className="flex items-center">
                <a
                  href={KOFI_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={CONNECT_LINK}
                >
                  <img src="/images/optimized/icons/heart-thumb-w.webp" alt="" width={14} height={14} className={CONNECT_ICON} aria-hidden="true" />
                  Support Us
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              </li>
              <li className="flex items-center">
                <Link
                  to="/feedback"
                  className={CONNECT_LINK}
                >
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
            <ul className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-1 auto-rows-[1.25rem]">
              {ISSUE_LINKS.map((link) => {
                const colors = getCategoryColor(link.slug);
                return (
                  <li key={link.href} className="flex items-center">
                    <Link
                      to={link.href}
                      className="inline-flex items-center gap-2 text-sm leading-5 text-neutral-400 hover:text-white transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 rounded px-0.5"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${colors.dotBg} opacity-70 shrink-0`}
                        aria-hidden="true"
                      />
                      {link.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Legal links + copyright — mobile only */}
        <div className="mt-7 md:hidden text-center">
          <LegalLinks className="flex justify-center gap-5" />
          <Copyright className="text-xs text-neutral-400 mt-3" />
        </div>
      </div>
    </footer>
  );
}
