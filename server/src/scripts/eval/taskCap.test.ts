import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { _resetSpendGuard, createCap, readCap, spendGuard } from '../../lib/spendCap.js'
import { arm, cacheKey, createEvalContext, SPEND_CAP_REACHED, SPEND_REFUSED_PREFIX, stoppedBySpend } from './models.js'
import { installEvalCap } from './taskCap.js'
import type { CallRecord } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '../../..')

const luna = arm('gpt-6-luna', 'low')
const schema = z.object({ ok: z.boolean() })
const completion = () =>
  new Response(
    JSON.stringify({
      id: 'c1',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-6-luna',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
      usage: { prompt_tokens: 100_000, completion_tokens: 10_000, total_tokens: 110_000 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('an eval command under the task spend cap', () => {
  const mockFetch = vi.fn<typeof fetch>()
  const dirs: string[] = []
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-cap-'))
    dirs.push(dir)
    return dir
  }
  const closers: (() => void)[] = []
  const install = (name: string | undefined, dir: string) => {
    const cap = installEvalCap(name, dir)
    closers.push(() => cap.close())
    return cap
  }
  beforeEach(() => {
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('OPENAI_API_KEY', 'sk-test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    for (const c of closers.splice(0)) c()
    _resetSpendGuard()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it('without a cap answers a cached call and refuses a live one, sending nothing', async () => {
    const dir = temp()
    const ledger = join(dir, 'calls.jsonl')
    const cached: CallRecord = {
      key: cacheKey(luna, 's', 'cached prompt'),
      arm: 'gpt-6-luna@low',
      schema: 's',
      outcome: 'ok',
      parsed: { ok: true },
      content: '{"ok":true}',
      finishReason: 'stop',
      usage: { input: 10, cached: 0, output: 5, reasoning: 0 },
      costUsd: 0.001,
      latencyMs: 1,
      at: '',
    }
    writeFileSync(ledger, JSON.stringify(cached) + '\n')
    const cap = install(undefined, dir)
    expect(cap.line()).toMatch(/none/)
    const ctx = createEvalContext({ cacheFile: ledger, budgetUsd: 10, concurrency: 1, offline: false })
    expect((await ctx.call(luna, 's', schema, 'cached prompt')).outcome).toBe('ok')
    const live = await ctx.call(luna, 's', schema, 'live prompt')
    expect(live).toMatchObject({ outcome: 'skipped', costUsd: 0 })
    expect(live.error?.startsWith(SPEND_REFUSED_PREFIX)).toBe(true)
    expect(stoppedBySpend(live.error)).toBe(true)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('under a cap makes a call that fits, and its lines say what the command spent and what is left', async () => {
    const dir = temp()
    createCap(dir, 'task', 1)
    const cap = install('task', dir)
    mockFetch.mockImplementation(async () => completion())
    const ctx = createEvalContext({ cacheFile: join(dir, 'calls.jsonl'), budgetUsd: 10, concurrency: 1, offline: false })
    expect((await ctx.call(luna, 's', schema, 'a prompt')).outcome).toBe('ok')
    await vi.waitFor(() => expect(readCap(dir, 'task').openCount).toBe(0))
    // 100,000 input tokens at $0.10 per 1M and 10,000 output tokens at $0.50
    expect(readCap(dir, 'task').settledUsd).toBeCloseTo(0.015, 12)
    expect(cap.line()).toMatch(/task.*this command \$0\.0150.*left \$0\.9850/)
    expect(cap.section()).toMatch(/## Spend cap[\s\S]*\$0\.9850/)
  })

  it('answers a call that does not fit skipped, stopped at the spend cap, sending nothing', async () => {
    const dir = temp()
    createCap(dir, 'tiny', 0.01)
    install('tiny', dir)
    const ctx = createEvalContext({ cacheFile: join(dir, 'calls.jsonl'), budgetUsd: 10, concurrency: 1, offline: false })
    expect(await ctx.call(luna, 's', schema, 'a prompt')).toMatchObject({ outcome: 'skipped', error: SPEND_CAP_REACHED })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses to start on a cap another live process is using', () => {
    const dir = temp()
    createCap(dir, 'busy', 1)
    install('busy', dir)
    _resetSpendGuard()
    expect(() => installEvalCap('busy', dir)).toThrow(/in use by process/)
    expect(spendGuard()).toBeNull()
  })
})

describe('every eval command', () => {
  const scripts = (JSON.parse(readFileSync(join(SERVER, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
  const commands = Object.entries(scripts).filter(([name]) => name.startsWith('eval:') && name !== 'eval:cap')

  it('is found in package.json', () => {
    expect(commands.map(([name]) => name)).toEqual(expect.arrayContaining(['eval:models', 'eval:recalibrate', 'eval:research', 'eval:overviews']))
  })

  it.each(commands)('%s installs the spend guard its --cap names before it sends anything', (_, script) => {
    const file = /tsx (\S+\.ts)/.exec(script)?.[1]
    expect(file).toBeDefined()
    expect(readFileSync(join(SERVER, file!), 'utf8')).toMatch(/installEvalCap\(opts\.cap\)/)
  })
})
