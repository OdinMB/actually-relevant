import { describe, it, expect } from 'vitest'
import { parseStoryHeading, storyHeading, storyHeadings, storyHeadlines, toWebMarkdown } from './newsletterContent.js'

const ID = '3f2b8c1e-0000-4000-8000-000000000001'

describe('story headings', () => {
  it('a written heading parses back to its headline and story id', () => {
    const line = storyHeading('Cities cut smog', ID)
    expect(line.startsWith('## ')).toBe(true)
    expect(parseStoryHeading(line)).toEqual({ headline: 'Cities cut smog', storyId: ID })
  })

  it('an unmarked heading parses to its headline and no id', () => {
    expect(parseStoryHeading('## Cities cut smog ')).toEqual({ headline: 'Cities cut smog', storyId: null })
  })

  it('a heading edited by hand keeps its marker and its new text', () => {
    expect(parseStoryHeading(`## Smog falls in 40 cities {story:${ID}}`)).toEqual({ headline: 'Smog falls in 40 cities', storyId: ID })
  })

  it('storyHeadlines pairs each marked heading with its id and skips unmarked ones', () => {
    const content = [`## First {story:${ID}}`, 'meta', '', '## Unmarked', '', '## Second {story:other-id}', '# Section {planet-climate}'].join('\n')
    expect(storyHeadlines(content)).toEqual([
      { storyId: ID, headline: 'First' },
      { storyId: 'other-id', headline: 'Second' },
    ])
  })

  it('storyHeadings lists every story heading in order, marked or not, and skips one with no text', () => {
    const content = [
      `## First {story:${ID}}`,
      'meta',
      '',
      '## Unmarked',
      '',
      '## {story:empty}',
      '# Section {planet-climate}',
      '## Second {story:other-id}',
    ].join('\n')
    expect(storyHeadings(content)).toEqual([
      { headline: 'First', storyId: ID },
      { headline: 'Unmarked', storyId: null },
      { headline: 'Second', storyId: 'other-id' },
    ])
  })
})

describe('toWebMarkdown', () => {
  it("drops the email template's story, favicon and section-color markers", () => {
    const md = `# Human Development {human-development}\n\n## Title {story:${ID}}\n{feed:abc-123} Publisher · [original article](https://x)\n`
    expect(toWebMarkdown(md)).toBe('# Human Development\n\n## Title\nPublisher · [original article](https://x)\n')
  })
})
