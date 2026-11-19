import { describe, expect, it } from 'vitest'
import { draftInputSchema, type CaseInput } from '../contracts'
import { makeExampleDraft } from '../example'
import { buildKitRequest, buildToolPrompt, MESSAGE_TEMPLATES } from '../messages'
import { plannedCalls, plannedCallsAreUpperBound, quotaBlock, quotaStanding } from '../quota'
import { MODEL_ROUTES } from '../registry'
import { rubricLines } from '../rubric'
import { buildSnapshot, describeIssue, readinessIssues } from '../snapshot'
import { answerCalls, type ModelCall } from '../tools/mock'
import { EXAMPLE_TOOL_TASK, type ToolsFields } from '../tools/task'
import { finishTrace, jurorTrace, traceCalls, type TraceEnd, type TraceStep } from '../tools/trace'
import { jurorKitView } from './registry'
import { runChecks } from './runner'
import { TOOLS_V1 } from './tools'
import type { TaskKit } from './types'

const kit = TOOLS_V1 as TaskKit<unknown, unknown>
const fields: ToolsFields = { kind: 'tools', ...EXAMPLE_TOOL_TASK }

function caseWith(overrides: Partial<ToolsFields> = {}): CaseInput {
  return {
    key: '00000000-0000-4000-8000-000000000061',
    title: 'Late order',
    input: 'Where is my order A-1042? If it is late, refund the shipping.',
    reference: '',
    expectedBehavior: 'Looks the order up before refunding.',
    kitFields: { ...fields, ...overrides },
  }
}

function modelCall(name: string, args: unknown): ModelCall {
  const raw = typeof args === 'string' ? args : JSON.stringify(args)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  return { name, argumentsRaw: raw, argumentsParsed: parsed }
}

/** Steps of [text, calls]; the last step's calls are unanswered when the trace ends at the cap. */
function trace(steps: Array<[string | null, ModelCall[]]>, ended: TraceEnd) {
  const built: TraceStep[] = []
  let callNo = 1
  steps.forEach(([text, calls], index) => {
    const last = index === steps.length - 1
    const answers = last && ended !== 'answered' ? null : calls.length > 0 ? answerCalls(fields, calls, callNo - 1) : []
    built.push({ stepNo: index + 1, text, calls: traceCalls(fields, calls, answers, callNo), finishReason: 'x', truncated: false })
    callNo += calls.length
  })
  return finishTrace(built, ended)
}

function check(steps: Array<[string | null, ModelCall[]]>, ended: TraceEnd = 'answered', overrides: Partial<ToolsFields> = {}) {
  const full = trace(steps, ended)
  return runChecks(kit, {}, caseWith(overrides), { kind: 'toolTrace', text: full.finalAnswer ?? '', trace: jurorTrace(full) }).results.map((result) => `${result.checkId}: ${result.status} — ${result.reason}`)
}

const lookup = modelCall('lookup_order', { order_id: 'A-1042' })
const refund = modelCall('refund_shipping', { order_id: 'a-1042 ' })

