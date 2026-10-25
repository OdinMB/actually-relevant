import { useLayoutEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { API_BASE } from '../lib/api'
import SubscribeProvider from '../components/SubscribeProvider'
import FeedbackProvider from '../components/FeedbackProvider'
import { PositivityProvider } from '../contexts/PositivityContext'
import SiteHeader from './public/SiteHeader'
import SiteFooter from './public/SiteFooter'
import { CategoryColorStrip } from './public/icons'

export default function PublicLayout() {
  return (
    <PositivityProvider>
      <SubscribeProvider>
        <FeedbackProvider>
          <PublicLayoutInner />
        </FeedbackProvider>
      </SubscribeProvider>
    </PositivityProvider>
  )
}

function PublicLayoutInner() {
  const { pathname } = useLocation()

  // Scroll to top on route change
  useLayoutEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <link rel="alternate" type="application/rss+xml" title="Actually Relevant RSS Feed" href={`${API_BASE}/feed`} />
      </Helmet>

      {/* Skip to content */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-4 focus:py-2 focus:rounded focus:shadow-lg focus:text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        Skip to content
      </a>

      <SiteHeader />

      {/* Category color strip — mobile only */}
      <CategoryColorStrip className="lg:hidden" />

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>

      <SiteFooter />
    </div>
  )
}
