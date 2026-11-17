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
 *   npm run smoke:providers            # prompts for which providers to test
 *
 * This verifies direct API access from your machine. It does not replace the
 * deployed check (V12): a real run in the deployed app with keys saved in
 * Settings.
 */

import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { buildMessages } from '../src/domain/messages'
import { EXAMPLE_CASES, EXAMPLE_POLICY, DEFAULT_SYSTEM_PROMPT } from '../src/domain/example'
import { LIMITS } from '../src/domain/limits'
import { MODEL_ROUTES, type ProviderId } from '../src/domain/registry'
import { ADAPTERS } from '../src/server/providers'

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
  console.log('Model Court provider smoke test — each selected provider receives ONE request (≤512 output tokens), billed to your account.')
  const choice = (await ask('Test which providers? [openai,anthropic] (comma-separated, blank = both): ')) || 'openai,anthropic'
  const providers = choice.split(',').map((p) => p.trim()) as ProviderId[]
  const messages = buildMessages(DEFAULT_SYSTEM_PROMPT, { reference: EXAMPLE_POLICY, input: EXAMPLE_CASES[0].input })

  for (const provider of providers) {
    const route = MODEL_ROUTES.find((r) => r.provider === provider)
    if (!route) {
      console.log(`Skipping unknown provider ${provider}`)
      continue
    }
    const confirm = await ask(`Send 1 paid request to ${provider} model ${route.modelId}? [y/N] `)
    if (confirm.toLowerCase() !== 'y') continue
    let apiKey = await ask(`${provider} API key (input hidden): `, true)
    const timeout = AbortSignal.timeout(LIMITS.providerTimeoutMs)
    const outcome = await ADAPTERS[provider](fetch, { modelId: route.modelId, system: messages.system, user: messages.user, maxOutputTokens: LIMITS.maxOutputTokens, apiKey, signal: timeout }, timeout)
    apiKey = ''
    const date = new Date().toISOString().slice(0, 10)
    console.log(JSON.stringify({ date, provider, modelId: route.modelId, adapterVersion: route.adapterVersion, outcome: { ...outcome, text: outcome.kind === 'success' ? outcome.text.slice(0, 400) : undefined } }, null, 2))
  }
}

void main()
