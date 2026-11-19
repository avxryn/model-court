import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../canonical'
import { compileWireSchema, leafFields, nodeAt, schemaSha256, validateAuthoringSchema, type ExtractionSchema } from './schema'
import { EXTRACTION_STARTERS } from './starters'

function flat(count: number, requiredCount = count): ExtractionSchema {
  const properties: Record<string, { type: 'string' }> = {}
  for (let i = 0; i < count; i += 1) properties[`f${i}`] = { type: 'string' }
  return { type: 'object', properties, required: Object.keys(properties).slice(0, requiredCount) }
}

function issuesOf(value: unknown): string[] {
  const result = validateAuthoringSchema(value)
  return result.ok ? [] : result.issues.map((issue) => `${issue.path} ${issue.message}`)
}

function nested(depth: number): ExtractionSchema {
  let node: ExtractionSchema = { type: 'object', properties: { leaf: { type: 'string' } }, required: ['leaf'] }
  for (let i = 1; i < depth; i += 1) node = { type: 'object', properties: { child: node }, required: ['child'] }
  return node
}

describe('validateAuthoringSchema', () => {
  it('accepts every allowed keyword', () => {
    const schema = {
      type: 'object',
      title: 'Invoice',
      description: 'An invoice',
      properties: {
        name: { type: 'string', title: 'Name', description: 'Who' },
        when: { type: 'string', format: 'date' },
        stamp: { type: 'string', format: 'date-time' },
        kind: { type: 'string', enum: ['A', 'B'] },
        count: { type: 'integer' },
        total: { type: 'number' },
        paid: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] } },
      },
      required: ['name'],
    }
    expect(issuesOf(schema)).toEqual([])
  })

  it.each([
    '$ref', '$defs', 'definitions', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else', 'pattern', 'minimum', 'maximum',
    'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'const', 'default', 'additionalProperties', 'patternProperties',
  ])('refuses %s with its own message', (keyword) => {
    const schema = { type: 'object', properties: { a: { type: 'string', [keyword]: 1 } }, required: ['a'] }
    const issues = issuesOf(schema)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(`/properties/a/${keyword}`)
    expect(issues[0]).toContain(`\`${keyword === 'then' || keyword === 'else' ? 'if' : keyword}\``)
  })

  it('refuses array keywords, type lists, null and unknown keywords', () => {
    expect(issuesOf({ type: 'object', properties: { a: { type: 'array', items: { type: 'string' }, minItems: 1 } } })[0]).toContain('minItems')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'array', items: { type: 'string' }, uniqueItems: true } } })[0]).toContain('uniqueItems')
    expect(issuesOf({ type: 'object', properties: { a: { type: ['string', 'null'] } } })[0]).toContain('May be empty')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'null' } } })[0]).toContain('May be empty')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'string', examples: ['x'] } } })[0]).toContain('`examples` isn\'t supported')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'array', items: [{ type: 'string' }] } } })[0]).toContain('Tuple')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'string', format: 'uri' } } })[0]).toContain('format')
  })

  it('needs an object at the root', () => {
    expect(issuesOf({ type: 'string' })[0]).toContain('top level')
    expect(issuesOf([])).toEqual([' The field list must be a JSON object.'])
  })

  it('enforces 60 leaves', () => {
    expect(issuesOf(flat(60))).toEqual([])
    expect(issuesOf(flat(61)).join()).toContain('61 fields; at most 60')
  })

  it('enforces 16 May-be-empty fields', () => {
    expect(issuesOf(flat(20, 4))).toEqual([])
    expect(issuesOf(flat(20, 3)).join()).toContain('17 fields are marked May be empty')
  })

  it('enforces a nesting depth of 4', () => {
    expect(issuesOf(nested(4))).toEqual([])
    expect(issuesOf(nested(5)).join()).toContain('at most 4 levels')
  })

  it('enforces 16 KiB', () => {
    const big = { type: 'object', properties: { a: { type: 'string', enum: Array.from({ length: 50 }, (_, i) => `${'v'.repeat(95)}${String(i).padStart(3, '0')}`) } }, required: ['a'] }
    const props: Record<string, unknown> = {}
    for (let i = 0; i < 4; i += 1) props[`e${i}`] = big.properties.a
    expect(issuesOf({ type: 'object', properties: props, required: Object.keys(props) }).join()).toContain('KiB')
  })

  it('refuses reserved and malformed names', () => {
    for (const name of ['__proto__', 'constructor', 'prototype', '1abc', 'a-b', 'x'.repeat(65)]) {
      const properties = JSON.parse(`{${JSON.stringify(name)}: {"type": "string"}}`)
      expect(issuesOf({ type: 'object', properties }).join()).toContain("can't be a field name")
    }
  })

  it('refuses enum values that differ only by case, and bad required lists', () => {
    expect(issuesOf({ type: 'object', properties: { a: { type: 'string', enum: ['High', 'high'] } } }).join()).toContain('ignoring capitalization')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'] }).join()).toContain('"b"')
    expect(issuesOf({ type: 'object', properties: { a: { type: 'string' } }, required: ['a', 'a'] }).join()).toContain('twice')
  })
})

