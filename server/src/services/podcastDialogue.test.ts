import { describe, it, expect } from 'vitest'
import { config } from '../config.js'
import { PODCAST_EPISODE_COPY, PODCAST_OPENER, PODCAST_SIGN_OFF } from '../lib/aiLabelCopy.js'
import type { PodcastDialogue } from '../schemas/llm.js'
import {
  applyTurnEdits, assembleSpokenSegments, dialogueCharBudget, renderScript, textChanged, validateDialogue,
  type DialogueTextEdit,
} from './podcastDialogue.js'
import {
  fixtureStories as stories, filler, goodDialogue, INTRO_TEXT, storySegment, withSegment, withTurn, type Segment,
} from '../test/podcastFixtures.js'

const W = { kind: 'weekly' } as const
const S = { kind: 'standalone' } as const

function errorsOf(d: PodcastDialogue): string[] {
  return validateDialogue(d, stories, W).errors
}

describe('validateDialogue', () => {
  it('accepts a dialogue that covers every story with bridges inside the band', () => {
    const result = validateDialogue(goodDialogue(), stories, W)
    expect(result.errors).toEqual([])
    expect(result.valid).toBe(true)
  })

  it('rejects a missing story and a story covered twice', () => {
    const d = goodDialogue()
    const missing = { ...d, segments: d.segments.filter(s => s.storyRef !== 4) }
    expect(errorsOf(missing).join(' ')).toMatch(/story 4/)
    const twice = withSegment(d, 4, storySegment(3, { turns: storySegment(4).turns }))
    expect(errorsOf(twice).join(' ')).toMatch(/story 3/)
  })

  it('rejects a story ref that is not in the episode', () => {
    expect(errorsOf(withSegment(goodDialogue(), 4, storySegment(4, { storyRef: 9 }))).join(' ')).toMatch(/9/)
  })

  it('rejects a dialogue that does not start with the intro and end with the outro', () => {
    const d = goodDialogue()
    const noIntro = { ...d, segments: d.segments.slice(1) }
    expect(validateDialogue(noIntro, stories, W).valid).toBe(false)
    const noOutro = { ...d, segments: d.segments.slice(0, -1) }
    expect(validateDialogue(noOutro, stories, W).valid).toBe(false)
  })

  it('rejects a first story segment that opens with HOST_A: opener, intro and that turn are three in a row', () => {
    const d = goodDialogue()
    const story1 = d.segments[1]
    const aFirst: Segment = { ...story1, turns: story1.turns.map(t => ({ ...t, speaker: t.speaker === 'HOST_A' ? 'HOST_B' as const : 'HOST_A' as const })) }
    expect(errorsOf(withSegment(d, 1, aFirst)).join(' ')).toMatch(/three times in a row/)
  })

  it('rejects an intro with more than one turn', () => {
    const intro: Segment = { kind: 'intro', storyRef: null, turns: [
      { speaker: 'HOST_A', text: INTRO_TEXT },
      { speaker: 'HOST_B', text: 'We will look at what changed, why it matters, and where the evidence leaves room for doubt.' },
    ] }
    expect(errorsOf(withSegment(goodDialogue(), 0, intro)).join(' ')).toMatch(/intro.*one turn/)
  })

  it('rejects an intro spoken by HOST_B', () => {
    const intro: Segment = { kind: 'intro', storyRef: null, turns: [{ speaker: 'HOST_B', text: INTRO_TEXT }] }
    expect(errorsOf(withSegment(goodDialogue(), 0, intro)).join(' ')).toMatch(/intro.*HOST_A/)
  })

  it('rejects a spoken total below or above the band, counting the opener, the sign-off and tags', () => {
    const d = goodDialogue()
    const short = { ...d, segments: d.segments.map(s => ({ ...s, turns: s.turns.slice(0, 1) })) }
    expect(errorsOf(short).join(' ')).toMatch(/spoken characters/)
    const long = { ...d, segments: d.segments.map(s => (s.kind === 'story' ? { ...s, turns: [...s.turns, { speaker: 'HOST_A' as const, text: filler(390, 'extra') }, { speaker: 'HOST_B' as const, text: filler(390, 'more') }] } : s)) }
    expect(errorsOf(long).join(' ')).toMatch(/spoken characters/)
  })

  it('reports a band miss in the terms of the prompt: the model\'s own turns against its budget', () => {
    const d = goodDialogue()
    const short = { ...d, segments: d.segments.map(s => ({ ...s, turns: s.turns.slice(0, 1) })) }
    const modelOnly = short.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    const { min, max } = dialogueCharBudget('weekly')
    const message = errorsOf(short).find(e => /spoken characters/.test(e)) ?? ''
    expect(message).toContain(String(modelOnly))
    expect(message).toContain(`${min} to ${max}`)
  })

  it('counts the code-added opener and sign-off in the band', () => {
    const d = goodDialogue()
    const total = assembleSpokenSegments(d, 'weekly').flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    const modelOnly = d.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    expect(total).toBe(modelOnly + PODCAST_OPENER.length + PODCAST_SIGN_OFF.length)
  })

  it('rejects a turn over the per-turn limit', () => {
    expect(errorsOf(withTurn(goodDialogue(), 1, 1, filler(420, 'long'))).join(' ')).toMatch(/400/)
  })

  it('rejects unknown audio tags and more than two tags in one turn', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 1, 1, `[laughs] ${filler(300, 'tag')}`)).join(' ')).toMatch(/\[laughs\]/)
    expect(errorsOf(withTurn(d, 1, 1, `[calm] ${filler(300, 'tag')} [serious] and [warmly] more.`)).join(' ')).toMatch(/tags/)
  })

  it('accepts up to two allowlisted tags in one turn', () => {
    expect(errorsOf(withTurn(goodDialogue(), 1, 1, `[calm] ${filler(300, 'tag')} [short pause] more.`))).toEqual([])
  })

  it('rejects URLs, markdown and speaker prefixes in turns', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 1, 2, `${filler(300, 'url')} See https://example.com for more.`)).join(' ')).toMatch(/URL/)
    expect(errorsOf(withTurn(d, 1, 2, `${filler(300, 'md')} This is **important**.`)).join(' ')).toMatch(/markdown/i)
    expect(errorsOf(withTurn(d, 1, 2, `HOST B: ${filler(300, 'prefix')}`)).join(' ')).toMatch(/prefix/)
  })

  it('accepts an episode publisher whose name is a domain, but still rejects other domains', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 2, 1, `${filler(300, 'pub')} Phys.org reported it first.`))).toEqual([])
    expect(errorsOf(withTurn(d, 4, 1, `${filler(300, 'pub')} According to vox.com, it applies now.`))).toEqual([])
    expect(errorsOf(withTurn(d, 2, 1, `${filler(300, 'pub')} Read more at example.org today.`)).join(' ')).toMatch(/URL/)
  })

  it('accepts a domain-named publisher at the end of a sentence', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 2, 1, `${filler(300, 'pub')} Phys.org reports the rollout is on schedule.`))).toEqual([])
    expect(errorsOf(withTurn(d, 4, 1, `${filler(300, 'pub')} The rules apply now, according to Vox.com.`))).toEqual([])
  })

  it('still rejects a spoken domain that merely contains or extends a publisher name', () => {
    const d = goodDialogue()
    expect(errorsOf(withTurn(d, 3, 1, `${filler(300, 'pub')} Read it at reuters.com/world today.`)).join(' ')).toMatch(/URL/)
    expect(errorsOf(withTurn(d, 4, 1, `${filler(300, 'pub')} Read it at vox.com/x today.`)).join(' ')).toMatch(/URL/)
    const withAp = stories.map(s => (s.ref === 3 ? { ...s, publisher: 'AP' } : s))
    expect(validateDialogue(withTurn(d, 3, 1, `${filler(300, 'pub')} Read it at cap.com today.`), withAp, W).errors.join(' ')).toMatch(/URL/)
  })

  it('rejects an empty or overlong episode title', () => {
    expect(errorsOf({ ...goodDialogue(), episodeTitle: '  ' }).join(' ')).toMatch(/title/)
    expect(errorsOf({ ...goodDialogue(), episodeTitle: 'x'.repeat(81) }).join(' ')).toMatch(/title/)
  })

  it('rejects URLs or markdown in the episode title and summary', () => {
    expect(errorsOf({ ...goodDialogue(), episodeSummary: 'Four stories. More at example.com.' }).join(' ')).toMatch(/summary.*URL/)
    expect(errorsOf({ ...goodDialogue(), episodeSummary: 'Four **big** stories. Each matters.' }).join(' ')).toMatch(/summary.*markdown/)
    expect(errorsOf({ ...goodDialogue(), episodeTitle: '# Clean air' }).join(' ')).toMatch(/title.*markdown/)
  })

  it('accepts a publisher-domain name in the episode summary', () => {
    expect(errorsOf({ ...goodDialogue(), episodeSummary: 'Four stories, from Phys.org to Reuters. Each matters.' })).toEqual([])
  })

  it('rejects a story segment whose bridge turn is too short', () => {
    expect(errorsOf(withTurn(goodDialogue(), 2, 0, 'Next, vaccines.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects a story segment that opens with its headline restated', () => {
    expect(errorsOf(withTurn(goodDialogue(), 2, 0, 'Malaria vaccine reaches ten more countries.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects an outro without a bridge back from the last story', () => {
    expect(errorsOf(withTurn(goodDialogue(), 5, 0, 'Bye.')).join(' ')).toMatch(/bridge/)
  })

  it('rejects an outro that thanks listeners or signs off, since code appends the sign-off', () => {
    const closings = [
      'Thanks for listening to Actually Relevant.',
      'Thank you so much for joining us today.',
      'Thanks, everyone, and see you next week.',
      'Until next time.',
      "That's all for this episode.",
      'Goodbye for now.',
      'That is the picture. Thank you.',
    ]
    for (const text of closings) {
      expect(errorsOf(withTurn(goodDialogue(), 5, 1, text)).join(' '), text).toMatch(/outro.*sign-off/)
    }
  })

  it('accepts thanks that are not a closing to listeners, and closing words outside the outro', () => {
    expect(errorsOf(withTurn(goodDialogue(), 5, 1, 'Thanks to that court, the data is finally public.'))).toEqual([])
    expect(errorsOf(withTurn(goodDialogue(), 5, 1, 'Countries will have to take care that the rules hold.'))).toEqual([])
    expect(errorsOf(withTurn(goodDialogue(), 2, 1, `${filler(300, 'thanks')} Thanks for listening, the minister told reporters.`))).toEqual([])
  })

  it('rejects two consecutive story segments that open with the same first five words', () => {
    const d = goodDialogue()
    const templated = withTurn(
      withTurn(d, 2, 0, 'Next up on our list this week is a vaccine rollout that reached ten more countries.'),
      3, 0, 'Next up on our list this week is a treaty that limits permits for deep-sea mining.',
    )
    expect(errorsOf(templated).join(' ')).toMatch(/five words/)
  })
})

/** The good dialogue without its relative dates, as a standalone episode must read. */
const standaloneDialogue = (): PodcastDialogue =>
  JSON.parse(JSON.stringify(goodDialogue()).replace(/from this week/g, 'from May').replace(/this week/g, 'in May'))

describe('validateDialogue for a standalone episode', () => {
  it('accepts a dialogue that never dates a story relative to now, even when a story title does', () => {
    expect(validateDialogue(standaloneDialogue(), stories, S).errors).toEqual([])
    const datedTitles = stories.map(s => ({ ...s, title: `${s.title} this week` }))
    expect(validateDialogue(standaloneDialogue(), datedTitles, S).errors).toEqual([])
  })

  it('rejects relative dates in a turn, the title or the summary, for the model and a person alike', () => {
    const inTurn = withTurn(standaloneDialogue(), 2, 1, `${filler(300, 'rel')} It was announced last month.`)
    expect(validateDialogue(inTurn, stories, S).errors.join(' ')).toMatch(/turn 2: says "last month"/)
    expect(validateDialogue(inTurn, stories, { ...S, authoredBy: 'person' }).errors.join(' ')).toMatch(/last month/)
    const inMeta = { ...standaloneDialogue(), episodeTitle: "This week's clean air", episodeSummary: 'Stories from the past week. Each matters.' }
    const errors = validateDialogue(inMeta, stories, S).errors.join(' ')
    expect(errors).toMatch(/title says "This week's"/)
    expect(errors).toMatch(/summary says "past week"/)
  })

  it('has no such rule for a weekly episode', () => {
    expect(validateDialogue(goodDialogue(), stories, W).errors).toEqual([])
    expect(validateDialogue(goodDialogue(), stories, S).errors.join(' ')).toMatch(/this week/)
  })

  it('counts the standalone opener and sign-off in the band', () => {
    const d = standaloneDialogue()
    const { opener, signOff } = PODCAST_EPISODE_COPY.standalone
    const total = assembleSpokenSegments(d, 'standalone').flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    const modelOnly = d.segments.flatMap(s => s.turns).reduce((n, t) => n + t.text.length, 0)
    expect(total).toBe(modelOnly + opener.length + signOff.length)
  })
})

describe('assembleSpokenSegments', () => {
  it('uses the standalone opener and sign-off for a standalone episode', () => {
    const segments = assembleSpokenSegments(standaloneDialogue(), 'standalone')
    expect(segments[0].turns).toEqual([{ speaker: 'HOST_A', text: PODCAST_EPISODE_COPY.standalone.opener }])
    expect(segments.at(-1)?.turns).toEqual([{ speaker: 'HOST_A', text: PODCAST_EPISODE_COPY.standalone.signOff }])
  })

  it('puts the opener first and the sign-off last, both spoken by HOST_A', () => {
    const segments = assembleSpokenSegments(goodDialogue(), 'weekly')
    expect(segments[0]).toEqual({ kind: 'opener', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_OPENER }] })
    expect(segments.at(-1)).toEqual({ kind: 'signoff', storyRef: null, turns: [{ speaker: 'HOST_A', text: PODCAST_SIGN_OFF }] })
    expect(segments.slice(1, -1).map(s => s.kind)).toEqual(['intro', 'story', 'story', 'story', 'story', 'outro'])
  })
})

describe('dialogueCharBudget', () => {
  it('leaves room for the code-added turns inside the band', () => {
    const { min, max } = dialogueCharBudget('weekly')
    const code = PODCAST_OPENER.length + PODCAST_SIGN_OFF.length
    expect([min + code, max + code]).toEqual(config.podcast.spokenCharBand)
  })

  it('asks the model\'s own turns for the episode aim less the code-added turns', () => {
    const code = PODCAST_OPENER.length + PODCAST_SIGN_OFF.length
    expect(dialogueCharBudget('weekly').aim + code).toBe(config.podcast.spokenCharAim)
  })

  it('subtracts each kind\'s own code-added turns', () => {
    const { opener, signOff } = PODCAST_EPISODE_COPY.standalone
    const { min, max, aim } = dialogueCharBudget('standalone')
    const code = opener.length + signOff.length
    expect([min + code, max + code]).toEqual(config.podcast.spokenCharBand)
    expect(aim + code).toBe(config.podcast.spokenCharAim)
  })
})

describe('renderScript', () => {
  it('renders every spoken turn with its speaker, segments separated by a blank line', () => {
    const script = renderScript(assembleSpokenSegments(goodDialogue(), 'weekly'))
    const lines = script.split('\n')
    expect(lines[0]).toBe(`HOST A: ${PODCAST_OPENER}`)
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^HOST A: Welcome/)
    expect(lines.at(-1)).toBe(`HOST A: ${PODCAST_SIGN_OFF}`)
  })
})

describe('validateDialogue for a person\'s edit', () => {
  it('turns the two segue failures into warnings and still accepts the dialogue', () => {
    const shortBridge = withTurn(goodDialogue(), 2, 0, 'And now, vaccines.')
    const sameOpenings = withTurn(withTurn(shortBridge, 3, 0, 'Next up this week is a story about the deep ocean floor and a treaty.'), 4, 0, 'Next up this week is a story about export rules for computer chips.')

    const asModel = validateDialogue(sameOpenings, stories, W)
    expect(asModel.valid).toBe(false)
    expect(asModel.warnings).toEqual([])

    const asPerson = validateDialogue(sameOpenings, stories, { ...W, authoredBy: 'person' })
    expect(asPerson.valid).toBe(true)
    expect(asPerson.errors).toEqual([])
    expect(asPerson.warnings.join(' ')).toMatch(/spoken bridge/)
    expect(asPerson.warnings.join(' ')).toMatch(/same first five words/)
  })

  it('turns a closing thank-you in the outro into a warning', () => {
    const thanked = withTurn(goodDialogue(), 5, 1, 'Thanks for listening.')
    const asPerson = validateDialogue(thanked, stories, { ...W, authoredBy: 'person' })
    expect(asPerson.valid).toBe(true)
    expect(asPerson.warnings.join(' ')).toMatch(/sign-off/)
  })

  it('keeps every other rule an error for a person', () => {
    const withUrl = withTurn(goodDialogue(), 2, 1, 'Read it at https://example.org today.')
    const result = validateDialogue(withUrl, stories, { ...W, authoredBy: 'person' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/URL/)

    const tooShort = withSegment(goodDialogue(), 2, storySegment(2, { turns: storySegment(2).turns.map(t => ({ ...t, text: t.text.slice(0, 60) })) }))
    expect(validateDialogue(tooShort, stories, { ...W, authoredBy: 'person' }).errors.join(' ')).toMatch(/spoken characters/)
  })
})

describe('applyTurnEdits', () => {
  const asEdit = (d: PodcastDialogue): DialogueTextEdit => ({
    episodeSummary: d.episodeSummary,
    segments: d.segments.map(s => ({ kind: s.kind, storyRef: s.storyRef, turns: s.turns.map(t => ({ speaker: t.speaker, text: t.text })) })),
  })

  it('applies new turn text and summary and keeps the structure', () => {
    const stored = goodDialogue()
    const edit = asEdit(withTurn(stored, 2, 1, 'A rewritten turn.'))
    edit.episodeSummary = 'A new summary.'
    const result = applyTurnEdits(stored, edit)
    expect(result.mismatches).toEqual([])
    expect(result.dialogue?.segments[2].turns[1]).toEqual({ speaker: stored.segments[2].turns[1].speaker, text: 'A rewritten turn.' })
    expect(result.dialogue?.episodeSummary).toBe('A new summary.')
    expect(result.dialogue?.episodeTitle).toBe(stored.episodeTitle)
    expect(textChanged(stored, result.dialogue!)).toBe(true)
    expect(textChanged(stored, applyTurnEdits(stored, asEdit(stored)).dialogue!)).toBe(false)
  })

  it('reports a changed speaker, turn count, segment kind or story, and applies nothing', () => {
    const stored = goodDialogue()
    const speaker = asEdit(stored)
    speaker.segments[2].turns[0].speaker = speaker.segments[2].turns[0].speaker === 'HOST_A' ? 'HOST_B' : 'HOST_A'
    const count = asEdit(stored)
    count.segments[2].turns.pop()
    const kind = asEdit(stored)
    kind.segments[4].kind = 'outro'
    const ref = asEdit(stored)
    ref.segments[1].storyRef = 2
    const segments = asEdit(stored)
    segments.segments.pop()

    for (const [edit, pattern] of [[speaker, /speaker/], [count, /turns/], [kind, /kind or story/], [ref, /kind or story/], [segments, /segments/]] as const) {
      const result = applyTurnEdits(stored, edit)
      expect(result.dialogue).toBeNull()
      expect(result.mismatches.join(' ')).toMatch(pattern)
    }
  })
})
