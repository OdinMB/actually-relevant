/**
 * The dedup-confirmation prompt exactly as phase 1 of the GPT-6 eval ran it
 * (commit f93fa4e, before the phase-2 tightening). The labelled dedup set
 * (arm consensus plus judges) was made with this text, and the call ledger is
 * keyed by it, so the recalibration re-reads those labels from the cache at no
 * cost. Never edit it: any change moves the ground truth and orphans the
 * cached labels.
 */
import { escapeXml } from '../../../prompts/shared.js'
import type { CandidateForDedup, StoryForDedup } from '../../../prompts/dedup.js'

export function buildPhase1DedupPrompt(
  source: StoryForDedup,
  candidates: CandidateForDedup[],
): string {
  let prompt = `<ROLE>
You are a strict news editor determining whether articles report on the exact same specific event.
</ROLE>

<TASK>
Compare the source article against each candidate. Mark a candidate as a duplicate ONLY if it reports on the same event, trend, or incident as the source.

Your threshold for "duplicate" must be high. When in doubt, mark as NOT a duplicate.
</TASK>

<RULES>
DUPLICATE — mark isDuplicate: true ONLY when:
- Both articles describe the exact same specific event (same what, when, where)
- Example: Two articles about the same FDA approval of the same drug
- Example: Two articles about the same earthquake in the same city on the same day
- Example: Two articles covering reactions to the same specific UN resolution vote

NOT A DUPLICATE — mark isDuplicate: false when:
- Articles cover the same broad topic, conflict, or ongoing situation but describe DIFFERENT specific events, incidents, or developments
- Articles cover different actions by the same actor (e.g. different policy announcements by the same government)
</RULES>

<SOURCE>
<Title>${escapeXml(source.title)}</Title>
<Summary>${escapeXml(source.summary)}</Summary>
</SOURCE>

<CANDIDATES>
`;

  candidates.forEach((c, i) => {
    prompt += `<CANDIDATE number="${i + 1}">
<Title>${escapeXml(c.title)}</Title>
<Summary>${escapeXml(c.summary)}</Summary>
</CANDIDATE>
`;
  });

  prompt += `</CANDIDATES>`;

  return prompt;
}
