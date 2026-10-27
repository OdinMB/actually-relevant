import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { check, resolveConfig } from 'prettier'
import { refreshApiSnapshot } from './refresh.js'

/** A one-operation contract whose response object has these properties, all required. */
function contract(properties: Record<string, unknown>) {
  const schema = { type: 'object', properties, required: Object.keys(properties) }
  return { openapi: '3.1.0', paths: { '/a': { get: { responses: { '200': { content: { 'application/json': { schema } } } } } } } }
}

const base = contract({ id: { type: 'string' }, title: { type: 'string' } })

describe('refreshApiSnapshot', () => {
  let dir: string
  let file: string
  let lines: string[]
  const refresh = (current: object, acceptBreaking = false) => refreshApiSnapshot({ path: file, current, acceptBreaking, log: line => lines.push(line) })
  const written = () => JSON.parse(readFileSync(file, 'utf8'))

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'api-snapshot-'))
    file = path.join(dir, 'openapi.snapshot.json')
    lines = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes the snapshot when there is none yet', async () => {
    expect(existsSync(file)).toBe(false)
    expect(await refresh(base)).toBe(true)
    expect(written()).toEqual(base)
  })

  it('writes it the way Prettier formats JSON there, so the format check passes', async () => {
    await refresh(base)
    const text = readFileSync(file, 'utf8')
    expect(await check(text, { ...(await resolveConfig(file)), filepath: file })).toBe(true)
  })

  it('writes a change that breaks nothing without the flag, and lists it', async () => {
    await refresh(base)
    const added = contract({ id: { type: 'string' }, title: { type: 'string' }, region: { type: 'string' } })
    expect(await refresh(added)).toBe(true)
    expect(written()).toEqual(added)
    expect(lines.join('\n')).toContain('GET /a response 200 application/json: region: property added')
  })

  it('refuses a breaking change without --accept-breaking and leaves the snapshot as it was', async () => {
    await refresh(base)
    const before = readFileSync(file, 'utf8')
    const removed = contract({ id: { type: 'string' } })
    expect(await refresh(removed)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe(before)
    const output = lines.join('\n')
    expect(output).toContain('GET /a response 200 application/json: title: property removed')
    expect(output).toContain('--accept-breaking')
  })

  it('writes a breaking change when it is accepted', async () => {
    await refresh(base)
    const removed = contract({ id: { type: 'string' } })
    expect(await refresh(removed, true)).toBe(true)
    expect(written()).toEqual(removed)
  })

  it('reports an unchanged contract as up to date, and writes it in the usual layout', async () => {
    await refresh(base)
    const usual = readFileSync(file, 'utf8')
    writeFileSync(file, JSON.stringify(base, null, 4))
    lines = []
    expect(await refresh(base)).toBe(true)
    expect(lines).toEqual([expect.stringContaining('up to date')])
    expect(readFileSync(file, 'utf8')).toBe(usual)
  })
})