describe('tools-v1 checks (spec 06 §8.2)', () => {
  it('the right path passes every check', () => {
    expect(check([['Let me check.', [lookup]], [null, [refund]], ['Refunded $6.50. It arrives in 3 to 5 business days.', []]])).toEqual([
      'required-calls: pass — All 2 required calls were made in order.',
      'forbidden-not-called: na — No forbidden tools for this question.',
      'arguments-valid: pass — All 2 calls are valid.',
      'steps-used: pass — Used 3 of up to 4 calls (target 3).',
      'finished: pass — Gave a final answer.',
      'final-answer: pass — The final answer contains “3 to 5 business days”.',
    ])
  })

  it('order matters when the judge says so', () => {
    const results = check([[null, [refund]], [null, [lookup]], ['Done, 3 to 5 business days.', []]])
    expect(results[0]).toBe('required-calls: fail — Missing or out of order: `refund_shipping` with `order_id` A-1042.')
    expect(check([[null, [refund]], [null, [lookup]], ['Done.', []]], 'answered', { expect: { ...fields.expect, requireOrder: false } })[0]).toBe('required-calls: pass — All 2 required calls were made.')
  })

  it('invalid and unknown calls fail arguments-valid and do not satisfy a required call', () => {
    const results = check([[null, [modelCall('lookup_order', { id: 'A-1042' }), modelCall('cancel_order', {})]], ['Sorry.', []]])
    expect(results[0]).toBe('required-calls: fail — Missing or out of order: `lookup_order` with `order_id` A-1042 (and 1 other).')
    expect(results[2]).toBe('arguments-valid: fail — 2 of 2 calls invalid: `lookup_order`: `order_id` is required.')
    expect(check([[null, [modelCall('lookup_order', '{"order_id": ')]], ['?', []]])[2]).toBe('arguments-valid: fail — 1 of 1 call invalid: `lookup_order` arguments aren’t a readable JSON object.')
  })

  it('a forbidden tool fails, naming the step', () => {
    const results = check([[null, [lookup]], [null, [refund]], ['Done.', []]], 'answered', { expect: { ...fields.expect, requiredCalls: [{ tool: 'lookup_order' }], forbiddenTools: ['refund_shipping'] } })
    expect(results[1]).toBe('forbidden-not-called: fail — Called `refund_shipping` at step 2.')
  })

  it('a step-cap trace fails finished and the final answer, and over-target fails steps-used', () => {
    const results = check([[null, [lookup]], ['Still working.', [lookup]], [null, [lookup]], [null, [refund]]], 'step_cap')
    expect(results[0]).toBe('required-calls: pass — All 2 required calls were made in order.')
    expect(results[3]).toBe('steps-used: fail — Used 4 of up to 4 calls (target 3).')
    expect(results[4]).toBe('finished: fail — Stopped at the step cap.')
    expect(results[5]).toBe('final-answer: fail — No final answer.')
  })

  it('a truncated trace says so', () => {
    expect(check([['Partial answer', []]], 'truncated')[4]).toBe('finished: fail — Stopped: the reply was cut off at the output limit.')
  })

  it('no calls, no expectations: the call checks do not apply', () => {
    const none = { expect: { requiredCalls: [], requireOrder: false, forbiddenTools: [] } }
    expect(check([['I cannot help with that.', []]], 'answered', none)).toEqual([
      'required-calls: na — No required calls for this question.',
      'forbidden-not-called: na — No forbidden tools for this question.',
      'arguments-valid: na — No calls were made.',
      'steps-used: na — Used 1 of up to 4 calls; no target set.',
      'finished: pass — Gave a final answer.',
      'final-answer: na — No expected answer for this question.',
    ])
  })

  it('exact final answers compare after loose normalization', () => {
    const exact = { expect: { ...fields.expect, finalAnswer: { mode: 'exact' as const, value: 'Refunded “6.50”' } } }
    expect(check([['**refunded  "6.50"**', []]], 'answered', exact)[5]).toBe('final-answer: pass — The final answer matches the expected answer.')
    expect(check([['Refunded 6.5', []]], 'answered', exact)[5]).toBe('final-answer: fail — The final answer isn’t “Refunded “6.50””.')
  })

  it('checks never see provider metadata: a tampered trace is re-projected', () => {
    const full = trace([[null, [lookup]], ['Done.', []]], 'answered') as unknown as Record<string, unknown>
    full.replay = { items: [{ id: 'call_secret' }] }
    const results = runChecks(kit, {}, caseWith(), { kind: 'toolTrace', text: 'Done.', trace: full as never })
    expect(JSON.stringify(results)).not.toContain('call_secret')
    expect(results.results.every((result) => result.status !== 'error')).toBe(true)
  })

  it('a check without a trace is an error, never a fail', () => {
    const results = runChecks(kit, {}, caseWith(), { kind: 'text', text: 'x' }).results
    expect(results.every((result) => result.status === 'error')).toBe(true)
  })

  it('metrics: pass rates and the median number of calls per party', () => {
    const full = trace([[null, [lookup]], [null, [refund]], ['3 to 5 business days', []]], 'answered')
    const row = runChecks(kit, {}, caseWith(), { kind: 'toolTrace', text: full.finalAnswer ?? '', trace: jurorTrace(full) })
    const metrics = TOOLS_V1.metrics!({ settings: {}, cases: [caseWith()], rows: [{ caseKey: 'c', configurationKey: 'p', results: row.results }], configurationKeys: ['p'] })
    expect(metrics.find((metric) => metric.id === 'finished')?.byConfiguration.p).toEqual({ numerator: 1, denominator: 1 })
    expect(metrics.find((metric) => metric.id === 'median-calls')?.values?.p).toBe(3)
  })
})

