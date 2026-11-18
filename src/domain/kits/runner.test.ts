import { describe, expect, it } from 'vitest'
import type { CaseInput } from '../contracts'
import { CHECK_ERROR_REASON, RUNNER_CHECK_ID, runChecks } from './runner'
import { GENERAL_V1 } from './general'
import type { CheckContext, TaskKit } from './types'

const testCase: CaseInput = {
  key: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  input: 'Question',
  reference: 'Exhibit',
  expectedBehavior: 'Answer key',
  language: 'en',
  messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello' },
  ],
}

function kitWith(checks: TaskKit<unknown, unknown>['checks']): TaskKit<unknown, unknown> {
  return { ...(GENERAL_V1 as TaskKit<unknown, unknown>), version: 'test-v1', checks }
}

describe('runChecks', () => {
  it('a throwing check yields error and the others still run', () => {
    const kit = kitWith([
      { id: 'boom', label: 'Boom', description: 'Throws.', run: () => { throw new Error('secret text') } },
      { id: 'ok', label: 'Ok', description: 'Passes.', run: () => ({ status: 'pass', reason: 'Fine.' }) },
      { id: 'bad', label: 'Bad', description: 'Returns an invalid status.', run: () => ({ status: 'error' as never, reason: 'x' }) },
    ])
    const { kitVersion, results } = runChecks(kit, undefined, testCase, { kind: 'text', text: 'answer' })
    expect(kitVersion).toBe('test-v1')
    expect(results).toEqual([
      { checkId: 'boom', status: 'error', reason: CHECK_ERROR_REASON, detail: {} },
      { checkId: 'ok', status: 'pass', reason: 'Fine.', detail: {} },
      { checkId: 'bad', status: 'error', reason: CHECK_ERROR_REASON, detail: {} },
    ])
  })

  it('a runner-level fault yields one _runner error', () => {
    const kit = { ...kitWith([]), get checks(): never { throw new Error('fault') } }
    expect(runChecks(kit, undefined, testCase, { kind: 'text', text: 'a' }).results).toEqual([{ checkId: RUNNER_CHECK_ID, status: 'error', reason: CHECK_ERROR_REASON, detail: {} }])
  })

  it('sees content only: the context keys are exactly testimony, testCase, fields, settings', () => {
    let seen: CheckContext<unknown, unknown> | null = null
    const kit = kitWith([{ id: 'spy', label: 'Spy', description: 'Records its context.', run: (ctx) => { seen = ctx; return { status: 'na', reason: 'n/a' } } }])
    runChecks(kit, { limit: 1 }, { ...testCase, kitFields: { kind: 'general' } as never }, { kind: 'text', text: 'answer' })
    expect(Object.keys(seen!).sort()).toEqual(['fields', 'settings', 'testCase', 'testimony'])
    expect(Object.keys(seen!.testCase).sort()).toEqual(['expectedBehavior', 'input', 'key', 'kitFields', 'reference'])
    expect(seen!.fields).toEqual({ kind: 'general' })
    expect(seen!.settings).toEqual({ limit: 1 })
    expect(seen!.testimony).toEqual({ kind: 'text', text: 'answer' })
  })

  it('narrows fields to the kit family', () => {
    let fields: unknown = 'unset'
    const kit = kitWith([{ id: 'f', label: 'F', description: 'Reads fields.', run: (ctx) => { fields = ctx.fields; return { status: 'na', reason: '' } } }])
    runChecks(kit, undefined, { ...testCase, kitFields: { kind: 'classification' } as never }, { kind: 'text', text: '' })
    expect(fields).toBeUndefined()
  })

  it('caps reasons, detail, count and total size', () => {
    const long = `${'x'.repeat(400)}\u0007\n`
    const kit = kitWith(
      Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        label: 'C',
        description: 'Big.',
        run: () => ({ status: 'fail' as const, reason: `  Line\none\u0000 ${long}`, detail: (i === 0 ? { big: 'y'.repeat(2_000) } : { n: i, ok: true, list: [1, 'a'], bad: { nested: 1 }, nan: Number.NaN }) as never }),
      })),
    )
    const { results } = runChecks(kit, undefined, testCase, { kind: 'text', text: '' })
    expect(results).toHaveLength(20)
    expect([...results[0].reason].length).toBe(300)
    expect(results[0].reason.startsWith('Line one ')).toBe(true)
    expect(results[0].reason).not.toMatch(/[\u0000-\u001f]/u)
    expect(results[0].detail).toEqual({})
    expect(results[1].detail).toEqual({ n: 1, ok: true, list: [1, 'a'] })
    expect(new TextEncoder().encode(JSON.stringify(results)).byteLength).toBeLessThanOrEqual(16 * 1024)
  })

  it('shrinks a result set over 16 KiB', () => {
    const kit = kitWith(
      Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: 'C', description: 'Wide.', run: () => ({ status: 'fail' as const, reason: '漢'.repeat(300), detail: { s: 'z'.repeat(900) } }) })),
    )
    const { results } = runChecks(kit, undefined, testCase, { kind: 'text', text: '' })
    expect(new TextEncoder().encode(JSON.stringify(results)).byteLength).toBeLessThanOrEqual(16 * 1024)
    expect(results).toHaveLength(20)
  })

  it('general-v1 has no checks, so it produces no results', () => {
    expect(runChecks(GENERAL_V1 as TaskKit<unknown, unknown>, undefined, testCase, { kind: 'text', text: 'a' }).results).toEqual([])
  })
})
