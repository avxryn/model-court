import { describe, expect, it } from 'vitest'
import { schemaIssues, validate, validatePartial } from './json-schema'

const order = { type: 'object', properties: { order_id: { type: 'string', minLength: 3, maxLength: 10 }, qty: { type: 'integer', minimum: 1, maximum: 5 }, note: { type: ['string', 'null'] } }, required: ['order_id'], additionalProperties: false }

describe('schemaIssues (spec 06 §4.2)', () => {
  it('accepts every supported keyword', () => {
    const schema = {
      type: 'object',
      description: 'All of them',
      properties: {
        s: { type: 'string', minLength: 1, maxLength: 9, enum: ['a', 'b'], description: 'text' },
        n: { type: 'number', minimum: 0, maximum: 1.5 },
        i: { type: 'integer', const: 3 },
        b: { type: 'boolean' },
        z: { type: 'null' },
        maybe: { type: ['integer', 'null'] },
        list: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] }, minItems: 1, maxItems: 4 },
      },
      required: ['s'],
      additionalProperties: false,
    }
    expect(schemaIssues(schema)).toEqual([])
  })

  it('refuses unsupported keywords with a fix', () => {
    const refused = ['$ref', '$defs', 'pattern', 'format', 'anyOf', 'oneOf', 'allOf', 'not', 'if']
    for (const keyword of refused) {
      const issues = schemaIssues({ type: 'object', properties: { a: { type: 'string', [keyword]: 'x' } } })
      expect(issues.map((issue) => issue.path)).toContain(`properties.a.${keyword}`)
    }
    expect(schemaIssues({ type: 'object', properties: { a: { type: 'string', pattern: '^a' } } })[0].message).toMatch(/description instead/)
    expect(schemaIssues({ type: 'object', propertyNames: {} })[0].message).toMatch(/isn’t supported/)
  })

  it('needs an object at the top', () => {
    expect(schemaIssues({ type: 'string' })[0]).toEqual({ path: 'type', message: 'The top level must be `"type": "object"`.' })
    expect(schemaIssues([])[0].path).toBe('')
    expect(schemaIssues({ type: ['object', 'null'] }).length).toBeGreaterThan(0)
  })

  it('takes a nullable pair but not other unions', () => {
    expect(schemaIssues({ type: 'object', properties: { a: { type: ['string', 'null'] } } })).toEqual([])
    expect(schemaIssues({ type: 'object', properties: { a: { type: ['string', 'integer'] } } }).length).toBe(1)
    expect(schemaIssues({ type: 'object', properties: { a: { type: ['null', 'null'] } } }).length).toBe(1)
  })

  it('caps depth at 4 and properties at 24', () => {
    const nest = (levels: number): Record<string, unknown> => (levels === 0 ? { type: 'string' } : { type: 'object', properties: { a: nest(levels - 1) } })
    expect(schemaIssues(nest(5))).toEqual([])
    expect(schemaIssues(nest(6)).some((issue) => /nest at most 4/.test(issue.message))).toBe(true)
    const many = (count: number) => ({ type: 'object', properties: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, { type: 'string' }])) })
    expect(schemaIssues(many(24))).toEqual([])
    expect(schemaIssues(many(25)).at(-1)?.message).toMatch(/at most 24 arguments/)
  })

  it('caps the size at 4 KiB', () => {
    expect(schemaIssues({ type: 'object', description: 'x'.repeat(900) })).toEqual([])
    const big = { type: 'object', properties: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`p${i}`, { type: 'string', description: 'x'.repeat(900) }])) }
    expect(schemaIssues(big)[0].message).toMatch(/at most 4 KiB/)
  })

  it('refuses reserved and odd argument names, and required names not listed', () => {
    expect(schemaIssues({ type: 'object', properties: JSON.parse('{"__proto__": {"type": "string"}}') }).length).toBe(1)
    expect(schemaIssues({ type: 'object', properties: { 'two words': { type: 'string' } } }).length).toBe(1)
    expect(schemaIssues({ type: 'object', properties: {}, required: ['missing'] })[0].message).toMatch(/not listed/)
    expect(schemaIssues({ type: 'object', additionalProperties: true })[0].path).toBe('additionalProperties')
  })

  it('refuses keywords on the wrong type', () => {
    expect(schemaIssues({ type: 'object', properties: { a: { type: 'string', minimum: 1 } } })[0].message).toMatch(/numbers only/)
    expect(schemaIssues({ type: 'object', properties: { a: { type: 'integer', items: { type: 'string' } } } })[0].message).toMatch(/lists only/)
  })
})

describe('validate', () => {
  it('passes a fitting value', () => {
    expect(validate(order, { order_id: 'A-1042', qty: 2, note: null })).toEqual([])
    expect(validate(order, { order_id: 'A-1042', qty: 2.0 })).toEqual([])
  })

  it('reports with stable paths', () => {
    expect(validate(order, {})).toEqual([{ path: 'order_id', message: '`order_id` is required.' }])
    expect(validate(order, { order_id: 7 })).toEqual([{ path: 'order_id', message: '`order_id` must be text, not integer.' }])
    expect(validate(order, { order_id: 'A-1', qty: 1.5 })[0]).toEqual({ path: 'qty', message: '`qty` must be a whole number, not number.' })
    expect(validate(order, { order_id: 'AB', qty: 9, extra: 1 }).map((issue) => issue.path)).toEqual(['order_id', 'qty', 'extra'])
    expect(validate(order, 'text')[0].message).toBe('The arguments must be an object, not string.')
  })

  it('checks enum, const and list bounds', () => {
    const schema = { type: 'object', properties: { c: { type: 'string', enum: ['red', 'blue'] }, k: { type: 'integer', const: 1 }, l: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 2 } } }
    expect(validate(schema, { c: 'green' })[0].message).toBe('`c` must be one of "red", "blue".')
    expect(validate(schema, { k: 2 })[0].message).toBe('`k` must be 1.')
    expect(validate(schema, { l: [] })[0].message).toMatch(/at least 1/)
    expect(validate(schema, { l: [1, 'x'] })[0].path).toBe('l.1')
  })

  it('returns at most 5 issues', () => {
    const schema = { type: 'object', properties: {}, additionalProperties: false }
    const value = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`k${i}`, i]))
    expect(validate(schema, value)).toHaveLength(5)
  })

  it('never follows __proto__', () => {
    const value = JSON.parse('{"order_id": "A-1042", "__proto__": {"order_id": 1}}')
    expect(validate(order, value)).toEqual([{ path: '__proto__', message: '`__proto__` isn’t an argument of this tool.' }])
  })
})

describe('validatePartial', () => {
  it('takes known keys with fitting values and leaves required out', () => {
    expect(validatePartial(order, {})).toEqual([])
    expect(validatePartial(order, { qty: 2 })).toEqual([])
    expect(validatePartial(order, { qty: 'two' })[0].path).toBe('qty')
    expect(validatePartial(order, { colour: 'red' })[0].message).toMatch(/isn’t an argument/)
    expect(validatePartial(order, [])[0].path).toBe('')
  })
})
