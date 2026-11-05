import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import { markdownToPlainText } from './plainText.js'

/** The helper's code after its header comment, which names the other copy. */
function rules(relativePath: string): string {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const start = source.indexOf('/** An escaped')
  expect(start, `${relativePath} has lost the comment its rules start at`).toBeGreaterThan(0)
  return source.slice(start)
}

// Mirrored in client/src/lib/plainText.test.ts: the two helpers must agree on every case.
describe('markdownToPlainText', () => {
  it('has the same rules as the client copy, which builds the same description in the browser', () => {
    expect(rules('./plainText.ts')).toBe(rules('../../../client/src/lib/plainText.ts'))
  })

  it.each([
    ['keeps link text and drops the URL', 'Read [the report](https://example.org/report) today.', 'Read the report today.'],
    ['drops a link title and keeps parentheses inside the URL', 'See [this](https://example.org/a_(b) "Title") page.', 'See this page.'],
    ['keeps an image only by its alt text', 'A chart: ![Emissions fell](https://example.org/chart.png).', 'A chart: Emissions fell.'],
    [
      'keeps reference-link text and drops the definition',
      'Per [the agency][1], rates fell.\n\n[1]: https://example.org/agency',
      'Per the agency, rates fell.',
    ],
    ['keeps a reference definition with a quoted title out', 'Rates fell.\n\n[1]: https://example.org/agency "The agency"', 'Rates fell.'],
    ['keeps a bracketed lead-in that is not a definition', '[Update]: The agency revised its figures.', '[Update]: The agency revised its figures.'],
    ['keeps an autolink as the address it shows', 'Data at <https://example.org/data>.', 'Data at https://example.org/data.'],
    ['drops bold and italic marks', '**Bold** and *italic* and __bold__ and _italic_ and ***both***.', 'Bold and italic and bold and italic and both.'],
    ['drops nested emphasis', '**A bold *and italic* phrase**', 'A bold and italic phrase'],
    [
      'drops the marks around a bold lead-in, as analysis points start',
      '**Global cooperation:** The program builds trust.',
      'Global cooperation: The program builds trust.',
    ],
    ['drops strikethrough marks', 'It was ~~cheap~~ costly.', 'It was cheap costly.'],
    ['drops inline code marks', 'Run `make` first.', 'Run make first.'],
    ['keeps underscores inside words', 'The snake_case_name and file_v2_final stay.', 'The snake_case_name and file_v2_final stay.'],
    ['keeps a lone asterisk between spaces', 'Five * three is 15, and 2 * 4 is 8.', 'Five * three is 15, and 2 * 4 is 8.'],
    ['keeps escaped marks as the characters', String.raw`Not \*emphasis\* and a \_name\_.`, 'Not *emphasis* and a _name_.'],
    [
      'drops heading, quote and list markers',
      '# Heading\n> Quoted line\n- First item\n* Second item\n1. Third item',
      'Heading Quoted line First item Second item Third item',
    ],
    ['drops thematic breaks', 'Before.\n\n---\n\nAfter.', 'Before. After.'],
    ['joins paragraphs and lines with single spaces', '  First paragraph.\n\nSecond   paragraph,\nwrapped.  ', 'First paragraph. Second paragraph, wrapped.'],
    ['keeps hyphens', 'A well-known, U.S.-based group.', 'A well-known, U.S.-based group.'],
    ['keeps a private-use character just past the parking range', 'A mark \u{E080} stays.', 'A mark \u{E080} stays.'],
    ['leaves plain text as it is', 'Cities cut smog by 30% in 2026: a "fast" result.', 'Cities cut smog by 30% in 2026: a "fast" result.'],
  ])('%s', (_, markdown, plain) => {
    expect(markdownToPlainText(markdown)).toBe(plain)
  })
})
