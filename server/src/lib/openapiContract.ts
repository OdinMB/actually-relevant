/**
 * The public API's contract, and a check for breaking changes to it (.context/ci.md, "Public API contract").
 *
 * `apiContract()` reduces a generated OpenAPI document to what a client depends on (operations,
 * parameters, response schemas, security), dropping wording, examples, tags and the server URL, so
 * that only a change of shape changes it. `diffContracts()` compares two contracts and marks each
 * difference breaking (a client written against `before` could fail against `after`) or not. The
 * snapshot test in openapiContract.test.ts and `npm run api:snapshot` both use them.
 */
import { fileURLToPath } from 'node:url'

export type Contract = Record<string, unknown>

export interface ContractChange {
  breaking: boolean
  /** The operation, then the parameter or response, then the field's path inside the body. */
  at: string
  change: string
}

/** The committed contract of the public API, refreshed with `npm run api:snapshot --prefix server`. */
export const API_SNAPSHOT_PATH = fileURLToPath(new URL('./openapi.snapshot.json', import.meta.url))

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const asObject = (value: unknown): Json => (isObject(value) ? value : {})
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const canonical = (value: unknown): string => JSON.stringify(value) ?? 'undefined'
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const keysOf = (...objects: Json[]): string[] => [...new Set(objects.flatMap(o => Object.keys(o)))].sort(byText)

// ──── The contract ────────────────────────────────────────────────────────

/** Keywords that only document, dropped wherever they are keywords (a property may still be named like one). */
const DOCUMENTATION_KEYWORDS = new Set(['description', 'summary', 'example', 'examples', 'title', 'tags', 'externalDocs', 'deprecated'])
/** Top-level keys no client depends on: the wording, and the server URL, which differs per deployment. */
const DROPPED_TOP_LEVEL_KEYS = new Set(['info', 'servers', ...DOCUMENTATION_KEYWORDS])
/** Keys whose object maps names (properties, paths, status codes, media types) to things, rather than holding keywords. */
const NAME_MAPS = new Set([
  'properties',
  'patternProperties',
  '$defs',
  'paths',
  'webhooks',
  'schemas',
  'responses',
  'parameters',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'content',
  'encoding',
])
/** Lists whose order means nothing to a client. */
const UNORDERED_LISTS = new Set(['required', 'enum', 'type'])

const parameterKey = (parameter: unknown) => {
  const { in: location, name } = asObject(parameter)
  return `${String(location)} parameter ${String(name)}`
}

/** The parts of an OpenAPI document a client depends on, with keys and unordered lists sorted. */
export function apiContract(document: unknown): Contract {
  const plain = asObject(JSON.parse(JSON.stringify(document)))
  return normalize(Object.fromEntries(Object.entries(plain).filter(([key]) => !DROPPED_TOP_LEVEL_KEYS.has(key))), false) as Contract
}

function normalize(value: unknown, isNameMap: boolean, key?: string): unknown {
  if (Array.isArray(value)) {
    const items = value.map(item => normalize(item, false))
    if (key && UNORDERED_LISTS.has(key)) return items.sort((a, b) => byText(canonical(a), canonical(b)))
    if (key === 'parameters') return items.sort((a, b) => byText(parameterKey(a), parameterKey(b)))
    return items
  }
  if (!isObject(value)) return value
  const entries = Object.entries(value)
    // `required: false` on a parameter is the default spelled out
    .filter(([name, item]) => isNameMap || !(DOCUMENTATION_KEYWORDS.has(name) || (name === 'required' && item === false)))
    .map(([name, item]) => [name, isNameMap ? normalize(item, false) : normalize(item, NAME_MAPS.has(name) && isObject(item), name)] as const)
  return Object.fromEntries(entries.sort(([a], [b]) => byText(a, b)))
}

// ──── The diff ────────────────────────────────────────────────────────────

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

/** Bounds a schema can set, and whether each is a lower bound (lowering it admits more values). */
const BOUNDS: [keyword: string, lower: boolean][] = [
  ['minimum', true],
  ['exclusiveMinimum', true],
  ['minLength', true],
  ['minItems', true],
  ['minProperties', true],
  ['maximum', false],
  ['exclusiveMaximum', false],
  ['maxLength', false],
  ['maxItems', false],
  ['maxProperties', false],
]

