import { describe, it, expect } from 'vitest'
import { readableHtml } from './readableHtml.js'

describe('readableHtml', () => {
  it('cuts scripts, styles, noscript and template, keeping the text around them', () => {
    const html =
      '<head><style>.a{color:red}</style><script src="x.js"></script></head>' +
      '<body><p>One</p><script>var s = "<p>not text</p>"</script><noscript><img src="t.gif"></noscript>' +
      '<template><p>later</p></template><p>Two</p></body>'
    expect(readableHtml(html)).toBe('<head></head><body><p>One</p><p>Two</p></body>')
  })

  it('keeps inline SVG, which Readability weighs when it picks the article block', () => {
    const svg = '<svg viewBox="0 0 1 1"><title>Close</title><path d="M0"/></svg>'
    expect(readableHtml(`<p>a</p>${svg}`)).toBe(`<p>a</p>${svg}`)
  })

  it('keeps JSON-LD scripts, which Readability reads metadata from', () => {
    const ld = '<script type="application/ld+json">{"headline":"H"}</script>'
    const unquoted = '<script type=application/ld+json>{"headline":"H"}</script>'
    expect(readableHtml(`<head>${ld}${unquoted}<script>x()</script></head>`)).toBe(`<head>${ld}${unquoted}</head>`)
  })

  it('matches tags in any case and closing tags with trailing space', () => {
    expect(readableHtml('<p>a</p><SCRIPT type="module">x</SCRIPT ><Style>b{}</style><p>b</p>')).toBe('<p>a</p><p>b</p>')
  })

  it('takes whichever opens first, as the HTML tokenizer does', () => {
    // A script tag inside a comment goes with the comment; the paragraph after it stays
    expect(readableHtml('<!-- <script> --><p>kept</p><script>y</script>')).toBe('<p>kept</p>')
    // A comment opener inside a script goes with the script
    expect(readableHtml('<script>var c = "<!--"</script><p>kept</p><!-- c -->')).toBe('<p>kept</p>')
  })

  it('does not take an element whose name only starts like one it cuts', () => {
    expect(readableHtml('<scripted>t</scripted><styles>u</styles>')).toBe('<scripted>t</scripted><styles>u</styles>')
  })

  it('leaves an unclosed script as it is, for the parser to handle', () => {
    expect(readableHtml('<p>a</p><script>never closed')).toBe('<p>a</p><script>never closed')
  })
})
