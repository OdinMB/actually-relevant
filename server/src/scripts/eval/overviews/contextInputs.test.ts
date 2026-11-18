import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextInput } from '../../../test/contextFixtures.js'
import type { ContextInput } from '../../../services/storyContextPipeline.js'
import { CONTEXT_INPUTS_VERSION, contextInputsFor } from './contextInputs.js'

describe('contextInputsFor', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ''
  })
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'context-inputs-'))
    return join(dir, 'context-inputs.json')
  }
  const loader = (asked: string[][]) => async (slugs: string[]) => {
    asked.push(slugs)
    return new Map<string, ContextInput | null>(slugs.map(s => [s, s === 'gone' ? null : contextInput({ storyId: s })]))
  }
  const NOW = new Date('2026-11-18T08:00:00Z')

  it('loads what the cache does not hold, keeps a story with no input as null, and writes the file', async () => {
    const file = setup()
    const asked: string[][] = []
    const first = await contextInputsFor(['a', 'gone'], { file, refresh: false, load: loader(asked), now: NOW })
    expect(first.loaded).toBe(2)
    expect(first.updatedAt).toBe(NOW.toISOString())
    expect(first.inputs.get('a')?.storyId).toBe('a')
    expect(first.inputs.get('gone')).toBeNull()
    const second = await contextInputsFor(['gone', 'a', 'b'], { file, refresh: false, load: loader(asked), now: NOW })
    expect(asked).toEqual([['a', 'gone'], ['b']])
    expect([...second.inputs.keys()]).toEqual(['gone', 'a', 'b'])
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).inputs)).toEqual(['a', 'gone', 'b'])
  })

  it('asks the loader nothing when the cache holds every slug', async () => {
    const file = setup()
    writeFileSync(file, JSON.stringify({ version: CONTEXT_INPUTS_VERSION, updatedAt: '2026-11-17T00:00:00.000Z', inputs: { a: contextInput() } }))
    const r = await contextInputsFor(['a'], { file, refresh: false, load: () => Promise.reject(new Error('no database')) })
    expect(r).toMatchObject({ loaded: 0, updatedAt: '2026-11-17T00:00:00.000Z' })
  })

  it('loads every slug again on refresh, and over a cache of another version', async () => {
    const file = setup()
    writeFileSync(file, JSON.stringify({ version: 0, updatedAt: 'x', inputs: { a: null } }))
    const asked: string[][] = []
    expect((await contextInputsFor(['a'], { file, refresh: false, load: loader(asked) })).loaded).toBe(1)
    expect((await contextInputsFor(['a'], { file, refresh: true, load: loader(asked) })).loaded).toBe(1)
    expect(asked).toEqual([['a'], ['a']])
  })
})
