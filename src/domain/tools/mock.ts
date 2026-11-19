/**
 * Mock answering (spec 06 §8.1, D-99). Pure, deterministic and stateless: the result of a call
 * depends only on the frozen task and that call, so parties cannot affect each other and replaying
 * a trace reproduces it. No fetch, no eval, no templates, no judge-written regular expressions.
 * Shared by the tool loop and the judge's "Try a call" panel.
 */

import { LIMITS } from '../limits'
import { utf8ByteLength } from '../text'
import { jsonEqual, validate, type SchemaIssue, type ToolSchema } from './json-schema'
import type { CannedResponse, ToolTask } from './task'

export type CallSource = 'match' | 'default' | 'invalid_arguments' | 'unknown_tool' | 'over_cap'

/** A call as a party made it, before Model Court answers it. */
export interface ModelCall {
  name: string
  /** The arguments as the provider returned them (OpenAI: a JSON string; Anthropic: the object serialized). */
  argumentsRaw: string
  /** The parsed arguments; undefined when they are not valid JSON. */
  argumentsParsed: unknown
}

export interface MockAnswer {
  output: string
  isError: boolean
  source: CallSource
  /** The matching row of the tool's responses (0-based), for `match` only. */
  responseIndex: number | null
  issues: SchemaIssue[]
}

export const OVER_STEP_CAP_TEXT = `Too many tool calls at once. Only the first ${LIMITS.tools.callsPerStep} in a step were run.`
export const OVER_TRACE_CAP_TEXT = `Too many tool calls for this task. Only the first ${LIMITS.tools.callsPerTrace} were run.`

export function unknownToolText(name: string): string {
  return `Unknown tool "${capName(name)}".`
}

/** A model-invented name as shown and sent back: at most 64 characters. */
export function capName(name: string): string {
  return [...name].slice(0, 64).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `loose` text: NFC, trimmed, whitespace runs collapsed to one space, lower case. */
export function looseText(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

function valueMatches(expected: unknown, actual: unknown, mode: CannedResponse['textMatch']): boolean {
  if (typeof expected === 'string' && typeof actual === 'string') return mode === 'loose' ? looseText(expected) === looseText(actual) : expected === actual
  if (Array.isArray(expected) && Array.isArray(actual)) return expected.length === actual.length && expected.every((item, index) => valueMatches(item, actual[index], mode))
  if (isRecord(expected) && isRecord(actual)) {
    const keys = Object.keys(expected)
    return keys.length === Object.keys(actual).length && keys.every((key) => Object.hasOwn(actual, key) && valueMatches(expected[key], actual[key], mode))
  }
  return jsonEqual(expected, actual)
}

/** Every key of `when` is present in the arguments and equal there (numbers numerically, text per `mode`). */
export function argumentsMatch(when: Record<string, unknown>, args: Record<string, unknown>, mode: CannedResponse['textMatch']): boolean {
  return Object.keys(when).every((key) => Object.hasOwn(args, key) && valueMatches(when[key], args[key], mode))
}

/** Whether parsed arguments are usable: a plain object within the stored-size cap that fits the schema. */
export function argumentIssues(schema: ToolSchema, call: Pick<ModelCall, 'argumentsRaw' | 'argumentsParsed'>): SchemaIssue[] {
  if (utf8ByteLength(call.argumentsRaw) > LIMITS.tools.argumentsBytes) return [{ path: '', message: `The arguments are over ${LIMITS.tools.argumentsBytes / 1024} KiB.` }]
  if (call.argumentsParsed === undefined) return [{ path: '', message: 'The arguments are not valid JSON.' }]
  if (!isRecord(call.argumentsParsed)) return [{ path: '', message: 'The arguments must be a JSON object.' }]
  return validate(schema, call.argumentsParsed)
}

/**
 * Answer one call. `position.inStep` and `position.inTrace` are 0-based counts of calls before
 * this one in its step and in the whole trace. Order: over a cap, unknown tool, invalid
 * arguments, the first matching row, the default response.
 */
export function answerCall(task: Pick<ToolTask, 'tools'>, call: ModelCall, position: { inStep: number; inTrace: number }): MockAnswer {
  if (position.inStep >= LIMITS.tools.callsPerStep) return { output: OVER_STEP_CAP_TEXT, isError: true, source: 'over_cap', responseIndex: null, issues: [] }
  if (position.inTrace >= LIMITS.tools.callsPerTrace) return { output: OVER_TRACE_CAP_TEXT, isError: true, source: 'over_cap', responseIndex: null, issues: [] }
  const tool = task.tools.find((candidate) => candidate.name === call.name)
  if (!tool) return { output: unknownToolText(call.name), isError: true, source: 'unknown_tool', responseIndex: null, issues: [] }
  const issues = argumentIssues(tool.parameters as ToolSchema, call)
  if (issues.length > 0) return { output: tool.errorResponse.output, isError: true, source: 'invalid_arguments', responseIndex: null, issues }
  const args = call.argumentsParsed as Record<string, unknown>
  const index = tool.responses.findIndex((response) => argumentsMatch(response.when, args, response.textMatch))
  if (index >= 0) {
    const row = tool.responses[index]
    return { output: row.output, isError: row.isError, source: 'match', responseIndex: index, issues: [] }
  }
  return { output: tool.defaultResponse.output, isError: tool.defaultResponse.isError, source: 'default', responseIndex: null, issues: [] }
}

/** Answer one step's calls in order; `answeredBefore` is how many calls earlier steps had answered. */
export function answerCalls(task: Pick<ToolTask, 'tools'>, calls: readonly ModelCall[], answeredBefore: number): MockAnswer[] {
  return calls.map((call, index) => answerCall(task, call, { inStep: index, inTrace: answeredBefore + index }))
}

/** Parse arguments typed by the judge in "Try a call" the way a provider's string arguments are parsed. */
export function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** "matched row 2", "no row matched: default", "invalid: `order_id` is required" (the "Try a call" explanation). */
export function describeAnswer(answer: MockAnswer): string {
  switch (answer.source) {
    case 'match':
      return `Matched response ${(answer.responseIndex ?? 0) + 1}.`
    case 'default':
      return 'No response matched, so the default response is sent.'
    case 'invalid_arguments':
      return `The arguments don’t fit the schema, so the error response is sent: ${answer.issues.map((issue) => issue.message).join(' ')}`
    case 'unknown_tool':
      return 'There is no tool by that name.'
    case 'over_cap':
      return 'Over the call limit.'
  }
}
