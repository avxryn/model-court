/**
 * The tool trace (spec 06 §5.3–5.4, D-99): the testimony of a tool hearing. Pure and browser-safe.
 *
 * Both providers' steps become one shape. Model Court numbers the steps and calls; arguments are
 * parsed and written back as canonical JSON (sorted keys, 2-space indent), so OpenAI's string
 * arguments and Anthropic's objects look the same; provider call ids, item ids, reasoning and the
 * `is_error` channel never enter it. `jurorTrace` is the explicit allowlist jurors (and the
 * checks) see before unsealing; the full trace adds which response answered each call and the
 * per-step finish reason, shown only after unsealing.
 */

import { LIMITS } from '../limits'
import { utf8ByteLength } from '../text'
import type { SchemaIssue } from './json-schema'
import { capName, type CallSource, type MockAnswer, type ModelCall } from './mock'
import type { ToolTask } from './task'

export const TOOL_TRACE_VERSION = 'tool-trace-v1' as const

export const UNREADABLE_ARGUMENTS = '(unreadable)'

export type TraceEnd = 'answered' | 'step_cap' | 'truncated'

export type CallResult = { text: string; isError: boolean } | { notSent: true }

export interface TraceCall {
  callNo: number
  /** A defined tool name, or the model's own name capped at 64 characters. */
  tool: string
  knownTool: boolean
  /** Canonical JSON, or a 1 KiB preview of it for oversized arguments, or `(unreadable)`. */
  arguments: string
  result: CallResult
  /** null when the call was not answered (the step cap or the output limit ended the loop). */
  source: CallSource | null
  responseIndex: number | null
  issues: SchemaIssue[]
}

export interface TraceStep {
  stepNo: number
  text: string | null
  calls: TraceCall[]
  finishReason: string | null
  truncated: boolean
}

export interface ToolTrace {
  version: typeof TOOL_TRACE_VERSION
  steps: TraceStep[]
  finalAnswer: string | null
  ended: TraceEnd
}

export interface JurorToolCall {
  callNo: number
  tool: string
  knownTool: boolean
  arguments: string
  result: CallResult
}

export interface JurorToolStep {
  stepNo: number
  text: string | null
  calls: JurorToolCall[]
}

export interface JurorToolTrace {
  steps: JurorToolStep[]
  finalAnswer: string | null
  ended: TraceEnd
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keys sorted at every level. `Object.fromEntries` defines own properties, so `__proto__` stays a plain key. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]))
  return value
}

/** Sorted keys, 2-space indent. */
export function prettyJson(value: unknown): string {
  return JSON.stringify(sorted(value), null, 2)
}

/** The arguments as jurors read them: identical for both providers' formats. */
export function formatArguments(call: Pick<ModelCall, 'argumentsRaw' | 'argumentsParsed'>): string {
  if (call.argumentsParsed === undefined) return UNREADABLE_ARGUMENTS
  const text = prettyJson(call.argumentsParsed)
  if (utf8ByteLength(call.argumentsRaw) <= LIMITS.tools.argumentsBytes && utf8ByteLength(text) <= LIMITS.tools.argumentsBytes) return text
  // Oversized: a preview cut on a code point, never parseable, so the checks count it invalid.
  let preview = ''
  for (const char of text) {
    if (utf8ByteLength(preview + char) > LIMITS.tools.argumentsPreviewBytes) break
    preview += char
  }
  return `${preview}…`
}

/** A step's visible text as stored: null when it has none. */
export function stepText(text: string): string | null {
  return text.trim().length === 0 ? null : text
}

/**
 * One step's calls in the trace. `answers` is null when the calls were not answered (the step cap
 * or a truncated step ended the loop); then each result is `{notSent: true}`.
 */
export function traceCalls(task: Pick<ToolTask, 'tools'>, calls: readonly ModelCall[], answers: readonly MockAnswer[] | null, firstCallNo: number): TraceCall[] {
  return calls.map((call, index) => {
    const answer = answers?.[index]
    const known = task.tools.some((tool) => tool.name === call.name)
    return {
      callNo: firstCallNo + index,
      tool: capName(call.name),
      knownTool: known,
      arguments: formatArguments(call),
      result: answer ? { text: answer.output, isError: answer.isError } : { notSent: true as const },
      source: answer ? answer.source : null,
      responseIndex: answer ? answer.responseIndex : null,
      issues: answer ? answer.issues : [],
    }
  })
}

/** Calls in steps before this one, for numbering. */
export function callCount(steps: ReadonlyArray<{ calls: readonly unknown[] }>): number {
  return steps.reduce((sum, step) => sum + step.calls.length, 0)
}

/** Calls earlier steps actually answered (the trace cap counts these). */
export function answeredCount(steps: ReadonlyArray<{ calls: ReadonlyArray<{ result: CallResult }> }>): number {
  return steps.reduce((sum, step) => sum + step.calls.filter((call) => !('notSent' in call.result)).length, 0)
}

/**
 * The finished trace. On `answered` and `truncated` the last step's text is the final answer
 * (and leaves that step, so it is not shown twice); on `step_cap` there is none.
 */
export function finishTrace(steps: readonly TraceStep[], ended: TraceEnd): ToolTrace {
  const copy = steps.map((step) => ({ ...step, calls: [...step.calls] }))
  let finalAnswer: string | null = null
  const last = copy.at(-1)
  if (last && ended !== 'step_cap') {
    finalAnswer = last.text
    last.text = null
  }
  return { version: TOOL_TRACE_VERSION, steps: copy, finalAnswer, ended }
}

export function traceBytes(trace: ToolTrace): number {
  return utf8ByteLength(JSON.stringify(trace))
}

function jurorResult(result: CallResult): CallResult {
  return 'notSent' in result ? { notSent: true } : { text: String(result.text), isError: result.isError === true }
}

/**
 * The juror projection (spec 06 §5.3): an explicit allowlist. Drops the response source, row,
 * issues, finish reasons and truncation flags; copies only the named keys, so nothing a stored
 * trace may carry can follow.
 */
export function jurorTrace(trace: JurorToolTrace): JurorToolTrace {
  return {
    steps: trace.steps.map((step) => ({
      stepNo: step.stepNo,
      text: typeof step.text === 'string' ? step.text : null,
      calls: step.calls.map((call) => ({ callNo: call.callNo, tool: String(call.tool), knownTool: call.knownTool === true, arguments: String(call.arguments), result: jurorResult(call.result) })),
    })),
    finalAnswer: typeof trace.finalAnswer === 'string' ? trace.finalAnswer : null,
    ended: trace.ended === 'step_cap' || trace.ended === 'truncated' ? trace.ended : 'answered',
  }
}

/** All calls of a trace in order. */
export function callsOf<C>(trace: { steps: ReadonlyArray<{ calls: readonly C[] }> }): C[] {
  return trace.steps.flatMap((step) => step.calls)
}