/** Schema keywords compared one by one below; any other keyword that changes counts as breaking. */
const COMPARED_KEYWORDS = new Set([
  '$ref',
  'type',
  'nullable',
  'format',
  'enum',
  'const',
  'properties',
  'required',
  'items',
  'additionalProperties',
  ...BOUNDS.map(([k]) => k),
])

/** A request schema says what a client may send; a response schema, what it must be ready to read. */
type Direction = 'request' | 'response'

interface Place {
  /** Operation and parameter or response, e.g. `GET /api/stories response 200 application/json`. */
  at: string
  /** Path inside the body, e.g. `data[].feed.title`; empty at the top. */
  field: string
}

const placeText = ({ at, field }: Place) => (field ? `${at}: ${field}` : at)
const inField = (place: Place, name: string): Place => ({
  at: place.at,
  field: name === '[]' ? `${place.field}[]` : place.field ? `${place.field}.${name}` : name,
})
const isScalar = (value: unknown) => value === undefined || value === null || typeof value !== 'object'
/** What happened to a keyword, with its values when they are short (a bound, a default, an id) and without when not (a union, a body). */
const changedText = (what: string, before: unknown, after: unknown) =>
  !isScalar(before) || !isScalar(after)
    ? `${what} ${before === undefined ? 'added' : after === undefined ? 'removed' : 'changed'}`
    : before === undefined
      ? `${what} ${canonical(after)} added`
      : after === undefined
        ? `${what} removed (was ${canonical(before)})`
        : `${what} changed from ${canonical(before)} to ${canonical(after)}`

/** A schema read for comparison: its `$ref`s followed and an "X or null" union unwrapped to X, nullable. */
interface SchemaView {
  node: Json
  nullable: boolean
  /** The non-null types, or null when the schema allows any type. */
  types: string[] | null
  /** The allowed values other than null (canonical JSON), or null when unrestricted. */
  values: string[] | null
}

/** What a local `$ref` (`#/components/...`) points to; nothing for any other. */
function target(contract: Contract, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((at, part) => asObject(at)[part.replace(/~1/g, '/').replace(/~0/g, '~')], contract)
}

function resolve(contract: Contract, schema: unknown): Json {
  let node = asObject(schema)
  for (let hops = 0; typeof node.$ref === 'string' && hops < 32; hops++) node = asObject(target(contract, node.$ref))
  return node
}

/**
 * `value` with each `$ref` replaced by what it points to (a cycle stays a `$ref`), so that two parts this
 * check does not walk field by field (a union, a request body, a header) compare equal only when what they
 * describe is equal, wherever the components they refer to changed.
 */
function inline(contract: Contract, value: unknown, open: string[] = []): unknown {
  if (Array.isArray(value)) return value.map(item => inline(contract, item, open))
  if (!isObject(value)) return value
  const { $ref: ref, ...rest } = value
  const siblings = Object.fromEntries(Object.entries(rest).map(([key, item]) => [key, inline(contract, item, open)]))
  if (typeof ref !== 'string') return siblings
  if (open.includes(ref)) return { ...siblings, $ref: ref }
  return { ...asObject(inline(contract, target(contract, ref), [...open, ref])), ...siblings }
}

/**
 * The parts of a contract the comparison does not walk: all but the operations, the path-level
 * parameters, the security and the components (which the walk reaches through `$ref`s).
 */
function unwalked(contract: Contract): Json {
  const { paths, security: _security, components: _components, ...rest } = contract
  const pathItems = Object.entries(asObject(paths))
    .map(
      ([path, item]) => [path, Object.fromEntries(Object.entries(asObject(item)).filter(([key]) => key !== 'parameters' && !METHODS.includes(key)))] as const,
    )
    .filter(([, item]) => Object.keys(item).length > 0)
  return { ...rest, paths: Object.fromEntries(pathItems) }
}

