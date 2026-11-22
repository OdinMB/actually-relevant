/**
 * The page HTML that Readability needs, smaller: comments and the elements it removes before it
 * reads anything (scripts other than JSON-LD, styles, `<noscript>`, `<template>`) are cut before
 * JSDOM builds its DOM (`.context/content-extraction.md`, "CPU & Memory Budget"). On a SPIEGEL
 * article they are about two thirds of the bytes, which JSDOM would otherwise build as DOM nodes,
 * stylesheets included, only for Readability to throw them away.
 *
 * Inline SVG stays: Readability counts it when it weighs a candidate block, and cutting it changed
 * which block it picked on some pages.
 *
 * One left-to-right scan, so whichever construct opens first wins, as in the HTML tokenizer: a
 * `<script>` inside a comment goes with the comment, a `<!--` inside a script with the script. JSON-LD
 * stays, since Readability reads the article's metadata from it.
 */
const INERT = /<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

const JSON_LD = /^<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json/i

export function readableHtml(html: string): string {
  return html.replace(INERT, match => (JSON_LD.test(match) ? match : ''))
}
