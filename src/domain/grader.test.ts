import { describe, expect, it } from 'vitest'
import { calibrate, type CalibrationItem } from './calibration'
import { buildGraderRequest, parseGraderOutput } from './grader'
import { RUBRIC, rubricLines } from './rubric'

describe('grader-v1 request (D-40)', () => {
  it('carries the scoring guide and the one response, and no party identity', () => {
    const request = buildGraderRequest(RUBRIC, { input: 'Q?', reference: 'REF', expectedBehavior: 'GUIDE-TEXT', response: 'RESPONSE-TEXT' })
    const body = JSON.stringify(request)
    expect(body).toContain('GUIDE-TEXT')
    expect(body).toContain('RESPONSE-TEXT')
    for (const forbidden of ['openai', 'anthropic', 'gpt-6-luna', 'claude-haiku', 'Testimony A', 'Party', 'Candidate']) expect(body).not.toContain(forbidden)
    expect(request.messages).toHaveLength(1)
  })

  it('describes the hearing’s rubric lines', () => {
    expect(JSON.stringify(buildGraderRequest(rubricLines('safety-v1'), { input: 'q', reference: '', expectedBehavior: 'g', response: 'r' }))).toContain('Injection resistance')
  })
})

describe('strict grader output parser', () => {
  it('accepts exactly the object, optionally fenced', () => {
    expect(parseGraderOutput('{"correctness":2,"completeness":1,"grounding":0,"note":"Invents a fee."}')).toEqual({ correctness: 2, completeness: 1, grounding: 0, note: 'Invents a fee.' })
    expect(parseGraderOutput('```json\n{"correctness":2,"completeness":2,"grounding":2,"note":""}\n```')).not.toBeNull()
  })

  it('rejects prose, extra keys, missing keys, and out-of-range scores', () => {
    expect(parseGraderOutput('Here you go: {"correctness":2,"completeness":2,"grounding":2,"note":""}')).toBeNull()
    expect(parseGraderOutput('{"correctness":2,"completeness":2,"grounding":2,"note":"","party":"A"}')).toBeNull()
    expect(parseGraderOutput('{"correctness":2,"completeness":2,"note":""}')).toBeNull()
    expect(parseGraderOutput('{"correctness":3,"completeness":2,"grounding":2,"note":""}')).toBeNull()
    expect(parseGraderOutput('{"correctness":"2","completeness":2,"grounding":2,"note":""}')).toBeNull()
    expect(parseGraderOutput('not json')).toBeNull()
  })
})

describe('calibration math', () => {
  const s = (c: number, co: number, g: number) => ({ correctness: c, completeness: co, grounding: g })
  const items: CalibrationItem[] = [
    { caseKey: 'q1', configurationKey: 'A', grader: { ...s(2, 2, 2), note: '' }, jurors: [s(2, 2, 1), s(2, 1, 2)] },
    { caseKey: 'q1', configurationKey: 'B', grader: { ...s(0, 1, 0), note: 'Invents a refund.' }, jurors: [s(1, 1, 1), s(1, 2, 1)] },
    { caseKey: 'q2', configurationKey: 'A', grader: { ...s(2, 1, 2), note: '' }, jurors: [s(2, 1, 2)] },
    { caseKey: 'q2', configurationKey: 'B', grader: { ...s(1, 1, 1), note: '' }, jurors: [] }, // unrated: excluded
  ]

  it('computes range agreement, exact-median agreement, and distance per line', () => {
    const result = calibrate(items, 2)
    expect(result.items).toBe(3)
    expect(result.byDimension.correctness).toMatchObject({ items: 3, withinJuryRange: 2 / 3, exactWithMedian: 2 / 3 })
    expect(result.byDimension.correctness.meanAbsoluteDifference).toBeCloseTo((0 + 1 + 0) / 3)
    expect(result.byDimension.completeness.withinJuryRange).toBe(1)
    expect(result.byDimension.grounding.withinJuryRange).toBeCloseTo(2 / 3)
  })

  it('compares the top party and lists out-of-range scores with the grader’s note', () => {
    const result = calibrate(items, 2)
    expect(result.graderTop).toEqual(['A'])
    expect(result.juryTop).toEqual(['A'])
    expect(result.sameTopParty).toBe(true)
    expect(result.disagreements.map((d) => [d.caseKey, d.configurationKey, d.dimension, d.grader, d.juryMin, d.juryMax])).toEqual([
      ['q1', 'B', 'correctness', 0, 1, 1],
      ['q1', 'B', 'grounding', 0, 1, 1],
    ])
    expect(result.disagreements[0].note).toBe('Invents a refund.')
    expect(result.caveat).toMatch(/3 graded responses and 2 jurors: too few/)
  })

  it('reports no top-party verdict on a tie or with nothing rated', () => {
    expect(calibrate([], 0).sameTopParty).toBeNull()
    const tie = calibrate([items[0], { ...items[2], configurationKey: 'B', grader: { ...items[0].grader } }], 1)
    expect(tie.sameTopParty).toBeNull()
  })
})
