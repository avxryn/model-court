/**
 * A question's mock-tool task (spec 06 §4.1, D-99). Pure and browser-safe; shared by the editor,
 * draft save, admission, the mock answerer and the checks.
 *
 * The task lives in the question's kit fields (`kitFields: {kind: 'tools', …}`, item 3's slot),
 * so the snapshot, its hash and item 2's question hashes commit to it with no new field. Field
 * names are final. Cross-field rules are `toolTaskIssues` (run by the kit's `draftIssues`), so
 * every refusal carries a path into the question.
 */

import { z } from 'zod'
import { canonicalJson } from '../canonical'
import { LIMITS } from '../limits'
import { codePointLength, hasDisallowedControlChars, utf8ByteLength } from '../text'
import { schemaIssues, validatePartial, type ToolSchema } from './json-schema'

const T = LIMITS.tools

export const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u

export const toolNameSchema = z.string().regex(TOOL_NAME, 'A tool name starts with a letter and uses letters, digits, _ or -, at most 64 characters')

function text(bounds: { min: number; max: number }, label: string) {
  return z
    .string()
    .refine((value) => {
      const length = codePointLength(value)
      return length >= bounds.min && length <= bounds.max && value.trim().length > 0
    }, `${label} must be ${bounds.min}–${bounds.max.toLocaleString('en-US')} characters`)
    .refine((value) => !hasDisallowedControlChars(value), `${label} contains control characters`)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A plain JSON object of at most `maxBytes` as canonical JSON. */
function jsonObject(maxBytes: number, label: string) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    if (!isPlainObject(value)) return
    try {
      if (utf8ByteLength(canonicalJson(value)) > maxBytes) ctx.addIssue({ code: 'custom', message: `${label} is at most ${maxBytes / 1024} KiB` })
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label} must be plain JSON` })
    }
  })
}

export const cannedResponseSchema = z.strictObject({
  /** Partial arguments; `{}` matches any valid call. */
  when: jsonObject(T.whenBytes, 'A response condition'),
  /** `loose`: text values compare after Unicode normalization, trimming, whitespace and case folding. */
  textMatch: z.enum(['loose', 'exact']),
  output: text(T.output, 'Response'),
  isError: z.boolean(),
})
export type CannedResponse = z.infer<typeof cannedResponseSchema>

export const toolDefinitionSchema = z.strictObject({
  name: toolNameSchema,
  description: text(T.description, 'Description'),
  /** The arguments' JSON Schema, subset of §4.2; the top level is `"type": "object"`. */
  parameters: jsonObject(T.parametersBytes, 'An arguments schema'),
  responses: z.array(cannedResponseSchema).max(T.responsesPerTool, `At most ${T.responsesPerTool} responses per tool`),
  /** Sent when no row matched. */
  defaultResponse: z.strictObject({ output: text(T.output, 'Default response'), isError: z.boolean() }),
  /** Sent when the arguments do not fit the schema; always an error result. */
  errorResponse: z.strictObject({ output: text(T.output, 'Error response') }),
})
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>

export const toolExpectationsSchema = z.strictObject({
  requiredCalls: z
    .array(z.strictObject({ tool: toolNameSchema, withArguments: jsonObject(T.whenBytes, 'Required arguments').optional() }))
    .max(T.requiredCalls, `At most ${T.requiredCalls} required calls`),
  requireOrder: z.boolean(),
  forbiddenTools: z.array(toolNameSchema).max(T.forbiddenTools, `At most ${T.forbiddenTools} forbidden tools`),
  targetSteps: z.number().int().min(1).max(T.maxSteps).optional(),
  finalAnswer: z.strictObject({ mode: z.enum(['exact', 'contains']), value: text(T.expectedAnswer, 'Expected answer') }).optional(),
})
export type ToolExpectations = z.infer<typeof toolExpectationsSchema>

/**
 * The question's kit fields for `tools-v1`. `tools`, their descriptions and argument schemas are
 * sent to every party; canned responses reach a party only as the result of a call it made;
 * `expect` is never sent to any provider.
 */
export const toolsFieldsSchema = z.strictObject({
  kind: z.literal('tools'),
  tools: z.array(toolDefinitionSchema).min(1, 'Add at least one tool').max(T.perQuestion, `At most ${T.perQuestion} tools per question`),
  /** Provider calls each party may make for this question. */
  maxSteps: z.number().int().min(1).max(T.maxSteps),
  expect: toolExpectationsSchema,
})
export type ToolsFields = z.infer<typeof toolsFieldsSchema>
export type ToolTask = Omit<ToolsFields, 'kind'>

export interface TaskIssue {
  /** Relative to the kit fields (`['tools', 1, 'parameters', 'properties']`). */
  path: (string | number)[]
  message: string
}

function schemaPath(path: string): (string | number)[] {
  return path === '' ? [] : path.split('.').map((part) => (/^\d+$/u.test(part) ? Number(part) : part))
}

/**
 * Cross-field rules (spec 06 §4.1): unique names; required and forbidden tools exist and do not
 * overlap; every schema is in the subset; every `when` and `withArguments` names real arguments
 * with fitting values; `targetSteps ≤ maxSteps`; the whole task ≤ 12 KiB as canonical JSON.
 */
export function toolTaskIssues(task: ToolTask): TaskIssue[] {
  const issues: TaskIssue[] = []
  const names = new Map<string, number>()
  task.tools.forEach((tool, index) => {
    if (names.has(tool.name)) issues.push({ path: ['tools', index, 'name'], message: `Two tools are named “${tool.name}”. Tool names must be unique.` })
    else names.set(tool.name, index)
    const schemaProblems = schemaIssues(tool.parameters)
    for (const issue of schemaProblems.slice(0, LIMITS.tools.issues)) issues.push({ path: ['tools', index, 'parameters', ...schemaPath(issue.path)], message: issue.message })
    if (schemaProblems.length === 0) {
      tool.responses.forEach((response, row) => {
        for (const issue of validatePartial(tool.parameters as ToolSchema, response.when)) issues.push({ path: ['tools', index, 'responses', row, 'when', ...schemaPath(issue.path)], message: issue.message })
      })
    }
  })
  const required = new Set<string>()
  task.expect.requiredCalls.forEach((call, index) => {
    const toolIndex = names.get(call.tool)
    if (toolIndex === undefined) {
      issues.push({ path: ['expect', 'requiredCalls', index, 'tool'], message: `“${call.tool}” isn’t one of this question’s tools.` })
      return
    }
    required.add(call.tool)
    const tool = task.tools[toolIndex]
    if (call.withArguments && schemaIssues(tool.parameters).length === 0) {
      for (const issue of validatePartial(tool.parameters as ToolSchema, call.withArguments)) issues.push({ path: ['expect', 'requiredCalls', index, 'withArguments', ...schemaPath(issue.path)], message: issue.message })
    }
  })
  const forbidden = new Set<string>()
  task.expect.forbiddenTools.forEach((name, index) => {
    if (!names.has(name)) issues.push({ path: ['expect', 'forbiddenTools', index], message: `“${name}” isn’t one of this question’s tools.` })
    else if (required.has(name)) issues.push({ path: ['expect', 'forbiddenTools', index], message: `“${name}” is both required and forbidden.` })
    if (forbidden.has(name)) issues.push({ path: ['expect', 'forbiddenTools', index], message: `“${name}” is listed twice.` })
    forbidden.add(name)
  })
  if (task.expect.targetSteps !== undefined && task.expect.targetSteps > task.maxSteps) {
    issues.push({ path: ['expect', 'targetSteps'], message: `The target (${task.expect.targetSteps} calls) is more than the step cap (${task.maxSteps}).` })
  }
  try {
    if (utf8ByteLength(canonicalJson(task)) > LIMITS.tools.taskBytes) issues.push({ path: [], message: `A question’s tools, responses and expectations are at most ${LIMITS.tools.taskBytes / 1024} KiB together.` })
  } catch {
    issues.push({ path: [], message: 'The tool task must be plain JSON.' })
  }
  return issues
}

/** The question's tool task, or undefined when its kit fields are another kit's. */
export function toolTaskOf(kitFields: unknown): ToolsFields | undefined {
  const fields = kitFields as { kind?: string } | undefined
  return fields?.kind === 'tools' ? (fields as ToolsFields) : undefined
}

/**
 * What a provider may receive of the tools: name, description and arguments schema, picked field
 * by field so canned responses and expectations can never follow.
 */
export interface PromptTool {
  name: string
  description: string
  parameters: ToolSchema
}

export function promptToolsOf(task: Pick<ToolTask, 'tools'>): PromptTool[] {
  return task.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters as ToolSchema }))
}

/** A starter task for "Insert example" and the new-case template (fictitious data). */
export const EXAMPLE_TOOL_TASK: ToolTask = {
  tools: [
    {
      name: 'lookup_order',
      description: 'Look up an order by its ID. Returns its status and the delivery estimate.',
      parameters: { type: 'object', properties: { order_id: { type: 'string', description: 'The order ID, like A-1042' } }, required: ['order_id'], additionalProperties: false },
      responses: [{ when: { order_id: 'A-1042' }, textMatch: 'loose', output: '{"order_id": "A-1042", "status": "delayed", "shipping_paid": 6.5, "estimated_delivery": "in 3 to 5 business days"}', isError: false }],
      defaultResponse: { output: '{"error": "No order with that ID."}', isError: true },
      errorResponse: { output: '{"error": "order_id is required and must be text."}' },
    },
    {
      name: 'refund_shipping',
      description: 'Refund the shipping cost of a late order. Only for orders whose status is "delayed".',
      parameters: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'], additionalProperties: false },
      responses: [{ when: { order_id: 'A-1042' }, textMatch: 'loose', output: '{"refunded": 6.5, "currency": "USD"}', isError: false }],
      defaultResponse: { output: '{"error": "Only delayed orders can get a shipping refund."}', isError: true },
      errorResponse: { output: '{"error": "order_id is required."}' },
    },
  ],
  maxSteps: LIMITS.tools.defaultMaxSteps,
  expect: {
    requiredCalls: [{ tool: 'lookup_order', withArguments: { order_id: 'A-1042' } }, { tool: 'refund_shipping', withArguments: { order_id: 'A-1042' } }],
    requireOrder: true,
    forbiddenTools: [],
    targetSteps: 3,
    finalAnswer: { mode: 'contains', value: '3 to 5 business days' },
  },
}
