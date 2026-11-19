/**
 * Manual, PAID provider smoke test (spec V2/T04). Sends exactly one tiny
 * request per selected provider through the same adapters the Worker uses,
 * then prints the normalized outcome (never the key) so the route can be
 * recorded in docs/provider-contracts.md and marked verified in
 * src/domain/registry.ts.
 *
 * Keys are read from a hidden prompt in YOUR terminal. Do not paste keys into
 * chats, files, or command lines.
 *
 *   npm run smoke:providers            # prompts for which routes to test
 *
 * Each route is tested through the adapter version it records (D-48), so a
 * success is evidence for that route's request body, not just its provider.
 *
 * Modes `json` and `pdf` (spec 04 §6.5, D-86) send one extraction request through the route's
 * structured adapter version: a fixed six-field schema on a short text (`json`), or on
 * tests/fixtures/extraction/invoice-1p.pdf (`pdf`). A success whose output parses and fits the
 * schema is the evidence for `structuredVerifiedAt` / `pdfVerifiedAt`; record it with its input
 * tokens in docs/provider-contracts.md ("Structured and PDF checks").
 *
 * Mode `tools` (spec 06 §6.4, D-100) runs one short tool loop through the route's tool-loop
 * version: the two tools of EXAMPLE_TOOL_TASK, mock answers from the same pure answerer the Worker
 * uses, and a 3-step cap, so it sends UP TO 3 paid requests to the route. A trace with at least one
 * call, its result sent back (step 2 accepted the replay) and a final answer is the evidence for
 * `toolsVerifiedAt`; record the printed steps (finish reasons, tokens) in docs/provider-contracts.md
 * ("Tool checks").
 *
 * This verifies direct API access from your machine. It does not replace the
 * deployed check (V12): a real run in the deployed app with keys saved in
 * Settings.
 */

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { buildConversation, buildExtractV1, CHAT_TEMPLATE_VERSION, MESSAGE_TEMPLATE_VERSION, type KitRequest } from '../src/domain/messages'
import { EXAMPLE_CASES, EXAMPLE_POLICY, DEFAULT_SYSTEM_PROMPT } from '../src/domain/example'
import { parseOutput } from '../src/domain/extraction/render'
import type { ExtractionSchema } from '../src/domain/extraction/schema'
import { validateAgainstSchema } from '../src/domain/extraction/validate'
import { LIMITS } from '../src/domain/limits'
import { adapterVersionFor, MODEL_ROUTES } from '../src/domain/registry'
import { adapterFor, toolAdapterFor, type StepReplay } from '../src/server/providers'
import { answerCalls } from '../src/domain/tools/mock'
import { EXAMPLE_TOOL_TASK, promptToolsOf } from '../src/domain/tools/task'
import { buildToolsV1 } from '../src/domain/messages'

/** The fixed six-field schema of the `json` and `pdf` modes (spec 04 §6.5). */
const SMOKE_SCHEMA: ExtractionSchema = {
  type: 'object',
  properties: {
    supplier: { type: 'string' },
    purchaseOrder: { type: 'string' },
    lineCount: { type: 'integer' },
    total: { type: 'number' },
    issueDate: { type: 'string', format: 'date' },
    currency: { type: 'string', enum: ['USD', 'EUR', 'GBP'] },
    lines: { type: 'array', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: 'number' } }, required: ['description', 'amount'] } },
  },
  required: ['supplier', 'lineCount', 'total', 'issueDate', 'currency', 'lines'],
}
const SMOKE_TEXT = 'Northwind Office Supply. Invoice NW-2291, issued 2026-10-02. Standing desk 380.00; cable tray 32.50. Total due USD 412.50.'

function ask(question: string, hidden = false): Promise<string> {
  let muted = false
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding as BufferEncoding)
      callback()
    },
  })
  const rl = createInterface({ input: process.stdin, output, terminal: true })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer.trim())
    })
    muted = hidden
  })
}

