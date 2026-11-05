/**
 * Markdown as plain text, for places that cannot render it: link-preview descriptions, share text,
 * structured data and teasers (.context/seo.md, "Story link previews"). Link and image text stay,
 * their URLs go; emphasis, code, heading, quote and list marks go; an escaped mark stays as the
 * character; all whitespace, line breaks included, becomes single spaces.
 *
 * Mirrors server/src/lib/plainText.ts, which builds the same descriptions for crawlers; change both
 * together (their tests share the cases).
 */

/** An escaped ASCII punctuation mark is parked on a private-use code point, so no rule below reads it as Markdown. */
const ESCAPED = /\\([!-/:-@[-`{-~])/g
const PARKED = /[\u{E000}-\u{E07F}]/gu
const PARK_OFFSET = 0xe000

export function markdownToPlainText(markdown: string): string {
  return (
    markdown
      .replace(ESCAPED, (_, mark: string) => String.fromCharCode(PARK_OFFSET + mark.charCodeAt(0)))
      // Block marks at the start of a line: thematic breaks, headings, quotes, list items
      .replace(/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, '')
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]{0,3}(?:>[ \t]?)+/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, '')
      // Links: a reference definition (label, destination, optional quoted title, nothing else) goes;
      // inline links, images, reference links and autolinks keep their text
      .replace(/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/gm, '')
      .replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/<((?:https?|mailto):[^\s<>]+)>/g, '$1')
      .replace(/`+([^`]+)`+/g, '$1')
      // Emphasis, strong before single so nested marks both go; `_` only outside words, as Markdown reads it
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
      .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '$1$2')
      .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '$1')
      .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
      .replace(PARKED, parked => String.fromCharCode(parked.charCodeAt(0) - PARK_OFFSET))
      .replace(/\s+/g, ' ')
      .trim()
  )
}