describe('tools-v1 draft and readiness (spec 06 §4.1)', () => {
  const example = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])
  const draftWith = (testCase: CaseInput) => ({ ...example, kit: { version: 'tools-v1' as const, settings: {} }, cases: [testCase] })
  const issuePaths = (testCase: CaseInput) => {
    const parsed = draftInputSchema.safeParse(draftWith(testCase))
    return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  }

  it('the example task is valid', () => {
    expect(issuePaths(caseWith())).toEqual([])
  })

  it('refuses duplicate names, unknown and overlapping expectations, bad schemas and conditions', () => {
    const tool = fields.tools[0]
    const bad = caseWith({
      tools: [tool, { ...tool, parameters: { type: 'object', properties: { order_id: { type: 'string', pattern: '^A' } } }, responses: [{ when: { colour: 'red' }, textMatch: 'loose', output: 'x', isError: false }] }],
      maxSteps: 2,
      expect: { requiredCalls: [{ tool: 'nope' }, { tool: 'lookup_order', withArguments: { order_id: 7 } }], requireOrder: false, forbiddenTools: ['lookup_order', 'ghost'], targetSteps: 3 },
    })
    expect(issuePaths(bad)).toEqual([
      'cases.0.kitFields.tools.1.name: Two tools are named “lookup_order”. Tool names must be unique.',
      'cases.0.kitFields.tools.1.parameters.properties.order_id.pattern: `pattern` isn’t supported. Say the format in the description instead.',
      'cases.0.kitFields.expect.requiredCalls.0.tool: “nope” isn’t one of this question’s tools.',
      'cases.0.kitFields.expect.requiredCalls.1.withArguments.order_id: `order_id` must be text, not integer.',
      'cases.0.kitFields.expect.forbiddenTools.0: “lookup_order” is both required and forbidden.',
      'cases.0.kitFields.expect.forbiddenTools.1: “ghost” isn’t one of this question’s tools.',
      'cases.0.kitFields.expect.targetSteps: The target (3 calls) is more than the step cap (2).',
    ])
    expect(issuePaths(caseWith({ tools: [{ ...tool, responses: [{ when: { colour: 'red' }, textMatch: 'loose', output: 'x', isError: false }] }] }))).toEqual([
      'cases.0.kitFields.tools.0.responses.0.when.colour: `colour` isn’t an argument of this tool.',
      'cases.0.kitFields.expect.requiredCalls.1.tool: “refund_shipping” isn’t one of this question’s tools.',
    ])
  })

  it('enforces the caps at the limit and one over', () => {
    const tool = fields.tools[0]
    const many = (count: number) => Array.from({ length: count }, (_, i) => ({ ...tool, name: `tool_${i}` }))
    const loose = { requiredCalls: [], requireOrder: false, forbiddenTools: [] }
    expect(issuePaths(caseWith({ tools: many(8), expect: loose }))).toEqual([])
    expect(issuePaths(caseWith({ tools: many(9), expect: loose }))[0]).toMatch(/At most 8 tools/)
    expect(issuePaths(caseWith({ maxSteps: 6 }))).toEqual([])
    expect(issuePaths(caseWith({ maxSteps: 7 })).length).toBe(1)
    expect(issuePaths(caseWith({ maxSteps: 0 })).length).toBeGreaterThan(0)
    expect(issuePaths(caseWith({ tools: [{ ...tool, name: '1bad' }], expect: loose }))[0]).toMatch(/starts with a letter/)
    expect(issuePaths(caseWith({ tools: [{ ...tool, responses: Array.from({ length: 11 }, () => tool.responses[0]) }], expect: loose }))[0]).toMatch(/At most 10 responses/)
    expect(issuePaths(caseWith({ tools: [{ ...tool, defaultResponse: { output: 'x'.repeat(4001), isError: false } }], expect: loose }))[0]).toMatch(/Default response must be 1–4,000/)
    const bigOutput = 'y'.repeat(3_900)
    const heavy = Array.from({ length: 4 }, (_, i) => ({ ...tool, name: `t${i}`, defaultResponse: { output: bigOutput, isError: false } }))
    expect(issuePaths(caseWith({ tools: heavy, expect: loose })).at(-1)).toMatch(/at most 12 KiB together/)
  })

  it('a tool question cannot carry a conversation or come without tools at Start', () => {
    const withHistory = { ...caseWith(), messages: [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'hello' }] }
    expect(issuePaths(withHistory)).toContain('cases.0.messages: A tool-use question can’t carry a conversation.')
    const bare = { ...caseWith(), kitFields: undefined }
    const issues = readinessIssues(draftWith(bare), MODEL_ROUTES).filter((issue) => issue.kind === 'kit_tools_missing')
    expect(issues).toHaveLength(1)
    expect(describeIssue(issues[0], [bare])).toBe('Every tool-use question needs at least one tool. Add one to Q1.')
  })

  it('Start needs a recorded live tool check on every party, and no imported party', () => {
    const draft = draftWith(caseWith())
    const issues = readinessIssues(draft, MODEL_ROUTES)
    expect(issues.map((issue) => issue.kind)).toEqual(['tools_unverified', 'tools_unverified'])
    expect(describeIssue(issues[0])).toContain("OpenAI GPT-6 Luna hasn't passed a live tool check yet")
    const checked = MODEL_ROUTES.map((route) => ({ ...route, toolsVerifiedAt: '2026-11-19' }))
    expect(readinessIssues(draft, checked)).toEqual([])
    const imported = { ...draft, comparisonMode: 'configuration' as const, configurations: [draft.configurations[0], { kind: 'imported' as const, key: crypto.randomUUID(), label: 'Logs', provenance: { sourceType: 'other' as const, description: 'x', redacted: false } }] }
    expect(readinessIssues(imported, checked).map((issue) => issue.kind)).toContain('tools_imported_unsupported')
  })

  it('records the kit, template and rubric', () => {
    const snap = buildSnapshot({ ...draftWith(caseWith()), schemaVersion: 1 } as never, MODEL_ROUTES, 'test', 0)
    expect([snap.kit?.version, snap.messageTemplateVersion, snap.rubricVersion]).toEqual(['tools-v1', 'tools-v1', 'tools-trajectory-v1'])
  })
})

