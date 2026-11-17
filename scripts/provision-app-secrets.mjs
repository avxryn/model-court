#!/usr/bin/env node
/**
 * Provision Model Court's two app secrets in the DeepSpace secrets store
 * without ever displaying them (spec §9.4, §9.6, §14.1):
 *
 *   CREDENTIAL_ENCRYPTION_KEY_V1   base64(32 random bytes), AES-256-GCM root
 *   CREDENTIAL_REQUEST_HMAC_KEY    base64(32 random bytes), request-digest key
 *
 * Values are generated in memory and written only to the stdin of
 * `npx deepspace secrets upload -`, so they never appear on a command line,
 * in shell history, in this script's output, or in any file.
 *
 * Safety: refuses to run if either name already exists, because silently
 * replacing a root that protects saved keys would make them undecryptable.
 * Rotation is a separate, deliberate procedure (docs/runbook.md).
 *
 * Usage (from the app directory, signed in to the DeepSpace CLI as the owner):
 *   node scripts/provision-app-secrets.mjs            # dry run: shows what would be set
 *   node scripts/provision-app-secrets.mjs --apply    # uploads; then `npx deepspace deploy`
 *
 * Root rotation (docs/runbook.md "Root-key rotation", step 2) adds only the
 * next root, with the same refusal to overwrite:
 *   node scripts/provision-app-secrets.mjs --rotation-root v2 [--apply]
 */

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const rotationIndex = process.argv.indexOf('--rotation-root')
const rotationRoot = rotationIndex === -1 ? null : process.argv[rotationIndex + 1]
// Only roots the Worker can parse (src/server/config.ts) may be provisioned.
if (rotationIndex !== -1 && rotationRoot !== 'v2') {
  console.error('--rotation-root accepts only v2 (the roots src/server/config.ts reads are v1 and v2).')
  process.exit(1)
}
const NAMES = rotationRoot ? [`CREDENTIAL_ENCRYPTION_KEY_${rotationRoot.toUpperCase()}`] : ['CREDENTIAL_ENCRYPTION_KEY_V1', 'CREDENTIAL_REQUEST_HMAC_KEY']
const apply = process.argv.includes('--apply')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

const list = spawnSync(npx, ['deepspace', 'secrets', 'list', '--only-names', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' })
if (list.status !== 0) {
  console.error('Could not list existing secret names. Sign in with `npx deepspace auth login` and run this from the app directory.')
  console.error(list.stderr?.trim() || list.stdout?.trim())
  process.exit(1)
}
const existing = list.stdout
const clash = NAMES.filter((name) => existing.includes(name))
if (clash.length > 0) {
  console.error(`Refusing to overwrite existing secret(s): ${clash.join(', ')}. See docs/runbook.md → "Root-key rotation".`)
  process.exit(1)
}

if (!apply) {
  console.log(`Dry run. Would generate and upload: ${NAMES.join(', ')} (values never displayed).`)
  console.log('Re-run with --apply to upload, then deploy so the Worker receives the bindings.')
  process.exit(0)
}

const dotenv = NAMES.map((name) => `${name}=${randomBytes(32).toString('base64')}`).join('\n') + '\n'
const upload = spawn(npx, ['deepspace', 'secrets', 'upload', '-'], { stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' })
upload.stdin.end(dotenv)
upload.on('exit', (code) => {
  if (code === 0) console.log(`Uploaded ${NAMES.join(', ')}. Run \`npx deepspace deploy\` to apply them.`)
  process.exit(code ?? 1)
})
