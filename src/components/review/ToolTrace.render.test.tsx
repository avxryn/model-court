import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolsQuestionFields } from '@/components/evaluations/ToolTaskEditor'
import { KitFacts } from '@/components/review/KitFacts'
import { stepLine } from '@/components/hearing/GenerationSection'
import type { CaseInput } from '@/domain/contracts'
import { answerCalls, type ModelCall } from '@/domain/tools/mock'
import { blankToolTask, EXAMPLE_TOOL_TASK } from '@/domain/tools/task'
import { finishTrace, jurorTrace, traceCalls, type TraceStep } from '@/domain/tools/trace'
import { argumentSummary, describeSource, ToolTraceView } from './ToolTrace'

function call(name: string, raw: string): ModelCall {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  return { name, argumentsRaw: raw, argumentsParsed: parsed }
}

function trace(ended: 'answered' | 'step_cap' | 'truncated') {
  const first = [call('lookup_order', '{"order_id":"A-1042"}'), call('cancel_order', '{}'), call('refund_shipping', '{"order_id": ')]
  const steps: TraceStep[] = [
    { stepNo: 1, text: 'Let me check <b>that</b>.', calls: traceCalls(EXAMPLE_TOOL_TASK, first, answerCalls(EXAMPLE_TOOL_TASK, first, 0), 1), finishReason: 'tool_use', truncated: false },
    { stepNo: 2, text: ended === 'step_cap' ? 'One more.' : 'Refunded. 3 to 5 business days.', calls: ended === 'step_cap' ? traceCalls(EXAMPLE_TOOL_TASK, [call('refund_shipping', '{"order_id":"A-1042"}')], null, 4) : [], finishReason: 'end_turn', truncated: ended === 'truncated' },
  ]
  return finishTrace(steps, ended)
}

describe('ToolTraceView (juror worksheet)', () => {
  it('shows steps, calls with uniform arguments, error results and the final answer, as escaped text', () => {
    const html = renderToStaticMarkup(<ToolTraceView label="A" trace={jurorTrace(trace('answered'))} maxSteps={4} />)
    expect(html).toContain('TESTIMONY A')
    expect(html).toContain('Step 1')
    expect(html).toContain('Called <code class="font-mono text-[0.85em]">lookup_order</code>')
    expect(html).toContain('{\n  &quot;order_id&quot;: &quot;A-1042&quot;\n}')
    expect(html).toContain('(not a defined tool)')
    expect(html).toContain('Error result')
    expect(html).toContain('(unreadable)')
    expect(html).toContain('Final answer')
    expect(html).toContain('Refunded. 3 to 5 business days.')
    expect(html).toContain('Let me check &lt;b&gt;that&lt;/b&gt;.')
    expect(html).not.toContain('<b>')
    // Nothing from after unsealing before it.
    for (const hidden of ['Answered by response', 'default response', ' in · ', 'tool_use', 'end_turn']) expect(html).not.toContain(hidden)
  })

  it('a step-cap trace says why it stopped and marks unanswered calls', () => {
    const html = renderToStaticMarkup(<ToolTraceView label="B" trace={jurorTrace(trace('step_cap'))} maxSteps={2} />)
    expect(html).toContain('Stopped: step cap reached (2 of 2 calls). No final answer.')
    expect(html).toContain('Not run: the loop ended before this call was answered.')
    expect(html).toContain('One more.')
  })

  it('a truncated trace keeps its partial answer and says it was cut off', () => {
    const html = renderToStaticMarkup(<ToolTraceView label="C" trace={jurorTrace(trace('truncated'))} />)
    expect(html).toContain('Final answer')
    expect(html).toContain('Stopped: the reply was cut off at the output limit.')
  })

  it('after unsealing: which response answered each call, and per-step usage', () => {
    const full = trace('answered')
    const html = renderToStaticMarkup(<ToolTraceView label="Party 1" trace={jurorTrace(full)} full={full} usage={[{ stepNo: 1, inputTokens: 200, outputTokens: 30, durationMs: 1200, finishReason: 'tool_use', truncated: false }]} />)
    expect(html).toContain('Answered by response 1')
    expect(html).toContain('Not a defined tool: the fixed error')
    expect(html).toContain('Arguments didn’t fit: the error response (The arguments are not valid JSON)')
    expect(html).toContain('200 in · 30 out · 1.2 s')
    expect(describeSource({ source: 'default', responseIndex: null, issues: [] })).toBe('No response matched: the default response')
  })
})

describe('the tools jurors see (KitFacts)', () => {
  it('names, descriptions and a readable argument summary; never canned responses or expectations', () => {
    const view = { kind: 'tools' as const, tools: EXAMPLE_TOOL_TASK.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), maxSteps: 4 }
    const html = renderToStaticMarkup(<KitFacts view={view} kitName="Tool use (mock tools)" />)
    expect(html).toContain('lookup_order')
    expect(html).toContain('Arguments: order_id (text, required)')
    expect(html).toContain('up to 4 calls')
    for (const hidden of ['shipping_paid', 'No order with that ID', '3 to 5 business days']) expect(html).not.toContain(hidden)
    expect(argumentSummary({ type: 'object', properties: { note: { type: ['string', 'null'] } } })).toBe('note (text or null)')
    expect(argumentSummary({ type: 'object' })).toBe('No arguments')
  })
})

describe('the judge’s editor (ToolTaskEditor)', () => {
  const testCase: CaseInput = { key: '00000000-0000-4000-8000-000000000071', title: 'Late order', input: 'Where is A-1042?', reference: '', expectedBehavior: 'x', kitFields: { kind: 'tools', ...EXAMPLE_TOOL_TASK } }

  it('shows the tools, responses, step cap, expectations and "Try a call", with the never-sent labels', () => {
    const html = renderToStaticMarkup(<ToolsQuestionFields testCase={testCase} index={0} errors={{}} onChange={() => {}} />)
    expect(html).toContain('names, descriptions and argument schemas are sent to the models')
    expect(html).toContain('Row 1: when these arguments')
    expect(html).toContain('Default response (no row matched)')
    expect(html).toContain('Error response (arguments didn’t fit the schema)')
    expect(html).toContain('Each party may make up to 4 calls to its model for this question.')
    expect(html).toContain('never sent to the models; checked for free after each answer')
    expect(html).toContain('runs here in your browser; nothing is sent')
    expect(html).toContain('Use the example (order lookup)')
  })

  it('shows a refused keyword and a server error under their fields', () => {
    const bad = { ...testCase, kitFields: { ...blankToolTask(), tools: [{ ...blankToolTask().tools[0], parameters: { type: 'object', properties: { a: { type: 'string', pattern: '^x' } } } }] } }
    const html = renderToStaticMarkup(<ToolsQuestionFields testCase={bad} index={0} errors={{ 'cases.0.kitFields.tools.0.name': 'Two tools are named “tool_1”.' }} onChange={() => {}} />)
    expect(html).toContain('`pattern` isn’t supported. Say the format in the description instead.')
    expect(html).toContain('Two tools are named “tool_1”.')
  })

  it('the hearing page says how far each loop got', () => {
    expect(stepLine('running', { used: 2, max: 4 })).toBe('Step 2 of up to 4')
    expect(stepLine('pending', { used: 0, max: 4 })).toBe('Up to 4 calls')
    expect(stepLine('succeeded', { used: 3, max: 4 })).toBe('3 of up to 4 calls used')
  })
})