function view(contract: Contract, schema: unknown): SchemaView {
  let node = resolve(contract, schema)
  let nullable = false
  for (const union of ['oneOf', 'anyOf']) {
    const alternatives = asArray(node[union])
    const others = alternatives.filter(alternative => resolve(contract, alternative).type !== 'null')
    if (Object.keys(node).length === 1 && alternatives.length === 2 && others.length === 1) {
      nullable = true
      node = resolve(contract, others[0])
    }
  }
  const types = node.type === undefined ? null : [node.type].flat().map(String)
  const values = 'const' in node ? [node.const] : Array.isArray(node.enum) ? node.enum : null
  if (types?.includes('null') || values?.includes(null) || node.nullable === true) nullable = true
  return {
    node,
    nullable,
    types: types?.filter(type => type !== 'null') ?? null,
    values: values?.filter(value => value !== null).map(canonical) ?? null,
  }
}

/** Whether a schema of these types accepts a value of `type` (every integer is a number). */
const admits = (types: string[], type: string) => types.includes(type) || (type === 'integer' && types.includes('number'))

/** Every difference between two contracts, each marked breaking or not, in a stable order. */
export function diffContracts(before: Contract, after: Contract): ContractChange[] {
  const changes: ContractChange[] = []
  const report = (breaking: boolean, at: string, change: string) => changes.push({ breaking, at, change })
  /** Whether a part compared as a whole describes the same thing on both sides, `$ref`s followed. */
  const same = (beforeValue: unknown, afterValue: unknown) => canonical(inline(before, beforeValue)) === canonical(inline(after, afterValue))

  /** A change that admits more values (`widens`) breaks a reader of responses; one that admits fewer breaks a sender of requests. */
  const breaks = (direction: Direction, widens: boolean) => (direction === 'response' ? widens : !widens)

  function compareSchemas(beforeSchema: unknown, afterSchema: unknown, place: Place, direction: Direction, open: [Json, Json][]): void {
    const b = view(before, beforeSchema)
    const a = view(after, afterSchema)
    // A schema that refers to itself (an issue's children) is compared once per path, not forever
    if (open.some(([x, y]) => x === b.node && y === a.node)) return
    open.push([b.node, a.node])
    const at = placeText(place)

    if (b.nullable !== a.nullable) {
      const nullText = a.nullable ? 'made nullable' : direction === 'response' ? 'never null any more' : 'null no longer accepted'
      report(breaks(direction, a.nullable), at, nullText)
    }
    if (canonical(b.types) !== canonical(a.types)) {
      const widens = a.types === null || (b.types !== null && a.types.some(type => !admits(b.types!, type)))
      const narrows = b.types === null || (a.types !== null && b.types.some(type => !admits(a.types!, type)))
      const typeText = (types: string[] | null) => types?.join(' or ') ?? 'any type'
      report(widens && narrows ? true : breaks(direction, widens), at, `type changed from ${typeText(b.types)} to ${typeText(a.types)}`)
    }
    const [beforeFormat, afterFormat] = [b.node.format, a.node.format]
    if (beforeFormat !== afterFormat) {
      if (beforeFormat !== undefined && afterFormat !== undefined) report(true, at, `format changed from ${String(beforeFormat)} to ${String(afterFormat)}`)
      else report(breaks(direction, afterFormat === undefined), at, changedText('format', beforeFormat, afterFormat))
    }
    if (canonical(b.values) !== canonical(a.values)) {
      if (b.values && a.values) {
        for (const value of b.values) if (!a.values.includes(value)) report(true, at, `enum value ${value} removed`)
        for (const value of a.values) if (!b.values.includes(value)) report(false, at, `enum value ${value} added`)
      } else {
        report(breaks(direction, a.values === null), at, a.values === null ? 'no longer limited to listed values' : `now limited to ${a.values.join(', ')}`)
      }
    }
    for (const [keyword, lower] of BOUNDS) {
      const [beforeBound, afterBound] = [b.node[keyword], a.node[keyword]]
      if (beforeBound === afterBound) continue
      const widens =
        afterBound === undefined || (beforeBound !== undefined && (lower ? Number(afterBound) < Number(beforeBound) : Number(afterBound) > Number(beforeBound)))
      report(breaks(direction, widens), at, changedText(keyword, beforeBound, afterBound))
    }
    // Anything else (a default, a pattern, a union that is more than "or null"): no telling, so breaking
    for (const keyword of keysOf(b.node, a.node)) {
      if (COMPARED_KEYWORDS.has(keyword) || same(b.node[keyword], a.node[keyword])) continue
      report(true, at, changedText(keyword, b.node[keyword], a.node[keyword]))
    }

    const [beforeProperties, afterProperties] = [asObject(b.node.properties), asObject(a.node.properties)]
    const [beforeRequired, afterRequired] = [new Set(asArray(b.node.required)), new Set(asArray(a.node.required))]
    for (const name of keysOf(beforeProperties, afterProperties)) {
      const field = inField(place, name)
      const fieldAt = placeText(field)
      if (!(name in afterProperties)) {
        report(true, fieldAt, 'property removed')
      } else if (!(name in beforeProperties)) {
        const required = direction === 'request' && afterRequired.has(name)
        report(required, fieldAt, required ? 'required property added' : 'property added')
      } else {
        if (beforeRequired.has(name) && !afterRequired.has(name)) report(direction === 'response', fieldAt, 'made optional')
        if (!beforeRequired.has(name) && afterRequired.has(name)) report(direction === 'request', fieldAt, 'now required')
        compareSchemas(beforeProperties[name], afterProperties[name], field, direction, open)
      }
    }
    if (b.node.items !== undefined || a.node.items !== undefined) compareSchemas(b.node.items, a.node.items, inField(place, '[]'), direction, open)
    const [beforeExtra, afterExtra] = [b.node.additionalProperties, a.node.additionalProperties]
    if (isObject(beforeExtra) && isObject(afterExtra)) compareSchemas(beforeExtra, afterExtra, inField(place, '*'), direction, open)
    else if (canonical(beforeExtra) !== canonical(afterExtra)) report(true, at, changedText('additionalProperties', beforeExtra, afterExtra))

    open.pop()
  }

  /** An operation's parameters by location and name, the path item's included (the operation's own win). */
  function parametersOf(contract: Contract, pathItem: Json, operation: Json): Record<string, Json> {
    const parameters = [...asArray(pathItem.parameters), ...asArray(operation.parameters)].map(parameter => resolve(contract, parameter))
    return Object.fromEntries(parameters.map(parameter => [parameterKey(parameter), parameter]))
  }

  function compareOperations(at: string, b: Json, a: Json, beforeItem: Json, afterItem: Json): void {
    const [beforeParameters, afterParameters] = [parametersOf(before, beforeItem, b), parametersOf(after, afterItem, a)]
    for (const key of keysOf(beforeParameters, afterParameters)) {
      const [bp, ap] = [beforeParameters[key], afterParameters[key]]
      const where = `${at} ${key}`
      if (!ap) {
        report(true, where, 'parameter removed')
      } else if (!bp) {
        report(ap.required === true, where, ap.required === true ? 'required parameter added' : 'parameter added')
      } else {
        if (bp.required !== true && ap.required === true) report(true, where, 'parameter now required')
        if (bp.required === true && ap.required !== true) report(false, where, 'parameter now optional')
        compareSchemas(bp.schema, ap.schema, { at: where, field: '' }, 'request', [])
        for (const keyword of keysOf(bp, ap)) {
          if (['name', 'in', 'required', 'schema'].includes(keyword) || same(bp[keyword], ap[keyword])) continue
          report(true, where, changedText(keyword, bp[keyword], ap[keyword]))
        }
      }
    }

    const [beforeResponses, afterResponses] = [asObject(b.responses), asObject(a.responses)]
    for (const status of keysOf(beforeResponses, afterResponses)) {
      const where = `${at} response ${status}`
      if (!(status in afterResponses)) {
        report(true, where, 'response removed')
        continue
      }
      if (!(status in beforeResponses)) {
        report(false, where, 'response added')
        continue
      }
      const [br, ar] = [resolve(before, beforeResponses[status]), resolve(after, afterResponses[status])]
      const [beforeContent, afterContent] = [asObject(br.content), asObject(ar.content)]
      for (const media of keysOf(beforeContent, afterContent)) {
        const mediaAt = `${where} ${media}`
        if (!(media in afterContent)) report(true, mediaAt, 'media type removed')
        else if (!(media in beforeContent)) report(false, mediaAt, 'media type added')
        else compareSchemas(asObject(beforeContent[media]).schema, asObject(afterContent[media]).schema, { at: mediaAt, field: '' }, 'response', [])
      }
      // Anything else on the response (its headers, links): breaking when changed
      for (const keyword of keysOf(br, ar)) {
        if (keyword !== 'content' && !same(br[keyword], ar[keyword])) report(true, where, changedText(keyword, br[keyword], ar[keyword]))
      }
    }

    // Anything else on the operation (its operationId, a request body, its own security): breaking when changed
    for (const keyword of keysOf(b, a)) {
      if (keyword === 'parameters' || keyword === 'responses' || same(b[keyword], a[keyword])) continue
      report(true, at, changedText(keyword, b[keyword], a[keyword]))
    }
  }

  const [beforePaths, afterPaths] = [asObject(before.paths), asObject(after.paths)]
  for (const path of keysOf(beforePaths, afterPaths)) {
    const [beforeItem, afterItem] = [asObject(beforePaths[path]), asObject(afterPaths[path])]
    for (const method of METHODS) {
      const [b, a] = [beforeItem[method], afterItem[method]]
      const at = `${method.toUpperCase()} ${path}`
      if (isObject(b) && isObject(a)) compareOperations(at, b, a, beforeItem, afterItem)
      else if (isObject(b)) report(true, at, 'operation removed')
      else if (isObject(a)) report(false, at, 'operation added')
    }
  }

  if (canonical(before.security) !== canonical(after.security)) report(true, 'security', 'security requirements changed')
  const schemes = (contract: Contract) => canonical(asObject(contract.components).securitySchemes)
  if (schemes(before) !== schemes(after)) report(true, 'security', 'security schemes changed')

  // Generated clients name a type after each schema component, so a rename breaks them even where the wire format holds
  const [beforeSchemas, afterSchemas] = [asObject(asObject(before.components).schemas), asObject(asObject(after.components).schemas)]
  for (const name of keysOf(beforeSchemas, afterSchemas)) {
    if (!(name in afterSchemas)) report(true, `components.schemas.${name}`, 'schema component removed or renamed')
    else if (!(name in beforeSchemas)) report(false, `components.schemas.${name}`, 'schema component added')
  }

  const [beforeRest, afterRest] = [unwalked(before), unwalked(after)]
  const [beforeRestPaths, afterRestPaths] = [asObject(beforeRest.paths), asObject(afterRest.paths)]
  const outside = [
    ...keysOf(beforeRest, afterRest).filter(key => key !== 'paths' && canonical(beforeRest[key]) !== canonical(afterRest[key])),
    ...keysOf(beforeRestPaths, afterRestPaths)
      .filter(path => canonical(beforeRestPaths[path]) !== canonical(afterRestPaths[path]))
      .map(path => `paths ${path}`),
  ]
  if (outside.length > 0) report(true, 'document', `changed outside what this check compares: ${outside.join(', ')}`)

  if (changes.length === 0 && canonical(apiContract(before)) !== canonical(apiContract(after))) {
    report(true, 'document', 'changed in a way this check does not classify')
  }
  return changes
}

/** The changes as a message for a failing test or the refresh script: what changed, and what to do. */
export function describeChanges(changes: ContractChange[]): string {
  const listed = (breaking: boolean) => changes.filter(change => change.breaking === breaking).map(({ at, change }) => `  - ${at}: ${change}`)
  const [breaking, other] = [listed(true), listed(false)]
  return [
    'The public API contract differs from the committed snapshot (server/src/lib/openapi.snapshot.json).',
    ...(breaking.length > 0 ? ['', 'Breaking (a client built against the snapshot could fail):', ...breaking] : []),
    ...(other.length > 0 ? ['', 'Not breaking:', ...other] : []),
    '',
    breaking.length > 0
      ? 'Restore what the snapshot promises, or, if the break is intended, refresh it: npm run api:snapshot --prefix server -- --accept-breaking'
      : 'If the change is intended, refresh the snapshot and commit it with the change: npm run api:snapshot --prefix server',
  ].join('\n')
}
