import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { strictSchema } from './strictSchema.js'

const schema = z.object({
  id: z.string(),
  issue: z.object({ slug: z.string() }).nullable(),
  feed: z.object({ title: z.string(), extra: z.object({ note: z.string() }).optional() }),
  tags: z.array(z.object({ name: z.string() })).min(1),
  byIssue: z.record(z.string(), z.object({ count: z.number() })),
})

const valid = { id: 'a', issue: { slug: 's' }, feed: { title: 't', extra: { note: 'n' } }, tags: [{ name: 'x' }], byIssue: { s: { count: 1 } } }

describe('strictSchema', () => {
  it('accepts what the schema describes, as the schema does', () => {
    expect(strictSchema(schema).parse(valid)).toEqual(valid)
    expect(strictSchema(schema).parse({ ...valid, issue: null, feed: { title: 't' } })).toEqual({ ...valid, issue: null, feed: { title: 't' } })
  })

  it('rejects a key the schema does not name, at any depth', () => {
    const strict = strictSchema(schema)
    const withExtra = [
      { ...valid, unknown: 1 },
      { ...valid, issue: { slug: 's', unknown: 1 } },
      { ...valid, feed: { title: 't', extra: { note: 'n', unknown: 1 } } },
      { ...valid, tags: [{ name: 'x', unknown: 1 }] },
      { ...valid, byIssue: { s: { count: 1, unknown: 1 } } },
    ]
    for (const value of withExtra) {
      expect(schema.safeParse(value).success).toBe(true)
      expect(strict.safeParse(value).success, JSON.stringify(value)).toBe(false)
    }
  })

  it('makes a recursive (lazy) schema strict at every level', () => {
    const tree: z.ZodType<unknown> = z.lazy(() => z.object({ name: z.string(), children: z.array(tree) }))
    const strict = strictSchema(tree)
    expect(strict.safeParse({ name: 'a', children: [{ name: 'b', children: [] }] }).success).toBe(true)
    expect(strict.safeParse({ name: 'a', children: [{ name: 'b', children: [], unknown: 1 }] }).success).toBe(false)
  })

  it('keeps the constraints of what it wraps', () => {
    expect(strictSchema(schema).safeParse({ ...valid, tags: [] }).success).toBe(false)
    expect(strictSchema(schema).safeParse({ ...valid, id: 1 }).success).toBe(false)
  })
})
