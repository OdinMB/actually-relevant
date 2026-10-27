import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { getOpenAPIDocument } from './openapi.js'
import { API_SNAPSHOT_PATH, apiContract, describeChanges, diffContracts, type ContractChange } from './openapiContract.js'

/**
 * A small OpenAPI document shaped like the generated one: refs, a self-reference, a nullable ref, query and
 * path parameters; and, beyond what the public API has today, a union, a request body and a response header.
 */
function baseDoc(): any {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: '1', description: 'Wording' },
    servers: [{ url: 'https://api.example', description: 'Production' }],
    tags: [{ name: 'Stories', description: 'Stories' }],
    security: [{}, { apiKey: [] }],
    paths: {
      '/feedback': {
        post: {
          operationId: 'sendFeedback',
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Feedback' } } } },
          responses: {
            '200': {
              description: 'Sent',
              headers: { 'RateLimit-Remaining': { description: 'Requests left', schema: { $ref: '#/components/schemas/Count' } } },
            },
          },
        },
      },
      '/stories': {
        get: {
          operationId: 'listStories',
          summary: 'List stories',
          description: 'Lists stories',
          tags: ['Stories'],
          parameters: [
            { name: 'page', in: 'query', description: 'Page', schema: { type: 'integer', default: 1, minimum: 1, maximum: 100 } },
            { name: 'tone', in: 'query', schema: { type: 'string', enum: ['calm', 'scary'] } },
          ],
          responses: {
            '200': {
              description: 'Stories',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Story' } } }, required: ['data'] },
                },
              },
            },
          },
        },
      },
      '/stories/{slug}': {
        get: {
          operationId: 'getStory',
          parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Story', content: { 'application/json': { schema: { $ref: '#/components/schemas/Story' } } } },
            '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'Optional key' } },
      schemas: {
        Story: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: ['string', 'null'], description: 'AI-generated. Headline.', example: 'A headline' },
            tone: { type: 'string', enum: ['calm', 'scary'] },
            relevance: { type: 'integer', minimum: 0, maximum: 10 },
            description: { type: 'string', description: 'A property named like an annotation' },
            issue: { $ref: '#/components/schemas/Issue' },
            related: { type: 'array', items: { $ref: '#/components/schemas/Story' } },
            media: { oneOf: [{ $ref: '#/components/schemas/Image' }, { type: 'string' }] },
          },
          required: ['id', 'title', 'tone', 'relevance', 'description', 'issue'],
        },
        Issue: { type: 'object', properties: { slug: { type: 'string', example: 'climate' } }, required: ['slug'] },
        Image: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
        Feedback: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
        Count: { type: 'integer', minimum: 0 },
      },
    },
  }
}

/** The changes from the base document to a copy `edit` changed. */
function changesAfter(edit: (doc: any) => void): ContractChange[] {
  const after = baseDoc()
  edit(after)
  return diffContracts(apiContract(baseDoc()), apiContract(after))
}

const LIST = 'GET /stories response 200 application/json'
const DETAIL = 'GET /stories/{slug} response 200 application/json'

describe('apiContract', () => {
  it('keeps what a client depends on and drops wording, examples, tags and the server', () => {
    const contract: any = apiContract(baseDoc())
    expect(contract).not.toHaveProperty('info')
    expect(contract).not.toHaveProperty('servers')
    expect(contract).not.toHaveProperty('tags')
    expect(contract.paths['/stories'].get).toEqual({
      operationId: 'listStories',
      parameters: [
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1, maximum: 100 } },
        { name: 'tone', in: 'query', schema: { type: 'string', enum: ['calm', 'scary'] } },
      ],
      responses: {
        '200': {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Story' } } }, required: ['data'] },
            },
          },
        },
      },
    })
    expect(contract.components.schemas.Story.properties.title).toEqual({ type: ['null', 'string'] })
    expect(contract.components.schemas.Story.properties.description).toEqual({ type: 'string' })
    expect(contract.components.securitySchemes.apiKey).toEqual({ type: 'http', scheme: 'bearer' })
    expect(contract.security).toEqual([{}, { apiKey: [] }])
  })

  it('does not change when only wording, examples or the server URL change', () => {
    const reworded = baseDoc()
    reworded.info.description = 'Other wording'
    reworded.servers[0].url = 'http://localhost:3000'
    reworded.paths['/stories'].get.summary = 'Other summary'
    reworded.paths['/stories'].get.parameters[0].description = 'Other'
    reworded.components.schemas.Story.properties.title.description = 'Other'
    reworded.components.schemas.Issue.properties.slug.example = 'other'
    expect(apiContract(reworded)).toEqual(apiContract(baseDoc()))
  })

  it('ignores the order of lists whose order means nothing to a client', () => {
    const reordered = baseDoc()
    reordered.paths['/stories'].get.parameters.reverse()
    reordered.components.schemas.Story.required.reverse()
    reordered.components.schemas.Story.properties.tone.enum.reverse()
    reordered.components.schemas.Story.properties.title.type.reverse()
    expect(JSON.stringify(apiContract(reordered))).toBe(JSON.stringify(apiContract(baseDoc())))
  })

  it('treats a parameter marked "required: false" like one that leaves it out', () => {
    const explicit = baseDoc()
    explicit.paths['/stories'].get.parameters[0].required = false
    expect(apiContract(explicit)).toEqual(apiContract(baseDoc()))
  })
})

