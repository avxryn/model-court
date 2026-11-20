/**
 * Operator tool for the sealed store backups (V9, D-117). Runs on your own machine; it makes no
 * network call and never prints backup content or the private key.
 *
 *   npm run backup -- keygen [--out <file>]
 *       Makes a new P-256 key pair. The private key is written to <file> (default
 *       ~/.model-court/backup-private-key.txt, refused if it exists); move it into your password
 *       manager. Prints the public key for BACKUP_PUBLIC_KEY in wrangler.toml (it is not a secret).
 *
 *   npm run backup -- open <backup.json> [--key <file>]
 *       Opens a downloaded backup (npx deepspace app files get --private <key>) and prints a
 *       summary: app, time, migrations, rows per table, redactions. Checks the content digest.
 *
 *   npm run backup -- trial-restore <backup.json> [--key <file>]
 *       Opens it and restores it into a fresh, in-memory local store (never the live app), then
 *       compares row counts table by table. The restore drill in docs/runbook.md.
 *
 * Without --key the private key is read from a hidden prompt.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { generateOperatorKeyPair, openSnapshotWith, type OperatorSealedBackup } from '../src/server/services/backup-seal'
import type { StoreSnapshot } from '../src/server/services/backup'

const args = process.argv.slice(2)
const command = args[0]
const flag = (name: string) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function hiddenPrompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) return (await new Promise<string>((done) => {
    let data = ''
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => done(data))
  })).trim()
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  const output = rl as unknown as { _writeToOutput: (text: string) => void; output: NodeJS.WriteStream }
  let asked = false
  output._writeToOutput = (text: string) => {
    if (!asked) {
      output.output.write(text)
      asked = true
    }
  }
  const answer = await new Promise<string>((done) => rl.question(question, done))
  rl.close()
  process.stdout.write('\n')
  return answer.trim()
}

async function privateKey(): Promise<string> {
  const path = flag('--key')
  if (path) return readFileSync(resolve(path), 'utf8').trim()
  return hiddenPrompt('Backup private key (input hidden): ')
}

function readBackup(path: string | undefined): OperatorSealedBackup {
  if (!path) fail('Name the backup file: npm run backup -- open <backup.json>')
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as OperatorSealedBackup
  } catch {
    fail(`Could not read ${path} as JSON.`)
  }
}

function summary(snapshot: StoreSnapshot) {
  const rows = Object.fromEntries(Object.entries(snapshot.tables).map(([table, list]) => [table, list.length]))
  return {
    appId: snapshot.appId,
    exportedAt: new Date(snapshot.exportedAt).toISOString(),
    migrations: snapshot.migrations.length,
    lastMigration: snapshot.migrations.at(-1) ?? null,
    totalRows: Object.values(rows).reduce((a, b) => a + b, 0),
    rows,
    redactions: snapshot.redactions,
  }
}

async function main() {
  if (command === 'keygen') {
    const out = resolve(flag('--out') ?? join(homedir(), '.model-court', 'backup-private-key.txt'))
    if (existsSync(out)) fail(`${out} already exists. Refusing to replace a backup key; choose another --out.`)
    const pair = await generateOperatorKeyPair()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, pair.privatePkcs8 + '\n', { mode: 0o600, flag: 'wx' })
    console.log(`Private key written to ${out} (not shown). Move it into your password manager; without it no backup can be opened.`)
    console.log(`Key id: ${pair.recipient}`)
    console.log('Public key, for BACKUP_PUBLIC_KEY in wrangler.toml [vars] (not a secret):')
    console.log(pair.publicSpki)
    return
  }
  if (command === 'open' || command === 'trial-restore') {
    const sealed = readBackup(args[1])
    const snapshot = await openSnapshotWith(await privateKey(), sealed).catch((error: Error) => fail(error.message))
    const opened = summary(snapshot)
    if (command === 'open') {
      console.log(JSON.stringify({ ok: true, recipient: sealed.recipient, ...opened }, null, 2))
      return
    }
    // A fresh in-memory local D1 at today's schema; the live app is never touched.
    const { getPlatformProxy } = await import('wrangler')
    const { ensureMigrated } = await import('../src/server/db/migrations')
    const { parseConfig } = await import('../src/server/config')
    const { restoreSnapshot } = await import('../src/server/services/backup')
    const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'tests/integration/wrangler.test.toml', persist: false })
    try {
      const db = proxy.env.DB
      const config = parseConfig({ DEEPSPACE_APP_ID: snapshot.appId })
      const deps = { db, ensureSchema: () => ensureMigrated(db), config, now: () => Date.now(), newId: () => crypto.randomUUID(), log: () => {} } as unknown as Parameters<typeof restoreSnapshot>[0]
      const report = await restoreSnapshot(deps, snapshot)
      const mismatches: Array<{ table: string; backup: number; restored: number }> = []
      for (const [table, expected] of Object.entries(opened.rows)) {
        const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()
        const restored = Number(row?.n ?? 0)
        // The restore records itself: one `store.restore` audit event more than the file holds.
        const want = table === 'audit_events' ? expected + 1 : expected
        if (restored !== want) mismatches.push({ table, backup: expected, restored })
      }
      console.log(JSON.stringify({ ok: mismatches.length === 0, ...opened, report, mismatches }, null, 2))
      if (mismatches.length > 0) process.exitCode = 1
    } finally {
      await proxy.dispose()
    }
    return
  }
  fail('Usage: npm run backup -- keygen [--out <file>] | open <backup.json> [--key <file>] | trial-restore <backup.json> [--key <file>]')
}

void main()
