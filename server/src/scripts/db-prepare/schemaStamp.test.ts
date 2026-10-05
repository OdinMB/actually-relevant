import { describe, it, expect } from 'vitest'
import { schemaHash, needsGenerate } from './schemaStamp.js'

const SCHEMA = 'model A {\n  id String @id\n}\n'

describe('schemaHash', () => {
  it('ignores line-ending differences, so a CRLF checkout does not force a regenerate', () => {
    expect(schemaHash(SCHEMA.replace(/\n/g, '\r\n'))).toBe(schemaHash(SCHEMA))
  })

  it('changes when the schema content changes', () => {
    expect(schemaHash(SCHEMA.replace('String', 'Int'))).not.toBe(schemaHash(SCHEMA))
  })
})

describe('needsGenerate', () => {
  const stamp = schemaHash(SCHEMA)

  it('skips generate when the client exists and was generated from this schema', () => {
    expect(needsGenerate({ schema: SCHEMA, stamp, clientPresent: true })).toBe(false)
  })

  it('generates when the schema changed since the last generate', () => {
    expect(needsGenerate({ schema: SCHEMA + 'model B {\n  id String @id\n}\n', stamp, clientPresent: true })).toBe(true)
  })

  it('generates when no stamp has been written yet', () => {
    expect(needsGenerate({ schema: SCHEMA, stamp: null, clientPresent: true })).toBe(true)
  })

  it('generates when the client is missing, even with a matching stamp', () => {
    expect(needsGenerate({ schema: SCHEMA, stamp, clientPresent: false })).toBe(true)
  })

  it('tolerates surrounding whitespace in the stored stamp', () => {
    expect(needsGenerate({ schema: SCHEMA, stamp: `${stamp}\n`, clientPresent: true })).toBe(false)
  })
})
