import { useEffect, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { publicApi } from '../lib/api'
import { formatRelativeTime } from '../lib/constants'
import AiLabel from '../components/ai/AiLabel'
import { AI_DISCLOSURE_COPY } from '../components/ai/aiDisclosureCopy'
import { SITE_URL } from '../config'
import { UPLIFTING_MIX, parseMixParam } from '../contexts/PositivityContext'
import { mixHomepageStories } from '../lib/mix-stories'

/**
 * The embed's stories. Without a mix, the newest ones. At "Only uplifting", only uplifting ones.
 * At the other positions, the homepage's mix of positive (uplifting, calm) and negative stories,
 * picked from the newest `MIX_POOL` in one request, as `public/widget.js` does; untagged stories
 * are left out, as on the homepage.
 */
export async function loadEmbedStories({ count, issue, mix }: { count: number; issue?: string; mix: number | null }) {
  const list = (pageSize: number, emotionTags?: string) => publicApi.stories.list({ page: 1, pageSize, issueSlug: issue, emotionTags })
  if (mix === null) return list(count)
  if (mix === UPLIFTING_MIX) return list(count, 'uplifting')
  const pool = (await list(MIX_POOL)).data
  const tagged = (...tags: string[]) => pool.filter(s => s.emotionTag !== null && tags.includes(s.emotionTag))
  return { data: mixHomepageStories({ uplifting: tagged('uplifting', 'calm'), calm: [], negative: tagged('frustrating', 'scary') }, count, mix) }
}

const MIX_POOL = 50

export default function EmbedPage() {
  const [params] = useSearchParams()
  const count = Math.min(5, Math.max(1, parseInt(params.get('count') || '3', 10) || 3))
  const issue = params.get('issue') || undefined
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const showSummary = params.get('summary') === 'true'
  // The Mood Dial's `mix`, as the site reads it; `mood=uplifting` is the older spelling of mix=uplifting
  const mix = parseMixParam(params.get('mix')) ?? (params.get('mood') === 'uplifting' ? UPLIFTING_MIX : null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['embed-stories', issue, count, mix],
    queryFn: () => loadEmbedStories({ count, issue, mix }),
  })

  // Post height to parent for auto-resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        window.parent.postMessage({ type: 'ar-embed-resize', height: containerRef.current.scrollHeight }, '*')
      }
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  const isDark = theme === 'dark'

  // Set html/body background to match theme so iframe has no white gap
  useEffect(() => {
    const bg = isDark ? '#171717' : '#ffffff' // neutral-900 / white
    document.documentElement.style.background = bg
    document.body.style.background = bg
    return () => {
      document.documentElement.style.background = ''
      document.body.style.background = ''
    }
  }, [isDark])

  return (
    <main ref={containerRef} className={`font-sans text-sm leading-relaxed ${isDark ? 'bg-neutral-900 text-neutral-200' : 'bg-white text-neutral-700'}`}>
      <h1 className="sr-only">Actually Relevant Stories</h1>
      {/* AI label at the top of the embed, which shows AI headlines on other people's sites (AI Act Art. 50(4)) */}
      <p className={`px-4 py-2 border-b text-[12px] ${isDark ? 'border-neutral-700 text-neutral-300' : 'border-neutral-200 text-neutral-600'}`}>
        <AiLabel text={AI_DISCLOSURE_COPY.embedHeader} />
      </p>
      {isLoading && <div className={`px-4 py-8 text-center text-[13px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>Loading...</div>}

      {isError && <div className="px-4 py-8 text-center text-[13px] text-red-500">Could not load stories</div>}

      {data && data.data.length === 0 && (
        <div className={`px-4 py-8 text-center text-[13px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>No stories available</div>
      )}

      {data && data.data.length > 0 && (
        <ul className={`divide-y ${isDark ? 'divide-neutral-700' : 'divide-neutral-200'}`}>
          {data.data.map(story => (
            <li key={story.id}>
              <Link
                to={`/stories/${story.slug || story.id}`}
                target="_blank"
                className={`block px-4 py-2.5 transition-colors ${isDark ? 'hover:bg-neutral-800' : 'hover:bg-neutral-50'}`}
              >
                <p className="font-medium text-[14px] mb-0.5">
                  {story.titleLabel ? `${story.titleLabel}: ` : ''}
                  {story.title || story.sourceTitle}
                </p>
                {/* A researched story has no relevance summary: its summary stands in, as on StoryCard */}
                {showSummary && (story.relevanceSummary || story.summary) && (
                  <p className={`text-[12px] leading-relaxed mb-1 ${isDark ? 'text-neutral-300' : 'text-neutral-600'}`}>
                    {story.relevanceSummary || story.summary}
                  </p>
                )}
                <span className={`text-[12px] ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>
                  {story.feed?.displayTitle || story.feed?.title}
                  {story.datePublished && ` \u00b7 ${formatRelativeTime(story.datePublished)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className={`px-4 py-2 border-t flex items-center justify-center ${isDark ? 'border-neutral-700' : 'border-neutral-200'}`}>
        <a
          href={SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 text-[11px] ${isDark ? 'text-neutral-500 hover:text-neutral-300' : 'text-neutral-500 hover:text-neutral-700'}`}
        >
          <img src={`${SITE_URL}/images/logo-no-text-square.png`} alt="" className="w-5 h-5 rounded-sm" aria-hidden="true" />
          Powered by Actually Relevant
        </a>
      </div>
    </main>
  )
}