describe('diffContracts', () => {
  it('finds nothing between a document and itself', () => {
    expect(diffContracts(apiContract(baseDoc()), apiContract(baseDoc()))).toEqual([])
  })

  it('reports a removed operation as breaking and an added one as not', () => {
    expect(changesAfter(doc => delete doc.paths['/stories/{slug}'])).toEqual([{ breaking: true, at: 'GET /stories/{slug}', change: 'operation removed' }])
    expect(
      changesAfter(doc => {
        doc.paths['/stories'].post = { operationId: 'createStory', responses: { '201': { description: 'Created' } } }
      }),
    ).toEqual([{ breaking: false, at: 'POST /stories', change: 'operation added' }])
  })

  it('reports a renamed operationId as breaking (generated clients name their methods after it)', () => {
    expect(changesAfter(doc => (doc.paths['/stories'].get.operationId = 'getStories'))).toEqual([
      { breaking: true, at: 'GET /stories', change: 'operationId changed from "listStories" to "getStories"' },
    ])
  })

  it('reports a removed parameter, a new required one and one made required as breaking', () => {
    expect(changesAfter(doc => doc.paths['/stories'].get.parameters.splice(1, 1))).toEqual([
      { breaking: true, at: 'GET /stories query parameter tone', change: 'parameter removed' },
    ])
    expect(changesAfter(doc => doc.paths['/stories'].get.parameters.push({ name: 'since', in: 'query', required: true, schema: { type: 'string' } }))).toEqual([
      { breaking: true, at: 'GET /stories query parameter since', change: 'required parameter added' },
    ])
    expect(changesAfter(doc => (doc.paths['/stories'].get.parameters[1].required = true))).toEqual([
      { breaking: true, at: 'GET /stories query parameter tone', change: 'parameter now required' },
    ])
  })

  it('reports an optional parameter added, or a required one made optional, as not breaking', () => {
    expect(changesAfter(doc => doc.paths['/stories'].get.parameters.push({ name: 'since', in: 'query', schema: { type: 'string' } }))).toEqual([
      { breaking: false, at: 'GET /stories query parameter since', change: 'parameter added' },
    ])
    expect(changesAfter(doc => (doc.paths['/stories/{slug}'].get.parameters[0].required = false))).toEqual([
      { breaking: false, at: 'GET /stories/{slug} path parameter slug', change: 'parameter now optional' },
    ])
  })

  it('reports a removed response property as breaking wherever it is served, once per place', () => {
    expect(
      changesAfter(doc => {
        delete doc.components.schemas.Story.properties.relevance
        doc.components.schemas.Story.required = doc.components.schemas.Story.required.filter((name: string) => name !== 'relevance')
      }),
    ).toEqual([
      { breaking: true, at: `${LIST}: data[].relevance`, change: 'property removed' },
      { breaking: true, at: `${DETAIL}: relevance`, change: 'property removed' },
    ])
  })

  it('reports a response property made nullable as breaking, in either spelling', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.relevance.type = ['integer', 'null']))).toEqual([
      { breaking: true, at: `${LIST}: data[].relevance`, change: 'made nullable' },
      { breaking: true, at: `${DETAIL}: relevance`, change: 'made nullable' },
    ])
    expect(
      changesAfter(doc => (doc.components.schemas.Story.properties.issue = { oneOf: [{ $ref: '#/components/schemas/Issue' }, { type: 'null' }] })),
    ).toEqual([
      { breaking: true, at: `${LIST}: data[].issue`, change: 'made nullable' },
      { breaking: true, at: `${DETAIL}: issue`, change: 'made nullable' },
    ])
  })

  it('reports a response property that is never null any more as not breaking', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.title.type = 'string'))).toEqual([
      { breaking: false, at: `${LIST}: data[].title`, change: 'never null any more' },
      { breaking: false, at: `${DETAIL}: title`, change: 'never null any more' },
    ])
  })

  it('reports a response property made optional as breaking', () => {
    expect(changesAfter(doc => doc.components.schemas.Story.required.splice(doc.components.schemas.Story.required.indexOf('tone'), 1))).toEqual([
      { breaking: true, at: `${LIST}: data[].tone`, change: 'made optional' },
      { breaking: true, at: `${DETAIL}: tone`, change: 'made optional' },
    ])
  })

  it('reports a changed type or format as breaking', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.relevance.type = 'string'))).toEqual([
      { breaking: true, at: `${LIST}: data[].relevance`, change: 'type changed from integer to string' },
      { breaking: true, at: `${DETAIL}: relevance`, change: 'type changed from integer to string' },
    ])
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.relevance.type = 'number'))).toEqual([
      { breaking: true, at: `${LIST}: data[].relevance`, change: 'type changed from integer to number' },
      { breaking: true, at: `${DETAIL}: relevance`, change: 'type changed from integer to number' },
    ])
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.id.format = 'uri'))).toEqual([
      { breaking: true, at: `${LIST}: data[].id`, change: 'format changed from uuid to uri' },
      { breaking: true, at: `${DETAIL}: id`, change: 'format changed from uuid to uri' },
    ])
  })

  it('reports a removed enum value as breaking, in a response and in a parameter, and an added one as not', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.tone.enum = ['calm']))).toEqual([
      { breaking: true, at: `${LIST}: data[].tone`, change: 'enum value "scary" removed' },
      { breaking: true, at: `${DETAIL}: tone`, change: 'enum value "scary" removed' },
    ])
    expect(changesAfter(doc => (doc.paths['/stories'].get.parameters[1].schema.enum = ['calm']))).toEqual([
      { breaking: true, at: 'GET /stories query parameter tone', change: 'enum value "scary" removed' },
    ])
    expect(changesAfter(doc => doc.components.schemas.Story.properties.tone.enum.push('hopeful'))).toEqual([
      { breaking: false, at: `${LIST}: data[].tone`, change: 'enum value "hopeful" added' },
      { breaking: false, at: `${DETAIL}: tone`, change: 'enum value "hopeful" added' },
    ])
  })

  it('reports a response property added as not breaking', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.region = { type: 'string' }))).toEqual([
      { breaking: false, at: `${LIST}: data[].region`, change: 'property added' },
      { breaking: false, at: `${DETAIL}: region`, change: 'property added' },
    ])
  })

  it('reports a parameter bound tightened or a default changed as breaking, and a bound loosened as not', () => {
    const pageSchema = (doc: any) => doc.paths['/stories'].get.parameters[0].schema
    expect(changesAfter(doc => (pageSchema(doc).maximum = 50))).toEqual([
      { breaking: true, at: 'GET /stories query parameter page', change: 'maximum changed from 100 to 50' },
    ])
    expect(changesAfter(doc => (pageSchema(doc).maximum = 200))).toEqual([
      { breaking: false, at: 'GET /stories query parameter page', change: 'maximum changed from 100 to 200' },
    ])
    expect(changesAfter(doc => (pageSchema(doc).default = 2))).toEqual([
      { breaking: true, at: 'GET /stories query parameter page', change: 'default changed from 1 to 2' },
    ])
    expect(changesAfter(doc => delete pageSchema(doc).minimum)).toEqual([
      { breaking: false, at: 'GET /stories query parameter page', change: 'minimum removed (was 1)' },
    ])
  })

  it('reports a response bound widened as breaking and one narrowed as not', () => {
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.relevance.maximum = 12))).toEqual([
      { breaking: true, at: `${LIST}: data[].relevance`, change: 'maximum changed from 10 to 12' },
      { breaking: true, at: `${DETAIL}: relevance`, change: 'maximum changed from 10 to 12' },
    ])
    expect(changesAfter(doc => (doc.components.schemas.Story.properties.relevance.maximum = 5))).toEqual([
      { breaking: false, at: `${LIST}: data[].relevance`, change: 'maximum changed from 10 to 5' },
      { breaking: false, at: `${DETAIL}: relevance`, change: 'maximum changed from 10 to 5' },
    ])
  })

  it('reports a removed response or media type as breaking and an added one as not', () => {
    expect(changesAfter(doc => delete doc.paths['/stories/{slug}'].get.responses['404'])).toEqual([
      { breaking: true, at: 'GET /stories/{slug} response 404', change: 'response removed' },
    ])
    expect(changesAfter(doc => (doc.paths['/stories'].get.responses['400'] = { description: 'Bad request' }))).toEqual([
      { breaking: false, at: 'GET /stories response 400', change: 'response added' },
    ])
    expect(
      changesAfter(doc => {
        const content = doc.paths['/stories/{slug}'].get.responses['200'].content
        content['application/xml'] = content['application/json']
        delete content['application/json']
      }),
    ).toEqual([
      { breaking: true, at: 'GET /stories/{slug} response 200 application/json', change: 'media type removed' },
      { breaking: false, at: 'GET /stories/{slug} response 200 application/xml', change: 'media type added' },
    ])
  })

  it('follows a self-referencing schema without looping, reporting a change where it first appears', () => {
    expect(changesAfter(doc => (doc.components.schemas.Issue.properties.slug.type = 'integer'))).toEqual([
      { breaking: true, at: `${LIST}: data[].issue.slug`, change: 'type changed from string to integer' },
      { breaking: true, at: `${DETAIL}: issue.slug`, change: 'type changed from string to integer' },
    ])
  })

  it('reports a change to the security requirements as breaking', () => {
    expect(changesAfter(doc => (doc.security = [{ apiKey: [] }]))).toEqual([{ breaking: true, at: 'security', change: 'security requirements changed' }])
  })

  // The cases below each come with an addition, which alone could be refreshed without --accept-breaking
  const addRegion = (doc: any) => (doc.components.schemas.Story.properties.region = { type: 'string' })
  const regionAdded = [
    { breaking: false, at: `${LIST}: data[].region`, change: 'property added' },
    { breaking: false, at: `${DETAIL}: region`, change: 'property added' },
  ]

  it('reports a renamed schema component as breaking (generated clients name a type after it), beside other changes', () => {
    expect(
      changesAfter(doc => {
        doc.components.schemas.Topic = doc.components.schemas.Issue
        delete doc.components.schemas.Issue
        doc.components.schemas.Story.properties.issue.$ref = '#/components/schemas/Topic'
        addRegion(doc)
      }),
    ).toEqual([
      ...regionAdded,
      { breaking: true, at: 'components.schemas.Issue', change: 'schema component removed or renamed' },
      { breaking: false, at: 'components.schemas.Topic', change: 'schema component added' },
    ])
  })

  it('reports any change inside a union other than "or null" as breaking, beside other changes', () => {
    expect(
      changesAfter(doc => {
        doc.components.schemas.Image.properties.url.type = 'integer'
        addRegion(doc)
      }),
    ).toEqual([
      { breaking: true, at: `${LIST}: data[].media`, change: 'oneOf changed' },
      regionAdded[0],
      { breaking: true, at: `${DETAIL}: media`, change: 'oneOf changed' },
      regionAdded[1],
    ])
  })

  it('reports any change to a request body or a response header as breaking, beside other changes', () => {
    expect(
      changesAfter(doc => {
        doc.components.schemas.Feedback.properties.message.maxLength = 500
        doc.components.schemas.Count.type = 'number'
        addRegion(doc)
      }),
    ).toEqual([
      { breaking: true, at: 'POST /feedback response 200', change: 'headers changed' },
      { breaking: true, at: 'POST /feedback', change: 'requestBody changed' },
      ...regionAdded,
    ])
  })

  it('reports a change to a part of the document it does not compare as breaking, beside other changes', () => {
    expect(
      changesAfter(doc => {
        doc.openapi = '3.2.0'
        doc.paths['/stories'].servers = [{ url: 'https://other.example' }]
        addRegion(doc)
      }),
    ).toEqual([...regionAdded, { breaking: true, at: 'document', change: 'changed outside what this check compares: openapi, paths /stories' }])
  })

  it('reports a difference it cannot place at all, such as a change to an unused schema component, as breaking', () => {
    const unused = (type: string) => apiContract({ openapi: '3.1.0', components: { schemas: { Unused: { type } } } })
    expect(diffContracts(unused('string'), unused('integer'))).toEqual([
      { breaking: true, at: 'document', change: 'changed in a way this check does not classify' },
    ])
  })
})

describe('describeChanges', () => {
  it('lists the breaking changes first and says how to refresh the snapshot', () => {
    const text = describeChanges([
      { breaking: false, at: 'GET /a', change: 'operation added' },
      { breaking: true, at: 'GET /b', change: 'operation removed' },
    ])
    expect(text.indexOf('GET /b: operation removed')).toBeLessThan(text.indexOf('GET /a: operation added'))
    expect(text).toContain('npm run api:snapshot --prefix server')
    expect(text).toContain('--accept-breaking')
  })

  it('asks for the plain refresh when nothing is breaking', () => {
    const text = describeChanges([{ breaking: false, at: 'GET /a', change: 'operation added' }])
    expect(text).toContain('npm run api:snapshot --prefix server')
    expect(text).not.toContain('--accept-breaking')
  })
})

describe('the public API contract', () => {
  it('matches the committed snapshot (src/lib/openapi.snapshot.json)', () => {
    const committed = JSON.parse(readFileSync(API_SNAPSHOT_PATH, 'utf8'))
    const changes = diffContracts(committed, apiContract(getOpenAPIDocument()))
    if (changes.length > 0) expect.fail(describeChanges(changes))
  })
})
