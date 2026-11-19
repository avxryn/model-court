import { describe, expect, it } from 'vitest'
import { answerCalls, type ModelCall } from './mock'
import { EXAMPLE_TOOL_TASK } from './task'
import { finishTrace, formatArguments, jurorTrace, prettyJson, traceCalls, UNREADABLE_ARGUMENTS, type TraceStep } from './trace'

const PROVIDER_ID_PREFIXES = ['call_', 'fc_', 'rs_', 'msg_', 'toolu_', 'srvtoolu_']

function modelCall(name: string, raw: string): ModelCall {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  return { name, argumentsRaw: raw, argumentsParsed: parsed }
}

function step(stepNo: number, text: string | null, calls: ModelCall[], answered: boolean, firstCallNo: number, finishReason = 'end_turn'): TraceStep {
  const answers = answered ? answerCalls(EXAMPLE_TOOL_TASK, calls, firstCallNo - 1) : null
  return { stepNo, text, calls: traceCalls(EXAMPLE_TOOL_TASK, calls, answers, firstCallNo), finishReason, truncated: false }
}

describe('arguments formatting (spec 06 §10.1)', () => {
  it('formats both providers alike: sorted keys, 2-space indent, numbers normalized', () => {
    const openAi = modelCall('lookup_order', '{"order_id":"A-1042","qty":1.0}')
    const anthropic = modelCall('lookup_order', JSON.stringify({ qty: 1, order_id: 'A-1042' }))
    expect(formatArguments(openAi)).toBe(formatArguments(anthropic))
    expect(formatArguments(openAi)).toBe('{\n  "order_id": "A-1042",\n  "qty": 1\n}')
    expect(formatArguments(modelCall('x', '{"a":"\\u00e9"}'))).toBe(formatArguments(modelCall('x', '{"a":"é"}')))
  })

  it('marks unreadable arguments and previews oversized ones', () => {
    expect(formatArguments(modelCall('x', '{"a": '))).toBe(UNREADABLE_ARGUMENTS)
    const big = formatArguments(modelCall('x', JSON.stringify({ a: 'y'.repeat(5000) })))
    expect(big.endsWith('…')).toBe(true)
    expect(new TextEncoder().encode(big).byteLength).toBeLessThanOrEqual(1024 + 3)
  })

  it('keeps __proto__ a plain key', () => {
    expect(prettyJson(JSON.parse('{"__proto__": {"x": 1}, "b": 2}'))).toBe('{\n  "__proto__": {\n    "x": 1\n  },\n  "b": 2\n}')
  })
})

describe('traces', () => {
  it('numbers calls across the trace and keeps the answer source in the full trace', () => {
    const steps = [
      step(1, 'Let me look that up.', [modelCall('lookup_order', '{"order_id":"A-1042"}')], true, 1, 'tool_use'),
      step(2, null, [modelCall('refund_shipping', '{"order_id":"a-1042"}'), modelCall('cancel_order', '{}')], true, 2, 'tool_use'),
      step(3, 'Refunded $6.50; it arrives in 3 to 5 business days.', [], false, 4),
    ]
    const trace = finishTrace(steps, 'answered')
    expect(trace.steps.flatMap((s) => s.calls.map((c) => c.callNo))).toEqual([1, 2, 3])
    expect(trace.steps[1].calls[0]).toMatchObject({ source: 'match', responseIndex: 0, result: { text: '{"refunded": 6.5, "currency": "USD"}', isError: false } })
    expect(trace.steps[1].calls[1]).toMatchObject({ tool: 'cancel_order', knownTool: false, source: 'unknown_tool', result: { isError: true } })
    expect(trace.finalAnswer).toBe('Refunded $6.50; it arrives in 3 to 5 business days.')
    expect(trace.steps[2].text).toBeNull()
    expect(trace.steps[0].text).toBe('Let me look that up.')
  })

  it('a step-cap trace has no final answer and unsent last calls', () => {
    const steps = [step(1, 'Checking.', [modelCall('lookup_order', '{"order_id":"A-1042"}')], true, 1), step(2, 'One more.', [modelCall('refund_shipping', '{"order_id":"A-1042"}')], false, 2)]
    const trace = finishTrace(steps, 'step_cap')
    expect(trace.finalAnswer).toBeNull()
    expect(trace.steps[1].text).toBe('One more.')
    expect(trace.steps[1].calls[0]).toMatchObject({ result: { notSent: true }, source: null })
  })

  it('the juror projection is an allowlist', () => {
    const steps = [step(1, 'Checking.', [modelCall('lookup_order', '{"order_id":"A-1042"}'), modelCall('lookup_order', '{}')], true, 1, 'tool_use'), step(2, 'Done.', [], false, 3, 'end_turn')]
    const full = finishTrace(steps, 'answered')
    // Anything a stored trace might carry must not follow.
    const tampered = JSON.parse(JSON.stringify(full)) as typeof full & Record<string, unknown>
    ;(tampered as Record<string, unknown>).replay = { provider: 'openai', items: [{ id: 'rs_123' }] }
    ;(tampered.steps[0] as unknown as Record<string, unknown>).callIds = ['call_abc', 'toolu_01']
    ;(tampered.steps[0].calls[0] as unknown as Record<string, unknown>).id = 'fc_1'
    const juror = jurorTrace(tampered)
    const json = JSON.stringify(juror)
    for (const prefix of PROVIDER_ID_PREFIXES) expect(json).not.toContain(prefix)
    for (const word of ['source', 'responseIndex', 'issues', 'finishReason', 'truncated', 'end_turn', 'tool_use', 'replay', 'version']) expect(json).not.toContain(word)
    expect(Object.keys(juror).sort()).toEqual(['ended', 'finalAnswer', 'steps'])
    expect(Object.keys(juror.steps[0]).sort()).toEqual(['calls', 'stepNo', 'text'])
    expect(Object.keys(juror.steps[0].calls[0]).sort()).toEqual(['arguments', 'callNo', 'knownTool', 'result', 'tool'])
    expect(Object.keys(juror.steps[0].calls[1].result).sort()).toEqual(['isError', 'text'])
  })
})