async function main() {
  console.log('Model Court provider smoke test — each selected route receives ONE request, billed to your account.')
  console.log('Routes:')
  for (const route of MODEL_ROUTES) console.log(`  ${route.key.padEnd(36)} ${route.verifiedAt ? `verified ${route.verifiedAt}` : 'not yet verified'}${route.reasoning === 'low' ? ` (reasons; up to ${LIMITS.maxOutputTokens + LIMITS.reasoningHeadroomTokens} output tokens)` : ''}`)
  const choice = await ask('Test which routes? (comma-separated keys, blank = none): ')
  const routes = choice
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key !== '')
    .map((key) => ({ key, route: MODEL_ROUTES.find((r) => r.key === key) }))
  // "multi" sends a short conversation (D-39): its success is the evidence for a route's multiTurnVerifiedAt.
  const answer = await ask('Mode? [single/multi/json/pdf/tools] (blank = single): ')
  if (answer === 'tools') {
    for (const { key, route } of routes) {
      if (!route) {
        console.log(`Skipping unknown route ${key}`)
        continue
      }
      await toolLoop(route)
    }
    return
  }
  const mode = answer === 'multi' || answer === 'json' || answer === 'pdf' ? answer : 'single'
  const extraction = mode === 'json' || mode === 'pdf'
  const conversation: KitRequest | null = extraction
    ? buildExtractV1({
        systemPrompt: 'You extract fields from invoices.',
        prompt: { reference: '', input: 'Extract the fields from the document.' },
        settings: { schema: SMOKE_SCHEMA, compare: {} },
        document: mode === 'pdf' ? { kind: 'pdf', base64: readFileSync('tests/fixtures/extraction/invoice-1p.pdf').toString('base64') } : { kind: 'text', text: SMOKE_TEXT },
      })
    : mode === 'multi'
      ? buildConversation(CHAT_TEMPLATE_VERSION, DEFAULT_SYSTEM_PROMPT, {
          reference: EXAMPLE_POLICY,
          input: 'And if I lost the receipt?',
          messages: [
            { role: 'user', content: EXAMPLE_CASES[0].input },
            { role: 'assistant', content: 'Yes. Regular items can be returned within 30 days with a receipt, and you are at day 12.' },
          ],
        })
      : buildConversation(MESSAGE_TEMPLATE_VERSION, DEFAULT_SYSTEM_PROMPT, { reference: EXAMPLE_POLICY, input: EXAMPLE_CASES[0].input })

  for (const { key, route } of routes) {
    if (!route) {
      console.log(`Skipping unknown route ${key}`)
      continue
    }
    if (!conversation) return
    const features = extraction ? { structuredOutput: true, pdfInput: mode === 'pdf' } : {}
    const adapterVersion = adapterVersionFor(route.adapterVersion, features)
    const adapter = adapterVersion ? adapterFor(adapterVersion, route.provider, conversation.messages.length, features) : null
    if (!adapter) {
      console.log(`Skipping ${route.key}: adapter ${route.adapterVersion} cannot send this request`)
      continue
    }
    const confirm = await ask(`Send 1 paid request to ${route.provider} model ${route.modelId}? [y/N] `)
    if (confirm.toLowerCase() !== 'y') continue
    // Asked per route, so a key is held only for its one request.
    let apiKey = await ask(`${route.provider} API key (input hidden): `, true)
    const timeout = AbortSignal.timeout(LIMITS.providerTimeoutMs)
    const options = conversation.requestOptions
    const outcome = await adapter(
      fetch,
      {
        modelId: route.modelId,
        system: conversation.system,
        messages: conversation.messages,
        maxOutputTokens: options?.maxOutputTokens ?? LIMITS.maxOutputTokens,
        apiKey,
        signal: timeout,
        ...(options ? { responseFormat: options.responseFormat } : {}),
        ...(options?.document ? { document: options.document } : {}),
      },
      timeout,
    )
    apiKey = ''
    const date = new Date().toISOString().slice(0, 10)
    const parsed = extraction && outcome.kind === 'success' ? parseOutput(outcome.text) : null
    const schemaIssues = parsed?.status === 'parsed' ? validateAgainstSchema(SMOKE_SCHEMA, parsed.value) : null
    const structured = parsed ? { parsed: parsed.status === 'parsed', fitsSchema: schemaIssues !== null && schemaIssues.length === 0, issues: schemaIssues ?? [] } : undefined
    console.log(JSON.stringify({ date, routeKey: route.key, provider: route.provider, mode, messageCount: conversation.messages.length, modelId: route.modelId, adapterVersion, structured, outcome: { ...outcome, text: outcome.kind === 'success' ? outcome.text.slice(0, 400) : undefined } }, null, 2))
  }
}

/** Mode `tools`: up to 3 paid steps on one route, answered by the Worker's own mock answerer. */
async function toolLoop(route: (typeof MODEL_ROUTES)[number]) {
  const adapterVersion = adapterVersionFor(route.adapterVersion, { toolUse: true })
  const adapter = adapterVersion ? toolAdapterFor(adapterVersion, route.provider) : null
  if (!adapter) {
    console.log(`Skipping ${route.key}: adapter ${route.adapterVersion} has no tool-loop version`)
    return
  }
  const confirm = await ask(`Send UP TO 3 paid requests to ${route.provider} model ${route.modelId}? [y/N] `)
  if (confirm.toLowerCase() !== 'y') return
  let apiKey = await ask(`${route.provider} API key (input hidden): `, true)
  const prompt = buildToolsV1({ systemPrompt: 'You are a support agent. Use the tools to check facts before you answer.', prompt: { reference: '', input: 'Where is my order A-1042? If it is late, refund the shipping.' }, settings: {} })
  const history: Array<{ replay: StepReplay; results: Array<{ output: string; isError: boolean }> }> = []
  const steps: unknown[] = []
  let answered = 0
  for (let stepNo = 1; stepNo <= 3; stepNo++) {
    const timeout = AbortSignal.timeout(LIMITS.providerTimeoutMs)
    const outcome = await adapter(fetch, { modelId: route.modelId, system: prompt.system, user: prompt.messages[0].content, tools: promptToolsOf(EXAMPLE_TOOL_TASK), history, maxOutputTokens: LIMITS.maxOutputTokens, apiKey, signal: timeout }, timeout)
    if (outcome.kind !== 'success') {
      steps.push({ stepNo, outcome })
      break
    }
    const results = answerCalls(EXAMPLE_TOOL_TASK, outcome.calls, answered)
    answered += results.length
    steps.push({ stepNo, stop: outcome.stop, finishReason: outcome.finishReason, truncated: outcome.truncated, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, reasoningTokens: outcome.reasoningTokens, observedModel: outcome.observedModel, text: outcome.text.slice(0, 300), calls: outcome.calls.map((call, index) => ({ name: call.name, arguments: call.argumentsRaw.slice(0, 200), answeredFrom: results[index].source })) })
    if (outcome.stop === 'answer' || outcome.truncated) break
    history.push({ replay: outcome.replay, results: results.map((result) => ({ output: result.output, isError: result.isError })) })
  }
  apiKey = ''
  const date = new Date().toISOString().slice(0, 10)
  console.log(JSON.stringify({ date, routeKey: route.key, provider: route.provider, mode: 'tools', modelId: route.modelId, adapterVersion, steps }, null, 2))
}

void main()
