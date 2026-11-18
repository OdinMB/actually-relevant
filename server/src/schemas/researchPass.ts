/**
 * Structured outputs of a research pass's later-pass prompts (`prompts/researchPass.ts`;
 * `.context/research-passes.md`, "The later pass"): the judge of each section against what the pass
 * found, and the Update note. The rewrite answers in research's repair shape (`repairSchema`). Format
 * guidance lives in the `.describe()`s (`.context/prompting.md`, "Schema carries format guidance"),
 * and each schema is part of its prompt's version (`PASS_PROMPT_VERSIONS`).
 */
import { z } from 'zod'

export const SECTION_VERDICTS = ['unchanged', 'wrong', 'substantially_different'] as const
export type SectionVerdict = (typeof SECTION_VERDICTS)[number]

export const judgeSchema = z.object({
  sections: z
    .array(
      z.object({
        label: z.string().describe('The label of a section in <STORY>, exactly as given there, e.g. "Story paragraph 2".'),
        verdict: z
          .enum(SECTION_VERDICTS)
          .describe(
            'wrong: a fact in <NEW_FACTS> shows that something the section states is false. substantially_different: it is still true as written for its time, but a reader would now hold a materially false or outdated belief about the development, as <SUBSTANTIALLY_DIFFERENT> defines it. unchanged: anything else, including a section that new facts only add detail to.',
          ),
        factIds: z
          .array(z.string())
          .describe('For wrong or substantially_different: the ids of the facts in <NEW_FACTS> that make it so, e.g. ["S7F2"]. Empty for unchanged.'),
        reason: z
          .string()
          .describe(
            'For wrong or substantially_different: in one sentence, what the section states and what the new facts say instead. Empty string for unchanged.',
          ),
      }),
    )
    .describe('One entry per section in <STORY>, in its order.'),
  contradicted: z
    .array(
      z.object({
        factId: z.string().describe('The id of a fact in <CITED_FACTS> that facts in <NEW_FACTS> contradict.'),
        byFactIds: z.array(z.string()).describe('The ids of the facts in <NEW_FACTS> that contradict it.'),
        reason: z.string().describe('In one sentence, what the cited fact states and what the new facts state about the same moment.'),
      }),
    )
    .describe('Each fact in <CITED_FACTS> that facts in <NEW_FACTS> show was wrong about its own moment, as <CONTRADICTED> defines it. Empty when none is.'),
})

export const noteSchema = z.object({
  text: z
    .string()
    .describe(
      'The Update in plain text: one or two sentences, at most 60 words, no Markdown, no fact ids, no quotation marks, at most one em dash, no date of the update itself.',
    ),
  factIds: z
    .array(z.string())
    .describe('Ids of every fact in <FACTS> the Update states, e.g. ["S7F2"]: at least one of the facts the changed sections now rest on.'),
})

export type JudgeAnswer = z.infer<typeof judgeSchema>
export type NoteAnswer = z.infer<typeof noteSchema>