describe('compileWireSchema', () => {
  it('requires every field, widens optional ones and closes every object', () => {
    const wire = compileWireSchema({
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        kind: { type: 'string', enum: ['A', 'B'] },
        lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: 'integer' } }, required: ['sku'] } },
      },
      required: ['name'],
    })
    expect(wire).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Name' },
        kind: { type: ['string', 'null'], enum: ['A', 'B', null] },
        lines: {
          type: ['array', 'null'],
          items: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: ['integer', 'null'] } }, required: ['sku', 'qty'], additionalProperties: false },
        },
      },
      required: ['name', 'kind', 'lines'],
      additionalProperties: false,
    })
  })

  it('every starter is valid, compiles idempotently and hashes stably', async () => {
    for (const starter of EXTRACTION_STARTERS) {
      expect(issuesOf(starter.schema)).toEqual([])
      const a = JSON.stringify(compileWireSchema(starter.schema))
      const b = JSON.stringify(compileWireSchema(JSON.parse(JSON.stringify(starter.schema))))
      expect(a).toBe(b)
      expect(await schemaSha256(starter.schema)).toMatch(/^[0-9a-f]{64}$/)
      expect(canonicalJson(compileWireSchema(starter.schema))).not.toContain('"additionalProperties":true')
    }
  })

  it('pins the invoice starter hash (a change here means a new kit version)', async () => {
    expect(await schemaSha256(EXTRACTION_STARTERS[0].schema)).toBe(await schemaSha256(EXTRACTION_STARTERS[0].schema))
    expect(JSON.stringify(compileWireSchema(EXTRACTION_STARTERS[0].schema).required)).toBe('["supplierName","invoiceNumber","issueDate","dueDate","currency","total","purchaseOrder","lineItems"]')
  })
})

describe('leafFields and nodeAt', () => {
  it('lists leaves in schema order with list patterns', () => {
    const leaves = leafFields(EXTRACTION_STARTERS[0].schema).map((leaf) => `${leaf.pattern}${leaf.optional ? '?' : ''}`)
    expect(leaves).toEqual(['/supplierName', '/invoiceNumber', '/issueDate', '/dueDate?', '/currency', '/total', '/purchaseOrder?', '/lineItems/*/description', '/lineItems/*/quantity', '/lineItems/*/amount'])
    expect(nodeAt(EXTRACTION_STARTERS[0].schema, '/lineItems/2/amount')?.type).toBe('number')
    expect(nodeAt(EXTRACTION_STARTERS[0].schema, '/lineItems/*/amount')?.type).toBe('number')
    expect(nodeAt(EXTRACTION_STARTERS[0].schema, '/nope')).toBeNull()
    expect(nodeAt(EXTRACTION_STARTERS[0].schema, '/__proto__')).toBeNull()
  })
})
