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
import { adapterFor } from '../src/server/providers'

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
  const answer = await ask('Mode? [single/multi/json/pdf] (blank = single): ')
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

void main()
