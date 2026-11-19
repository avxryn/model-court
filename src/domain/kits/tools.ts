/**
 * `tools-v1` (spec 06, D-99): tool calling with mock tools. Each question holds the user's request,
 * 1–8 tools with canned responses, a step cap (1–6 provider calls per party) and the judge's
 * expectations. Every party runs a short loop against the same canned answers; its testimony is
 * the normalized tool trace. Six free checks over the trace, kept off the findings.
 * Published: never edit. A change ships as `tools-v2`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { LIMITS } from '../limits'
import { validate, type ToolSchema } from '../tools/json-schema'
import { argumentsMatch, parseArguments } from '../tools/mock'
import { toolTaskIssues, toolTaskOf, toolsFieldsSchema, type ToolsFields } from '../tools/task'
import { callsOf, type JurorToolCall, type JurorToolTrace } from '../tools/trace'
import { smallSampleCaveat } from './classification'
import { normalizeForMatchV1 } from './text'
import type { CheckContext, CheckDefinition, CheckOutcome, CheckResult, KitMetric, KitReadinessIssue, TaskKit } from './types'

/** No settings in v1; `{}` keeps the framework's settings slot explicit. */
export const toolsSettingsSchema = z.strictObject({})
export type ToolsSettings = z.infer<typeof toolsSettingsSchema>

export { toolsFieldsSchema }

type Check = CheckDefinition<ToolsSettings, ToolsFields>
type Ctx = CheckContext<ToolsSettings, ToolsFields>

function traceOf(ctx: Ctx): JurorToolTrace {
  if (ctx.testimony.kind !== 'toolTrace') throw new Error('tools check without a trace')
  return ctx.testimony.trace
}

