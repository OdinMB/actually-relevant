import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'

// renderHtml is pure; the write and the slug it links to are the lifecycle's (newsletterLifecycle.db.test.ts)
const { renderHtml } = await import('./newsletter.js')
const { config } = await import('../config.js')
const NEWSLETTER_TOP_LABEL_TEXT = (await import('../lib/aiLabelCopy.js')).NEWSLETTER_TOP_LABEL.text

describe('renderHtml', () => {
  const baseNewsletter = { title: 'Week 1 — Jan 2025' }
  const render = (content: string) => renderHtml({ ...baseNewsletter, content }, 'https://actuallyrelevant.news/newsletter/week-1')

  /** Helper to build markdown content for a single story */
  function storyBlock(opts: { issue?: string; issueSlug?: string; title: string; publisher: string; url: string; body: string; relevanceUrl?: string }) {
    const lines: string[] = []
    if (opts.issue) {
      const slug = opts.issueSlug || 'general-news'
      lines.push(`# ${opts.issue} {${slug}}`, '')
    }
    const linkParts = [opts.publisher, `[original article](${opts.url})`]
    if (opts.relevanceUrl) linkParts.push(`[relevance analysis](${opts.relevanceUrl})`)
    const links = linkParts.join(' · ')
    lines.push(`## ${opts.title}`, links, '', opts.body)
    return lines.join('\n')
  }

  it('still renders the intro of an issue generated before intros were dropped, before its stories', async () => {
    const content = [
      'Something hopeful happened in climate science.',
      '',
      '---',
      '',
      storyBlock({
        issue: 'Technology',
        issueSlug: 'science-technology',
        title: 'AI makes progress',
        publisher: 'Nature',
        url: 'https://example.com/ai',
        body: 'A major AI advancement.',
      }),
    ].join('\n')

    const html = render(content)

    const introIndex = html.indexOf('Something hopeful happened')
    const storyIndex = html.indexOf('AI makes progress')
    expect(introIndex).toBeGreaterThan(-1)
    expect(storyIndex).toBeGreaterThan(-1)
    expect(introIndex).toBeLessThan(storyIndex)
  })

  it('builds every site link and image from config.siteUrl', async () => {
    const original = config.siteUrl
    config.siteUrl = 'https://staging.example'
    try {
      const content = storyBlock({ issue: 'Technology', title: 'T', publisher: 'Nature', url: 'https://example.com/t', body: 'B.' })
      const html = renderHtml({ ...baseNewsletter, content }, 'https://staging.example/newsletter/week-1')

      expect(html).toContain('href="https://staging.example"')
      expect(html).toContain('src="https://staging.example/images/logo-text-horizontal.png"')
      expect(html).toContain('src="https://staging.example/images/social/bluesky.png"')
      expect(html).not.toMatch(/(href|src)="https:\/\/actuallyrelevant\.news/)
    } finally {
      config.siteUrl = original
    }
  })

  it('labels the issue as AI-generated directly under the week title, and keeps the bottom line', async () => {
    const content = storyBlock({ title: 'First story', publisher: 'Nature', url: 'https://example.com/first', body: 'Summary.' })

    const html = render(content)
    const doc = new JSDOM(html).window.document

    const title = [...doc.querySelectorAll('p')].find(p => p.textContent === baseNewsletter.title)
    const label = title?.nextElementSibling
    expect(label?.textContent).toBe('AI-generated: AI selected the stories in this issue and wrote the headlines and summaries.')
    expect(label?.querySelector('strong')?.textContent).toBe('AI-generated:')
    // Seen before any AI text: the stories come after it
    expect(html.indexOf('AI-generated:')).toBeLessThan(html.indexOf('First story'))
    expect(html).not.toContain('<!-- Intro -->')
    expect(html).toContain('Curated and written with care by AI')
  })

  it('renders blockquote with quote and attribution', async () => {
    const content = [
      '## Quoted story',
      'Reuters · [original article](https://example.com/quoted)',
      '',
      '> "This is a significant finding for the field."',
      '> \u2014 Dr. Jane Smith, MIT',
    ].join('\n')

    const html = render(content)

    expect(html).toContain('This is a significant finding for the field.')
    expect(html).toContain('font-style: italic')
    expect(html).toContain('Dr. Jane Smith, MIT')
  })

  it('does not render border-bottom dividers between stories', async () => {
    const content =
      storyBlock({
        issue: 'Science',
        issueSlug: 'science-technology',
        title: 'Story one',
        publisher: 'BBC',
        url: 'https://example.com/one',
        body: 'First summary.',
      }) +
      '\n\n' +
      ['## Story two', 'Wired · [original article](https://example.com/two)', '', 'Second summary.'].join('\n')

    const html = render(content)

    expect(html).toContain('Story one')
    expect(html).toContain('Story two')
    // Story cells should not have border-bottom dividers
    const storyTds = html.match(/<td style="padding: 20px[^"]*">/g)
    expect(storyTds).toBeTruthy()
    for (const td of storyTds!) {
      expect(td).not.toContain('border-bottom')
    }
  })

  it('links story title to source URL', async () => {
    const content = storyBlock({
      title: 'Linked story title',
      publisher: 'Publisher',
      url: 'https://example.com/linked',
      body: 'Body text.',
    })

    const html = render(content)

    expect(html).toContain('<a href="https://example.com/linked" style="color: #171717; text-decoration: none;">Linked story title</a>')
  })

  it('shows a marked story heading without its story marker', async () => {
    const content = [
      '## Marked headline {story:3f2b8c1e-0000-4000-8000-000000000001}',
      'Publisher · [original article](https://example.com/m)',
      '',
      'Body.',
    ].join('\n')

    const html = render(content)

    expect(html).toContain('>Marked headline</a>')
    expect(html).not.toContain('{story:')
  })

  it('escapes HTML entities in content', async () => {
    const content = ['## Story with <tags> & "quotes"', 'Publisher & Co · [original article](https://example.com)', '', 'Content with <html> & entities.'].join(
      '\n',
    )

    const html = render(content)

    expect(html).toContain('&lt;tags&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;quotes&quot;')
  })

  it('links "View in browser", above the AI label, to the web edition it is given', () => {
    const html = renderHtml({ title: 'Week 42, 2026', content: 'Text only.' }, 'https://actuallyrelevant.news/newsletter/week-42-2026')
    expect(html).toContain('<a href="https://actuallyrelevant.news/newsletter/week-42-2026"')
    expect(html.indexOf('View in browser')).toBeLessThan(html.indexOf(NEWSLETTER_TOP_LABEL_TEXT))
  })

  it('handles multiple issues with separate section headers', async () => {
    const content = [
      storyBlock({
        issue: 'Climate',
        issueSlug: 'planet-climate',
        title: 'Climate story',
        publisher: 'BBC',
        url: 'https://example.com/climate',
        body: 'Climate summary.',
      }),
      '',
      '---',
      '',
      storyBlock({
        issue: 'Technology',
        issueSlug: 'science-technology',
        title: 'Tech story',
        publisher: 'Wired',
        url: 'https://example.com/tech',
        body: 'Tech summary.',
      }),
    ].join('\n')

    const html = render(content)

    // Both section headers rendered
    expect(html).toContain('Climate')
    expect(html).toContain('Technology')
    expect(html).toContain('Climate story')
    expect(html).toContain('Tech story')
  })
})
