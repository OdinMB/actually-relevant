import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, waitFor, cleanup } from '@testing-library/react'
import { Helmet, HelmetProvider } from 'react-helmet-async'
import { DefaultSeo, SEO } from './seo'

const PAGE_DESCRIPTION = 'A page-specific description.'

/** Load the real index.html <head>, so its fallback tags are what Helmet has to replace. */
function seedTemplateHead() {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
  const head = new DOMParser().parseFromString(html, 'text/html').head
  head.querySelectorAll('script, link').forEach((el) => el.remove())
  document.head.innerHTML = head.innerHTML
}

function contents(selector: string): (string | null)[] {
  return Array.from(document.head.querySelectorAll(selector)).map((el) =>
    el.getAttribute('content'),
  )
}

/** Meta name/property keys present more than once in <head>. */
function duplicateMetaKeys(): string[] {
  const keys = Array.from(document.head.querySelectorAll('meta[name], meta[property]')).map(
    (el) => el.getAttribute('name') ?? el.getAttribute('property') ?? '',
  )
  return [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))]
}

function PageWithOwnTags() {
  return (
    <Helmet>
      <title>Page title</title>
      <meta name="description" content={PAGE_DESCRIPTION} />
      <meta property="og:description" content={PAGE_DESCRIPTION} />
    </Helmet>
  )
}

describe('DefaultSeo with the index.html fallback tags', () => {
  beforeEach(seedTemplateHead)
  afterEach(cleanup)

  it('leaves exactly one description, the page’s own, when the page sets one', async () => {
    render(
      <HelmetProvider>
        <DefaultSeo />
        <PageWithOwnTags />
      </HelmetProvider>,
    )

    await waitFor(() => {
      expect(contents('meta[name="description"]')).toEqual([PAGE_DESCRIPTION])
    })
    expect(contents('meta[property="og:description"]')).toEqual([PAGE_DESCRIPTION])
    expect(contents('meta[property="og:title"]')).toEqual([SEO.defaultTitle])
    expect(contents('meta[name="twitter:card"]')).toEqual([SEO.twitterCard])
    expect(contents('meta[property="og:image"]')).toEqual([SEO.ogImage])
    expect(duplicateMetaKeys()).toEqual([])
    expect(document.head.querySelectorAll('title')).toHaveLength(1)
    expect(document.title).toBe('Page title')
  })

  it('falls back to exactly one generic description when the page sets none', async () => {
    render(
      <HelmetProvider>
        <DefaultSeo />
        <Helmet>
          <title>Untitled page</title>
        </Helmet>
      </HelmetProvider>,
    )

    await waitFor(() => {
      expect(contents('meta[name="description"]')).toEqual([SEO.defaultDescription])
    })
    expect(contents('meta[property="og:description"]')).toEqual([SEO.defaultDescription])
  })

  it('restores the generic description when navigating away from a page that set its own', async () => {
    const { rerender } = render(
      <HelmetProvider>
        <DefaultSeo />
        <PageWithOwnTags />
      </HelmetProvider>,
    )
    await waitFor(() => {
      expect(contents('meta[name="description"]')).toEqual([PAGE_DESCRIPTION])
    })

    rerender(
      <HelmetProvider>
        <DefaultSeo />
      </HelmetProvider>,
    )

    await waitFor(() => {
      expect(contents('meta[name="description"]')).toEqual([SEO.defaultDescription])
    })
  })
})
