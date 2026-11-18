import { describe, expect, it } from 'vitest'
import type { CaseInput } from '../contracts'
import { GENERAL_V1 } from './general'
import { passedEvery, summarizeChecks } from './summary'
import type { CheckResult, TaskKit } from './types'

const kit: TaskKit<unknown, unknown> = {
  ...(GENERAL_V1 as TaskKit<unknown, unknown>),
  version: 'test-v1',
  checks: [
    { id: 'a', label: 'A', description: 'First.', run: () => ({ status: 'pass', reason: '' }) },
    { id: 'b', label: 'B', description: 'Second.', run: () => ({ status: 'pass', reason: '' }) },
  ],
  metrics: ({ rows, cases }) => [{ id: 'rows', label: 'Rows', byConfiguration: { x: { numerator: rows.length, denominator: cases.length } }, caveat: null }],
}

const cases = ['q1', 'q2', 'q3'].map((key) => ({ key, title: key, input: 'i', reference: '', expectedBehavior: 'e' }) as CaseInput)
const r = (a: CheckResult['status'], b: CheckResult['status']): CheckResult[] => [
  { checkId: 'a', status: a, reason: '', detail: {} },
  { checkId: 'b', status: b, reason: '', detail: {} },
]

describe('summarizeChecks', () => {
  it('counts eligible questions only, per party and check, and passes every check only without fail or error', () => {
    const summary = summarizeChecks({
      kit,
      settings: undefined,
      cases,
      eligibleCaseKeys: ['q1', 'q2'],
      configurationKeys: ['x', 'y'],
      rows: [
        { caseKey: 'q1', configurationKey: 'x', results: r('pass', 'na') },
        { caseKey: 'q2', configurationKey: 'x', results: r('fail', 'pass') },
        { caseKey: 'q3', configurationKey: 'x', results: r('fail', 'fail') },
        { caseKey: 'q1', configurationKey: 'y', results: r('error', 'pass') },
      ],
    })
    expect(summary.kitVersion).toBe('test-v1')
    expect(summary.definitions.map((d) => d.id)).toEqual(['a', 'b'])
    expect(summary.byConfiguration.x).toEqual({ a: { pass: 1, fail: 1, na: 0, error: 0 }, b: { pass: 1, fail: 0, na: 1, error: 0 } })
    expect(summary.byConfiguration.y).toEqual({ a: { pass: 0, fail: 0, na: 0, error: 1 }, b: { pass: 1, fail: 0, na: 0, error: 0 } })
    expect(summary.allPassed).toEqual({ x: { numerator: 1, denominator: 2 }, y: { numerator: 0, denominator: 1 } })
    expect(summary.metrics[0].byConfiguration.x).toEqual({ numerator: 3, denominator: 2 })
    expect(summary.allPassedSamples).toBeNull()
  })

  it('reports passing samples per generated party with repeats', () => {
    const summary = summarizeChecks({
      kit,
      settings: undefined,
      cases,
      eligibleCaseKeys: ['q1'],
      configurationKeys: ['x', 'imported'],
      rows: [],
      sampleRows: [
        { caseKey: 'q1', configurationKey: 'x', results: r('pass', 'pass') },
        { caseKey: 'q1', configurationKey: 'x', results: r('fail', 'pass') },
        { caseKey: 'q2', configurationKey: 'x', results: r('pass', 'pass') },
      ],
    })
    expect(summary.allPassedSamples).toEqual({ x: { numerator: 1, denominator: 2 } })
  })

  it('treats pass and n/a as passing, fail and error as not', () => {
    expect(passedEvery([])).toBe(true)
    expect(passedEvery(r('pass', 'na'))).toBe(true)
    expect(passedEvery(r('pass', 'error'))).toBe(false)
  })
})