describe('tools-v1 requests (spec 06 §6.1, §10.4)', () => {
  const snapshot = { messageTemplateVersion: 'tools-v1' as const, kit: { version: 'tools-v1', settings: {} } }

  it('the user message is the qa-v1 envelope, and the tools are picked field by field', () => {
    const prompt = buildToolPrompt(snapshot, 'You are a support agent.', { ...caseWith(), reference: 'Policy: refund shipping on late orders.' })
    const plain = buildKitRequest({ messageTemplateVersion: 'qa-v1' }, 'You are a support agent.', { reference: 'Policy: refund shipping on late orders.', input: caseWith().input })
    expect(prompt?.user).toBe(plain?.messages[0].content)
    expect(prompt?.tools.map((tool) => Object.keys(tool))).toEqual([['name', 'description', 'parameters'], ['name', 'description', 'parameters']])
  })

  it('canned responses, expectations and jury instructions never reach a request (sentinel test)', () => {
    const tool = { ...fields.tools[0], responses: [{ when: {}, textMatch: 'loose' as const, output: 'SENTINEL-ROW', isError: false }], defaultResponse: { output: 'SENTINEL-DEFAULT', isError: false }, errorResponse: { output: 'SENTINEL-ERROR' } }
    const sentinel = { ...caseWith({ tools: [tool], expect: { requiredCalls: [{ tool: 'lookup_order', withArguments: { order_id: 'SENTINEL-ARG' } }], requireOrder: false, forbiddenTools: [], finalAnswer: { mode: 'exact', value: 'SENTINEL-ANSWER' } } }), expectedBehavior: 'SENTINEL-JURY', title: 'SENTINEL-TITLE' }
    expect(JSON.stringify(buildToolPrompt(snapshot, 'S', sentinel))).not.toContain('SENTINEL')
    expect(JSON.stringify(MESSAGE_TEMPLATES['tools-v1'].build({ systemPrompt: 'S', prompt: { reference: '', input: 'i' }, settings: {} }))).not.toContain('SENTINEL')
  })

  it('refuses a question without a task or another template', () => {
    expect(buildToolPrompt(snapshot, 'S', { ...caseWith(), kitFields: undefined })).toBeNull()
    expect(buildToolPrompt({ messageTemplateVersion: 'qa-v1' }, 'S', caseWith())).toBeNull()
  })
})

describe('tools-v1 planned calls and the juror view', () => {
  const example = makeExampleDraft(() => crypto.randomUUID(), ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

  it('plans the worst case: Σ step caps × parties × samples (spec 06 §7.1)', () => {
    const draft = { ...example, cases: [caseWith(), caseWith({ maxSteps: 6 })] }
    expect(plannedCalls(draft)).toBe((4 + 6) * 2)
    expect(plannedCalls({ ...draft, samplesPerAnswer: 2 })).toBe(40)
    expect(plannedCallsAreUpperBound(draft)).toBe(true)
    expect(plannedCallsAreUpperBound(example)).toBe(false)
    expect(plannedCalls(example)).toBe(example.cases.length * 2)
    const standing = quotaStanding({ dailyPerUser: 20, dailyGlobal: 100, lifetimeGlobal: 1000 }, { userToday: 4, globalToday: 4, globalLifetime: 4 }, 0)
    expect(quotaBlock(plannedCalls(draft), standing)?.message).toMatch(/This hearing needs 20 calls/)
  })

  it('jurors see the tools and the step cap, never responses or expectations', () => {
    const view = jurorKitView({ kit: { version: 'tools-v1', settings: {} } }, caseWith())
    expect(view).toEqual({ kind: 'tools', tools: fields.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), maxSteps: 4 })
    const json = JSON.stringify(view)
    for (const hidden of ['responses', 'defaultResponse', 'errorResponse', 'expect', 'shipping_paid', '3 to 5']) expect(json).not.toContain(hidden)
  })

  it('the rubric has three lines with every anchor', () => {
    const lines = rubricLines('tools-trajectory-v1')
    expect([lines.correctness.label, lines.completeness.label, lines.grounding.label]).toEqual(['Final answer', 'Path', 'Use of results'])
    for (const line of Object.values(lines)) expect(Object.keys(line.anchors)).toEqual(['0', '1', '2'])
  })
})
