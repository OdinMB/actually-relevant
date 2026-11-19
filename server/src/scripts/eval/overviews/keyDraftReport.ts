/**
 * The `key-draft` step's section of `overview-eval.md`: per development, the drafts written into its
 * key file (each response with its story, what is being done and the quote; the end with its quote,
 * or the drafter's reason there is none) and what code left out, for the owner to review beside the
 * key. Pure.
 */
import type { KeyDraftReport, KeyDraftResult } from './keyDraft.js'
import { cell, estimateText, quoted } from './reportText.js'

function draftLines(d: KeyDraftResult): string[] {
  const story = (slug: string) => `${quoted(d.titles[slug] ?? slug)} (${slug})`
  if (d.outcome !== 'ok') return [`### ${cell(d.title)} (\`${d.file}\`)`, '', `No draft: the call gave none (${d.outcome}); the key is as it was.`, '']
  const end = d.closed
    ? `**End (a draft):** ${d.closed.date}, reported by ${story(d.closed.slug!)}: ${quoted(d.closed.quote ?? '')}. Check it is the charter's end event itself, not a step toward it.`
    : d.noEnd !== null
      ? `**End:** none of our stories reports it, as the drafter reads them: ${cell(d.noEnd)}`
      : '**End:** the drafter named one, but code could not check it (below); the key stays open.'
  return [
    `### ${cell(d.title)} (\`${d.file}\`)`,
    '',
    d.written
      ? `Written into the key: ${d.responses.length} responses${d.closed ? ' and the end' : ''}, each \`"reviewed": false\`.`
      : 'Nothing drafted: the key is as it was.',
    '',
    end,
    '',
    ...(d.responses.length > 0
      ? [
          '| Date | Story | What is being done | Quote |',
          '|---|---|---|---|',
          ...d.responses.map(r => `| ${r.date} | ${cell(d.titles[r.slug!] ?? r.slug!)} | ${cell(r.what)} | ${quoted(r.quote ?? '')} |`),
          '',
        ]
      : []),
    ...(d.left.length > 0 ? ['Left out (not written; add one by hand if it is right):', '', ...d.left.map(l => `- ${cell(l)}`), ''] : []),
    ...(d.missing.length > 0 ? [`Not published in this database, so not shown to the drafter: ${d.missing.join(', ')}.`, ''] : []),
  ]
}

export function keyDraftLines(r: KeyDraftReport): string[] {
  const responses = r.drafts.reduce((sum, d) => sum + (d.written ? d.responses.length : 0), 0)
  const ends = r.drafts.filter(d => d.written && d.closed).length
  return [
    r.stopped
      ? `**Drafts:** none; the calls did not run: ${cell(r.stopped)} (${estimateText(r.estimate)}).`
      : `**Drafts:** ${r.written.length} of ${r.keys.length} version 1 keys of half ${r.half} written: ${responses} responses and ${ends} ends, each \`"reviewed": false\` (${estimateText(r.estimate)}).`,
    ...r.skipped.map(s => `- Left alone: ${s.file}: ${cell(s.reason)}`),
    '',
    ...r.drafts.flatMap(draftLines),
    'Run `npm run format --prefix server`, then review each key: delete a wrong row (or end), correct one if needed, and mark every one you keep `"reviewed": true`. `stands` refuses while a response is unreviewed, `closure` and `replay` while an end is. Then `--steps keys` checks every quote against the database.',
  ]
}
