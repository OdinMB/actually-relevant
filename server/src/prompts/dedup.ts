import { escapeXml } from "./shared.js";

export interface StoryForDedup {
  title: string;
  summary: string;
}

export interface CandidateForDedup {
  id: string;
  title: string;
  summary: string;
}

export function buildDedupPrompt(
  source: StoryForDedup,
  candidates: CandidateForDedup[],
): string {
  let prompt = `<ROLE>
You are a strict news editor determining whether articles report on the exact same specific event.
</ROLE>

<TASK>
Compare the source article against each candidate. Mark a candidate as a duplicate ONLY if its main news is the same specific event or incident as the source's main news. Shared background, such as the ongoing story both belong to, does not count.

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
- Articles report different developments in one ongoing story, such as an announcement and its later outcome, successive rounds of talks, or new stages of a siege, an election count, or a bill
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