function taskOf(ctx: Ctx): ToolsFields {
  if (!ctx.fields) throw new Error('tools check without a task')
  return ctx.fields
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function argsOf(call: JurorToolCall): Record<string, unknown> | null {
  const parsed = parseArguments(call.arguments)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

/** A call's first problem, or null when it names a defined tool and its arguments fit the schema. */
function callProblem(task: ToolsFields, call: JurorToolCall): string | null {
  const tool = task.tools.find((candidate) => candidate.name === call.tool)
  if (!tool || !call.knownTool) return `\`${call.tool}\` isn’t a defined tool`
  const args = argsOf(call)
  if (!args) return `\`${tool.name}\` arguments aren’t a readable JSON object`
  const issues = validate(tool.parameters as ToolSchema, args)
  return issues.length > 0 ? `\`${tool.name}\`: ${issues[0].message.replace(/\.$/u, '')}` : null
}

function describeRequired(call: ToolsFields['expect']['requiredCalls'][number]): string {
  const args = call.withArguments ? Object.entries(call.withArguments).slice(0, 3).map(([key, value]) => `\`${key}\` ${typeof value === 'string' ? value : JSON.stringify(value)}`) : []
  return args.length > 0 ? `\`${call.tool}\` with ${args.join(', ')}` : `\`${call.tool}\``
}

function satisfies(task: ToolsFields, call: JurorToolCall, required: ToolsFields['expect']['requiredCalls'][number]): boolean {
  if (call.tool !== required.tool || callProblem(task, call) !== null) return false
  return !required.withArguments || argumentsMatch(required.withArguments, argsOf(call)!, 'loose')
}

const requiredCalls: Check = {
  id: 'required-calls',
  label: 'Required calls made',
  description: 'Every call the judge marked as required was made with arguments that fit the schema and match the given values (text compared loosely); with "order matters", in that order. Calls the step cap left unanswered still count as made.',
  run: (ctx): CheckOutcome => {
    const task = taskOf(ctx)
    const calls = callsOf(traceOf(ctx))
    const required = task.expect.requiredCalls
    if (required.length === 0) return { status: 'na', reason: 'No required calls for this question.' }
    const missing: number[] = []
    if (task.expect.requireOrder) {
      let from = 0
      required.forEach((item, index) => {
        const at = calls.findIndex((call, position) => position >= from && satisfies(task, call, item))
        if (at < 0) missing.push(index)
        else from = at + 1
      })
    } else {
      required.forEach((item, index) => {
        if (!calls.some((call) => satisfies(task, call, item))) missing.push(index)
      })
    }
    const detail = { required: required.length, missing: missing.length }
    if (missing.length === 0) return { status: 'pass', reason: required.length === 1 ? 'The required call was made.' : `All ${required.length} required calls were made${task.expect.requireOrder ? ' in order' : ''}.`, detail }
    const first = describeRequired(required[missing[0]])
    const more = missing.length > 1 ? ` (and ${plural(missing.length - 1, 'other', 'others')})` : ''
    return { status: 'fail', reason: `Missing${task.expect.requireOrder ? ' or out of order' : ''}: ${first}${more}.`, detail }
  },
}

const forbiddenNotCalled: Check = {
  id: 'forbidden-not-called',
  label: 'Forbidden tools not called',
  description: 'No call went to a tool the judge marked as forbidden, whatever its arguments.',
  run: (ctx): CheckOutcome => {
    const task = taskOf(ctx)
    const trace = traceOf(ctx)
    const forbidden = new Set(task.expect.forbiddenTools)
    if (forbidden.size === 0) return { status: 'na', reason: 'No forbidden tools for this question.' }
    for (const step of trace.steps) {
      const call = step.calls.find((candidate) => forbidden.has(candidate.tool))
      if (call) return { status: 'fail', reason: `Called \`${call.tool}\` at step ${step.stepNo}.`, detail: { stepNo: step.stepNo } }
    }
    return { status: 'pass', reason: `No call to ${plural(forbidden.size, 'forbidden tool', 'forbidden tools')}.` }
  },
}

const argumentsValid: Check = {
  id: 'arguments-valid',
  label: 'Arguments valid',
  description: 'Every call names one of the defined tools and its arguments fit that tool’s schema.',
  run: (ctx): CheckOutcome => {
    const task = taskOf(ctx)
    const calls = callsOf(traceOf(ctx))
    if (calls.length === 0) return { status: 'na', reason: 'No calls were made.' }
    const problems = calls.map((call) => callProblem(task, call)).filter((problem): problem is string => problem !== null)
    const detail = { calls: calls.length, invalid: problems.length }
    if (problems.length === 0) return { status: 'pass', reason: calls.length === 1 ? 'The call is valid.' : `All ${calls.length} calls are valid.`, detail }
    return { status: 'fail', reason: `${problems.length} of ${plural(calls.length, 'call', 'calls')} invalid: ${problems[0]}.`, detail }
  },
}

const stepsUsed: Check = {
  id: 'steps-used',
  label: 'Within the target number of calls',
  description: 'The party used no more calls to its model than the judge’s target for this question.',
  run: (ctx): CheckOutcome => {
    const task = taskOf(ctx)
    const used = traceOf(ctx).steps.length
    const detail = { used, max: task.maxSteps }
    const target = task.expect.targetSteps
    if (target === undefined) return { status: 'na', reason: `Used ${used} of up to ${task.maxSteps} calls; no target set.`, detail }
    const reason = `Used ${used} of up to ${task.maxSteps} calls (target ${target}).`
    return { status: used <= target ? 'pass' : 'fail', reason, detail: { ...detail, target } }
  },
}

const finished: Check = {
  id: 'finished',
  label: 'Finished the task',
  description: 'The party gave a final answer instead of stopping at the step cap or at the output limit.',
  run: (ctx): CheckOutcome => {
    const trace = traceOf(ctx)
    if (trace.ended === 'answered') return { status: 'pass', reason: 'Gave a final answer.' }
    return { status: 'fail', reason: trace.ended === 'step_cap' ? 'Stopped at the step cap.' : 'Stopped: the reply was cut off at the output limit.' }
  },
}

const finalAnswer: Check = {
  id: 'final-answer',
  label: 'Final answer as expected',
  description: 'The final answer equals (exact) or contains the judge’s expected text, ignoring case, spacing, curly quotes, dashes and markdown emphasis.',
  run: (ctx): CheckOutcome => {
    const expected = taskOf(ctx).expect.finalAnswer
    const answer = traceOf(ctx).finalAnswer
    if (!expected) return { status: 'na', reason: 'No expected answer for this question.' }
    if (answer === null) return { status: 'fail', reason: 'No final answer.' }
    const have = normalizeForMatchV1(answer)
    const want = normalizeForMatchV1(expected.value)
    const shown = [...expected.value].slice(0, 60).join('')
    if (expected.mode === 'exact') return have === want ? { status: 'pass', reason: 'The final answer matches the expected answer.' } : { status: 'fail', reason: `The final answer isn’t “${shown}”.` }
    return have.includes(want) ? { status: 'pass', reason: `The final answer contains “${shown}”.` } : { status: 'fail', reason: `The final answer does not contain “${shown}”.` }
  },
}

const CHECKS = [requiredCalls, forbiddenNotCalled, argumentsValid, stepsUsed, finished, finalAnswer] as const

function resultOf(results: readonly CheckResult[], id: string): CheckResult | undefined {
  return results.find((result) => result.checkId === id)
}

function rate(rows: ReadonlyArray<{ results: CheckResult[] }>, id: string) {
  const decided = rows.map((row) => resultOf(row.results, id)).filter((result) => result && (result.status === 'pass' || result.status === 'fail'))
  return decided.length === 0 ? null : { numerator: decided.filter((result) => result!.status === 'pass').length, denominator: decided.length }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sortedValues = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sortedValues.length / 2)
  return sortedValues.length % 2 === 1 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2
}

/** Spec 06 §4.1: a question's kit fields, or undefined. */
function fieldsOf(testCase: Pick<CaseInput, 'kitFields'>): ToolsFields | undefined {
  return toolTaskOf(testCase.kitFields)
}

export const TOOLS_V1: TaskKit<ToolsSettings, ToolsFields> = {
  version: 'tools-v1',
  family: 'tools',
  name: 'Tool use (mock tools)',
  description: 'Each party may call tools you define; Model Court answers every call from your canned responses, and jurors judge the whole path and the final answer.',
  listed: true,
  inputKinds: ['tools'],
  outputContract: { kind: 'toolTrace' },
  settingsSchema: toolsSettingsSchema,
  caseFieldsSchema: toolsFieldsSchema,
  defaultSettings: {},
  draftIssues: (_settings, cases: ReadonlyArray<CaseInput>) =>
    cases.flatMap((testCase, index) => {
      const issues: Array<{ path: (string | number)[]; message: string }> = []
      if (testCase.messages !== undefined) issues.push({ path: ['cases', index, 'messages'], message: 'A tool-use question can’t carry a conversation.' })
      const fields = fieldsOf(testCase)
      if (fields) for (const issue of toolTaskIssues(fields)) issues.push({ path: ['cases', index, 'kitFields', ...issue.path], message: issue.message })
      return issues
    }),
  readinessIssues: (_settings, cases): KitReadinessIssue[] =>
    cases.flatMap((testCase): KitReadinessIssue[] => (fieldsOf(testCase) ? [] : [{ kind: 'kit_tools_missing' as const, caseKey: testCase.key, kitVersion: 'tools-v1' }])),
  selectTemplate: () => 'tools-v1',
  defaultRubricVersion: 'tools-trajectory-v1',
  defaultJuryInstructions: 'Judge the whole path: did it call the right tools with sensible arguments, use what the tools returned, handle errors, stop when it was done, and give a correct final answer?',
  checks: CHECKS,
  metrics: ({ rows, configurationKeys }): KitMetric[] => {
    const own = (key: string) => rows.filter((row) => row.configurationKey === key)
    const rates: KitMetric[] = CHECKS.map((check) => {
      const decidedCases = new Set(rows.filter((row) => { const result = resultOf(row.results, check.id); return result?.status === 'pass' || result?.status === 'fail' }).map((row) => row.caseKey)).size
      return { id: check.id, label: check.label, byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, rate(own(key), check.id)])), caveat: smallSampleCaveat(decidedCases) }
    })
    const usedBy = (key: string) => own(key).map((row) => resultOf(row.results, 'steps-used')?.detail.used).filter((value): value is number => typeof value === 'number')
    const calls: KitMetric = {
      id: 'median-calls',
      label: 'Calls to its model (median per question)',
      byConfiguration: Object.fromEntries(configurationKeys.map((key) => [key, null])),
      values: Object.fromEntries(configurationKeys.map((key) => [key, median(usedBy(key))])),
      unit: 'calls',
      caveat: null,
    }
    return [...rates, calls]
  },
  jurorCaseView: (_settings, fields) =>
    fields ? { kind: 'tools', tools: fields.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })), maxSteps: fields.maxSteps } : null,
}

/** Paid calls one answer of this question may make: its step cap (spec 06 §7.1). */
export function toolCallsPerAnswer(testCase: Pick<CaseInput, 'kitFields'>): number {
  return fieldsOf(testCase)?.maxSteps ?? LIMITS.tools.defaultMaxSteps
}
