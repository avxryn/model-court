import { describe, expect, it } from 'vitest'
import { answerCall, answerCalls, describeAnswer, looseText, OVER_STEP_CAP_TEXT, OVER_TRACE_CAP_TEXT, type ModelCall } from './mock'
import { EXAMPLE_TOOL_TASK, type ToolTask } from './task'

function call(name: string, args: unknown): ModelCall {
  const raw = typeof args === 'string' ? args : JSON.stringify(args)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  return { name, argumentsRaw: raw, argumentsParsed: parsed }
}

const at = { inStep: 0, inTrace: 0 }

const task: ToolTask = {
  ...EXAMPLE_TOOL_TASK,
  tools: [
    {
      name: 'search',
      description: 'Search the catalog',
      parameters: { type: 'object', properties: { q: { type: 'string' }, limit: { type: 'integer' }, filters: { type: 'object', properties: { colour: { type: 'string' } } } }, required: ['q'] },
      responses: [
        { when: { q: 'Red  Lamp' }, textMatch: 'loose', output: 'row 1', isError: false },
        { when: { q: 'Red Lamp' }, textMatch: 'exact', output: 'row 2', isError: false },
        { when: { limit: 1 }, textMatch: 'exact', output: 'row 3', isError: false },
        { when: { filters: { colour: 'BLUE' } }, textMatch: 'loose', output: 'row 4', isError: false },
        { when: {}, textMatch: 'loose', output: 'row 5 (any)', isError: true },
      ],
      defaultResponse: { output: 'nothing', isError: false },
      errorResponse: { output: 'bad search' },
    },
  ],
}

describe('answerCall (spec 06 §8.1)', () => {
  it('the first matching row wins', () => {
    expect(answerCall(task, call('search', { q: 'red lamp' }), at)).toMatchObject({ output: 'row 1', source: 'match', responseIndex: 0, isError: false })
    expect(answerCall(task, call('search', { q: '  RED\tlamp ' }), at).responseIndex).toBe(0)
  })

  it('exact rows compare text exactly; loose rows fold case, spacing and Unicode form', () => {
    const exactOnly: ToolTask = { ...task, tools: [{ ...task.tools[0], responses: [task.tools[0].responses[1]] }] }
    expect(answerCall(exactOnly, call('search', { q: 'Red Lamp' }), at).source).toBe('match')
    expect(answerCall(exactOnly, call('search', { q: 'red lamp' }), at).source).toBe('default')
    expect(looseText('Café  Noir ')).toBe(looseText('café noir'))
  })

  it('numbers compare numerically', () => {
    expect(answerCall(task, call('search', '{"q": "x", "limit": 1.0}'), at).output).toBe('row 3')
  })

  it('nested values match by their own keys', () => {
    expect(answerCall(task, call('search', { q: 'x', filters: { colour: 'blue' } }), at).output).toBe('row 4')
  })

  it('{} matches any valid call', () => {
    expect(answerCall(task, call('search', { q: 'anything' }), at)).toMatchObject({ output: 'row 5 (any)', isError: true, responseIndex: 4 })
  })

  it('falls back to the default response', () => {
    const noCatchAll: ToolTask = { ...task, tools: [{ ...task.tools[0], responses: task.tools[0].responses.slice(0, 4) }] }
    expect(answerCall(noCatchAll, call('search', { q: 'chair' }), at)).toEqual({ output: 'nothing', isError: false, source: 'default', responseIndex: null, issues: [] })
  })

  it('invalid arguments get the error response with issues', () => {
    const missing = answerCall(task, call('search', {}), at)
    expect(missing).toMatchObject({ output: 'bad search', isError: true, source: 'invalid_arguments' })
    expect(missing.issues).toEqual([{ path: 'q', message: '`q` is required.' }])
    expect(answerCall(task, call('search', '{"q": '), at).issues[0].message).toBe('The arguments are not valid JSON.')
    expect(answerCall(task, call('search', '[1]'), at).issues[0].message).toBe('The arguments must be a JSON object.')
    expect(answerCall(task, call('search', { q: 'x'.repeat(5000) }), at).issues[0].message).toMatch(/over 4 KiB/)
    // D-105: the size is measured on the canonical text, so padding in a provider's spelling does not count.
    expect(answerCall(task, call('search', `{"q": "red lamp"${' '.repeat(5000)}}`), at).source).toBe('match')
  })

  it('an unknown tool gets a fixed error naming it, capped', () => {
    expect(answerCall(task, call('delete_everything', {}), at)).toEqual({ output: 'Unknown tool "delete_everything".', isError: true, source: 'unknown_tool', responseIndex: null, issues: [] })
    expect(answerCall(task, call('x'.repeat(100), {}), at).output).toBe(`Unknown tool "${'x'.repeat(64)}".`)
  })

  it('caps calls per step and per trace', () => {
    expect(answerCall(task, call('search', { q: 'a' }), { inStep: 8, inTrace: 8 })).toMatchObject({ output: OVER_STEP_CAP_TEXT, source: 'over_cap', isError: true })
    expect(answerCall(task, call('search', { q: 'a' }), { inStep: 0, inTrace: 24 })).toMatchObject({ output: OVER_TRACE_CAP_TEXT, source: 'over_cap' })
    const answers = answerCalls(task, Array.from({ length: 10 }, () => call('search', { q: 'a' })), 0)
    expect(answers.filter((answer) => answer.source === 'over_cap')).toHaveLength(2)
    expect(answerCalls(task, [call('search', { q: 'a' })], 23)[0].source).toBe('match')
  })

  it('is deterministic', () => {
    const calls = [call('search', { q: 'red lamp' }), call('nope', {}), call('search', {})]
    expect(answerCalls(task, calls, 0)).toEqual(answerCalls(task, calls, 0))
  })

  it('explains itself for "Try a call"', () => {
    expect(describeAnswer(answerCall(task, call('search', { q: 'red lamp' }), at))).toBe('Matched response 1.')
    expect(describeAnswer(answerCall(task, call('search', {}), at))).toBe('The arguments don’t fit the schema, so the error response is sent: `q` is required.')
  })
})
