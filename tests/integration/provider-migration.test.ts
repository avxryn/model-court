/**
 * Spec 07 §4.2, §11.2 (D-106): migration 0015_provider_google as a real 0014 → 0015 transition on a
 * seeded store. Runs on both stores (local D1 and the ModelCourtStore Durable Object SQLite). Eleven
 * tables are rebuilt; every row, column, key, index and trigger must come through unchanged except
 * the provider CHECK.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS } from '../../src/server/db/migrations'
import { BACKUP_TABLES, exportSnapshot, restoreSnapshot } from '../../src/server/services/backup'
import { createHarness, openDatabaseBefore } from './harness'

type Db = D1Database
type Row = Record<string, unknown>

/** Every table 0015 rebuilds, with an ORDER BY that makes their rows comparable. */
const REBUILT = {
  generations: 'id',
  generation_attempts: 'id',
  outbox: 'id',
  attempt_reservations: 'generation_id, attempt_no',
  testimony_checks: 'id',
  generation_steps: 'id',
  step_reservations: 'generation_id, attempt_no, step_no',
  step_outbox: 'id',
  provider_credentials: 'id',
  run_credentials: 'run_id, provider',
  grader_credentials: 'grader_run_id, provider',
} as const
const TABLES = Object.keys(REBUILT) as Array<keyof typeof REBUILT>

const rows = async (db: Db, sql: string, ...params: Array<string | number>) => (await db.prepare(sql).bind(...params).all<Row>()).results

/** A hearing in every paid-call state, a tool-loop attempt with steps, checks, credentials and a grader run. */
async function seedLegacy(db: Db) {
  const t = 1_763_000_000_000
  const statements: D1PreparedStatement[] = []
  const add = (sql: string, ...params: Array<string | number | null>) => statements.push(db.prepare(sql).bind(...params))
  add(`INSERT INTO evaluations (id, owner_user_id, title, task_description, draft_json, revision, created_at, updated_at) VALUES ('ev1', 'u1', 'Seeded', '', '{}', 1, ?, ?)`, t, t)
  for (const run of ['run1', 'run2']) {
    add(`INSERT INTO runs (id, evaluation_id, owner_user_id, status, snapshot_json, snapshot_hash, revision, created_at, updated_at) VALUES (?, 'ev1', 'u1', ?, '{}', 'hash', 1, ?, ?)`, run, run === 'run1' ? 'generating' : 'canceled', t, t)
  }
  const states = ['pending', 'running', 'succeeded', 'failed', 'uncertain', 'canceled'] as const
  states.forEach((status, i) => {
    const id = `g${i}`
    add(
      `INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, last_error_code, created_at, updated_at, sample_no) VALUES (?, 'run1', ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
      id,
      `case${i % 3}`,
      i < 3 ? 'cfgA' : 'cfgB',
      i < 3 ? 'openai' : 'anthropic',
      status,
      status === 'succeeded' ? `a${i}` : null,
      status === 'failed' ? 'PROVIDER_RATE_LIMITED' : null,
      t + i,
      t + i,
      1 + (i % 2),
    )
    if (status !== 'pending') {
      add(
        `INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, queue_wait_ms, output_text, input_tokens, output_tokens, duration_ms, error_code, truncated, cached_input_tokens, reasoning_tokens, observed_model, provider_request_id)
         VALUES (?, ?, 1, ?, ?, ?, ?, 5, ?, ?, ?, ?, ?, ?, ?, ?, 'model-x', ?)`,
        `a${i}`,
        id,
        `fence${i}`,
        status,
        t,
        t + 120_000,
        status === 'succeeded' ? 'An answer.' : null,
        status === 'succeeded' ? 100 : null,
        status === 'succeeded' ? 20 : null,
        status === 'running' ? null : 900 + i,
        status === 'failed' ? 'PROVIDER_RATE_LIMITED' : null,
        status === 'uncertain' ? 1 : 0,
        status === 'succeeded' ? 10 : null,
        status === 'succeeded' ? 5 : null,
        `req${i}`,
      )
    }
    const outboxStatus = { pending: 'pending', running: 'claimed', succeeded: 'terminal', failed: 'terminal', uncertain: 'terminal', canceled: 'dispatched' }[status]
    add(`INSERT INTO outbox (id, generation_id, attempt_no, status, job_id, dispatch_count, next_dispatch_at, last_error_code, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 1, ?, ?, ?, ?)`, `o${i}`, id, outboxStatus, `job${i}`, t, status === 'failed' ? 'X' : null, t, t)
    const reservation = status === 'pending' ? 'reserved' : status === 'canceled' ? 'released' : 'consumed'
    add(`INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES (?, 1, 'user:u1', 'global', 'lifetime', ?, ?, ?)`, id, t, reservation, t)
  })
  // A finished tool-loop attempt with two steps (the second's replay already dropped) and a running one.
  add(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, created_at, updated_at) VALUES ('gt', 'run1', 'caseT', 'cfgA', 'openai', 'succeeded', 1, 'at', ?, ?)`, t, t)
  add(
    `INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, finished_at, output_text, truncated, kind, trace_json, steps_used) VALUES ('at', 'gt', 1, 'fenceT', 'succeeded', ?, ?, ?, 'Done.', 0, 'tool_loop', '{"steps":[]}', 2)`,
    t,
    t + 1,
    t + 2,
  )
  add(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, created_at, updated_at) VALUES ('gr', 'run1', 'caseT', 'cfgB', 'anthropic', 'running', 1, ?, ?)`, t, t)
  add(`INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, truncated, kind) VALUES ('ar', 'gr', 1, 'fenceR', 'running', ?, ?, 0, 'tool_loop')`, t, t + 1)
  const step = (id: string, attempt: string, generation: string, no: number, status: string, replay: string | null, fence: string | null) =>
    add(
      `INSERT INTO generation_steps (id, attempt_id, generation_id, attempt_no, step_no, status, fence_token, claimed_at, deadline_at, stop_kind, text, calls_json, replay_json, input_tokens, output_tokens, duration_ms, truncated, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 10, 5, 20, 0, ?)`,
      id,
      attempt,
      generation,
      no,
      status,
      fence,
      t,
      t + 1,
      status === 'succeeded' ? (no === 1 ? 'tool_calls' : 'answer') : null,
      status === 'succeeded' ? 'step text' : null,
      status === 'succeeded' ? '[]' : null,
      replay,
      t,
    )
  step('s1', 'at', 'gt', 1, 'succeeded', null, 'sf1')
  step('s2', 'at', 'gt', 2, 'succeeded', null, 'sf2')
  step('s3', 'ar', 'gr', 1, 'succeeded', '{"items":[]}', 'sf3')
  step('s4', 'ar', 'gr', 2, 'pending', null, null)
  for (const [generation, no, state] of [['gt', 1, 'consumed'], ['gt', 2, 'consumed'], ['gr', 1, 'consumed'], ['gr', 2, 'reserved'], ['gr', 3, 'reserved']] as const) {
    add(`INSERT INTO step_reservations (generation_id, attempt_no, step_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES (?, 1, ?, 'user:u1', 'global', 'lifetime', ?, ?, ?)`, generation, no, t, state, t)
  }
  add(`INSERT INTO step_outbox (id, step_id, generation_id, status, job_id, dispatch_count, next_dispatch_at, created_at, updated_at) VALUES ('so2', 's2', 'gt', 'terminal', 'j2', 1, ?, ?, ?)`, t, t, t)
  add(`INSERT INTO step_outbox (id, step_id, generation_id, status, dispatch_count, next_dispatch_at, created_at, updated_at) VALUES ('so4', 's4', 'gr', 'pending', 0, ?, ?, ?)`, t, t, t)
  // Checks: one on a generated attempt, one on an imported answer.
  add(`INSERT INTO run_imported_outputs (id, run_id, configuration_key, case_key, text, text_sha256, byte_length, created_at) VALUES ('imp1', 'run1', 'cfgC', 'case0', 'Imported.', 'sha', 9, ?)`, t)
  add(`INSERT INTO testimony_checks (id, run_id, case_key, configuration_key, attempt_id, kit_version, results_json, created_at) VALUES ('tc1', 'run1', 'case2', 'cfgA', 'a2', 'summarize-v1', '[]', ?)`, t)
  add(`INSERT INTO testimony_checks (id, run_id, case_key, configuration_key, imported_output_id, kit_version, results_json, created_at) VALUES ('tc2', 'run1', 'case0', 'cfgC', 'imp1', 'summarize-v1', '[{"id":"x"}]', ?)`, t)
  // The second run: one finished generation with a step and a check, to check that deleting a run still cascades.
  add(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, attempt_count, accepted_attempt_id, created_at, updated_at) VALUES ('h1', 'run2', 'case0', 'cfgA', 'anthropic', 'succeeded', 1, 'b1', ?, ?)`, t, t)
  add(`INSERT INTO generation_attempts (id, generation_id, attempt_no, fence_token, status, started_at, deadline_at, output_text, truncated, kind) VALUES ('b1', 'h1', 1, 'fenceB', 'succeeded', ?, ?, 'Other.', 0, 'tool_loop')`, t, t)
  step('hs1', 'b1', 'h1', 1, 'succeeded', null, 'hsf1')
  add(`INSERT INTO step_outbox (id, step_id, generation_id, status, dispatch_count, next_dispatch_at, created_at, updated_at) VALUES ('hso1', 'hs1', 'h1', 'terminal', 1, ?, ?, ?)`, t, t, t)
  add(`INSERT INTO step_reservations (generation_id, attempt_no, step_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES ('h1', 1, 1, 'user:u1', 'global', 'lifetime', ?, 'consumed', ?)`, t, t)
  add(`INSERT INTO outbox (id, generation_id, attempt_no, status, next_dispatch_at, created_at, updated_at) VALUES ('ob1', 'h1', 1, 'terminal', ?, ?, ?)`, t, t, t)
  add(`INSERT INTO attempt_reservations (generation_id, attempt_no, actor_subject, global_subject, lifetime_subject, window_start, state, created_at) VALUES ('h1', 1, 'user:u1', 'global', 'lifetime', ?, 'consumed', ?)`, t, t)
  add(`INSERT INTO testimony_checks (id, run_id, case_key, configuration_key, attempt_id, kit_version, results_json, created_at) VALUES ('tc3', 'run2', 'case0', 'cfgA', 'b1', 'summarize-v1', '[]', ?)`, t)
  // Credentials: active and revoked keys, the 0002 and 0006 columns set, pins on both runs.
  add(
    `INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, revision, created_at, expires_at, last_used_at, last_used_run_id, last_checked_at, last_check_result) VALUES ('k1', 'u1', 'openai', 'Work', 'ct', 'nn', 'v1', 'active', 2, ?, ?, ?, 'run1', ?, 'valid')`,
    t,
    t + 604_800_000,
    t + 5,
    t + 6,
  )
  add(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, created_at, expires_at) VALUES ('k2', 'u1', 'anthropic', 'Work', 'ct2', 'nn2', 'v1', 'active', ?, ?)`, t, t + 604_800_000)
  add(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, status, created_at, revoked_at, last_check_result) VALUES ('k0', 'u1', 'openai', 'Old', 'revoked', ?, ?, 'invalid')`, t - 10, t - 5)
  add(`INSERT INTO run_credentials (run_id, provider, credential_id) VALUES ('run1', 'openai', 'k1'), ('run1', 'anthropic', 'k2'), ('run2', 'openai', 'k0')`)
  add(`INSERT INTO grader_runs (id, run_id, owner_user_id, status, config_json, config_hash, created_at, updated_at) VALUES ('gr1', 'run1', 'u1', 'ready', '{}', 'h', ?, ?)`, t, t)
  add(`INSERT INTO grader_credentials (grader_run_id, provider, credential_id) VALUES ('gr1', 'anthropic', 'k2')`)
  await db.batch(statements)
}

async function tableRows(db: Db) {
  return Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, await rows(db, `SELECT * FROM ${table} ORDER BY ${REBUILT[table]}`)] as const)))
}

const normalize = (sql: unknown) => String(sql).replace(/"/g, '').replace(/\s+/g, ' ').trim()

/** Everything about a table's shape that the rebuild must keep: columns, keys, indexes and triggers. */
async function shape(db: Db) {
  const out: Record<string, unknown> = {}
  for (const table of TABLES) {
    const indexes = await rows(db, `SELECT name, "unique", origin, partial FROM pragma_index_list('${table}') ORDER BY name`)
    out[table] = {
      columns: await rows(db, `SELECT cid, name, type, "notnull", dflt_value, pk FROM pragma_table_info('${table}') ORDER BY cid`),
      foreignKeys: await rows(db, `SELECT "table", "from", "to", on_update, on_delete FROM pragma_foreign_key_list('${table}') ORDER BY "from"`),
      indexes: await Promise.all(indexes.map(async (index) => ({ ...index, columns: (await rows(db, `SELECT name FROM pragma_index_info('${String(index.name)}') ORDER BY seqno`)).map((c) => c.name) }))),
      // Named indexes and triggers keep their exact SQL (whitespace aside).
      objects: (await rows(db, `SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type, name`, table)).map((o) => ({ ...o, sql: normalize(o.sql) })),
    }
  }
  return out
}

/** The table SQL with the provider CHECK swapped and quotes and whitespace dropped. */
async function tableSql(db: Db) {
  const list = await rows(db, `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN (${TABLES.map((t) => `'${t}'`).join(',')}) ORDER BY name`)
  return Object.fromEntries(list.map((t) => [t.name, normalize(t.sql)]))
}

describe('migration 0015_provider_google', () => {
  let legacy: Awaited<ReturnType<typeof openDatabaseBefore>> | null = null
  afterEach(async () => {
    await legacy?.dispose()
    legacy = null
  })

  it('rebuilds eleven tables without losing or changing a row, a key, an index or a trigger', async () => {
    legacy = await openDatabaseBefore('0015_provider_google')
    const { db } = legacy
    await expect(db.prepare(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, status, created_at, revoked_at) VALUES ('kx', 'u9', 'google', 'G', 'revoked', 0, 0)`).run()).rejects.toThrow(/CHECK/)
    await seedLegacy(db)
    const before = await tableRows(db)
    for (const table of TABLES) expect(before[table].length, table).toBeGreaterThan(0)
    const shapeBefore = await shape(db)
    const sqlBefore = await tableSql(db)

    expect(await legacy.migrateRest()).toEqual(MIGRATIONS.slice(MIGRATIONS.findIndex((m) => m.id === '0015_provider_google')).map((m) => m.id))

    // Same rows, same values, same order of columns.
    const after = await tableRows(db)
    for (const table of TABLES) expect(after[table], table).toEqual(before[table])
    // Same columns, foreign keys (now naming the renamed tables), indexes and triggers.
    expect(await shape(db)).toEqual(shapeBefore)
    // The table SQL differs only in the provider CHECK (columns added by ALTER sit at the end of the old text).
    const sqlAfter = await tableSql(db)
    for (const table of TABLES) {
      expect(sqlAfter[table], table).not.toMatch(/_next/)
      expect(sqlAfter[table].includes("provider IN ('openai','anthropic','google','openrouter')"), table).toBe(sqlBefore[table].includes("provider IN ('openai','anthropic')"))
    }
    expect(await rows(db, `SELECT name FROM sqlite_master WHERE name LIKE '%_next%'`)).toEqual([])
    expect(await rows(db, 'SELECT * FROM pragma_foreign_key_check')).toEqual([])

    // No trigger on a table this migration leaves alone names a rebuilt table (a later rebuild would break it).
    const others = await rows(db, `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name NOT IN (${TABLES.map((t) => `'${t}'`).join(',')})`)
    for (const trigger of others) {
      for (const table of TABLES) expect(new RegExp(`\\b${table}\\b`).test(String(trigger.sql).replace(/^CREATE TRIGGER \S+/i, '')), `${String(trigger.name)} names ${table}`).toBe(false)
    }

    // Every immutability trigger still raises.
    await expect(db.prepare(`UPDATE generation_attempts SET output_text = 'changed' WHERE id = 'a2'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(db.prepare(`UPDATE generation_attempts SET kind = 'single' WHERE id = 'at'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(db.prepare(`UPDATE generation_attempts SET steps_used = 1 WHERE id = 'at'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_ATTEMPTS/)
    await expect(db.prepare(`UPDATE generations SET accepted_attempt_id = 'other' WHERE id = 'g2'`).run()).rejects.toThrow(/IMMUTABLE_GENERATIONS/)
    await expect(db.prepare(`UPDATE generations SET sample_no = 3 WHERE id = 'g0'`).run()).rejects.toThrow(/IMMUTABLE_GENERATIONS/)
    await expect(db.prepare(`UPDATE generation_steps SET text = 'x' WHERE id = 's1'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await expect(db.prepare(`UPDATE generation_steps SET replay_json = '{}' WHERE id = 's1'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await expect(db.prepare(`UPDATE generation_steps SET step_no = 5 WHERE id = 's4'`).run()).rejects.toThrow(/IMMUTABLE_GENERATION_STEPS/)
    await expect(db.prepare(`UPDATE testimony_checks SET results_json = '[]' WHERE id = 'tc2'`).run()).rejects.toThrow(/IMMUTABLE_TESTIMONY_CHECKS/)
    await expect(db.prepare(`UPDATE provider_credentials SET status = 'active' WHERE id = 'k0'`).run()).rejects.toThrow(/IMMUTABLE_PROVIDER_CREDENTIALS/)
    await expect(db.prepare(`UPDATE provider_credentials SET provider = 'google' WHERE id = 'k1'`).run()).rejects.toThrow(/IMMUTABLE_PROVIDER_CREDENTIALS/)
    await expect(db.prepare(`UPDATE grader_credentials SET credential_id = 'k1' WHERE grader_run_id = 'gr1'`).run()).rejects.toThrow(/IMMUTABLE_GRADER_CREDENTIALS/)
    // run_credentials re-pin rules (D-57): a canceled run's pin never moves; a generating run's may move
    // to another active key of the same owner and provider only.
    await expect(db.prepare(`UPDATE run_credentials SET credential_id = 'k1' WHERE run_id = 'run2'`).run()).rejects.toThrow(/IMMUTABLE_RUN_CREDENTIALS/)
    await expect(db.prepare(`UPDATE run_credentials SET credential_id = 'k2' WHERE run_id = 'run1' AND provider = 'openai'`).run()).rejects.toThrow(/IMMUTABLE_RUN_CREDENTIALS/)
    await db.prepare(`UPDATE provider_credentials SET status = 'revoked', ciphertext = NULL, nonce = NULL, encryption_key_version = NULL, revoked_at = 1 WHERE id = 'k1'`).run()
    await db.prepare(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, created_at) VALUES ('k3', 'u1', 'openai', 'New', 'c', 'n', 'v1', 'active', 1)`).run()
    expect((await db.prepare(`UPDATE run_credentials SET credential_id = 'k3' WHERE run_id = 'run1' AND provider = 'openai'`).run()).meta.changes).toBe(1)
    expect((await db.prepare(`UPDATE generations SET status = 'failed' WHERE id = 'g1'`).run()).meta.changes).toBe(1)

    // One active key per provider and owner, now including Google; 'google' and 'openrouter' pass the
    // CHECK (the server refuses 'openrouter' through PROVIDERS), anything else is refused.
    const key = (id: string, provider: string, owner = 'u1') =>
      db.prepare(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, created_at) VALUES (?, ?, ?, 'L', 'c', 'n', 'v1', 'active', 1)`).bind(id, owner, provider).run()
    await key('kg1', 'google')
    await expect(key('kg2', 'google')).rejects.toThrow(/UNIQUE/)
    await key('kg3', 'google', 'u2')
    await key('kor', 'openrouter')
    await expect(key('kb', 'bogus')).rejects.toThrow(/CHECK/)
    await db.prepare(`INSERT INTO run_credentials (run_id, provider, credential_id) VALUES ('run1', 'google', 'kg1')`).run()
    await expect(db.prepare(`INSERT INTO run_credentials (run_id, provider, credential_id) VALUES ('run1', 'bogus', 'kg1')`).run()).rejects.toThrow(/CHECK/)
    await db.prepare(`INSERT INTO grader_credentials (grader_run_id, provider, credential_id) VALUES ('gr1', 'google', 'kg1')`).run()
    await db.prepare(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, created_at, updated_at) VALUES ('gg', 'run1', 'case9', 'cfgG', 'google', 'pending', 0, 0)`).run()
    await expect(db.prepare(`INSERT INTO generations (id, run_id, case_key, configuration_key, provider, status, created_at, updated_at) VALUES ('gb', 'run1', 'case9', 'cfgB2', 'bogus', 'pending', 0, 0)`).run()).rejects.toThrow(/CHECK/)
    // A pinned key still cannot be deleted (RESTRICT).
    await expect(db.prepare(`DELETE FROM provider_credentials WHERE id = 'kg1'`).run()).rejects.toThrow(/FOREIGN KEY/)

    // Deleting a run still cascades through every child; deleting an attempt still cascades into its checks and steps.
    await db.prepare(`DELETE FROM runs WHERE id = 'run2'`).run()
    for (const [table, column] of [['generations', 'id'], ['generation_attempts', 'generation_id'], ['outbox', 'generation_id'], ['attempt_reservations', 'generation_id'], ['generation_steps', 'generation_id'], ['step_reservations', 'generation_id'], ['step_outbox', 'generation_id']] as const) {
      expect(await rows(db, `SELECT 1 FROM ${table} WHERE ${column} = 'h1'`), table).toEqual([])
    }
    expect(await rows(db, `SELECT id FROM testimony_checks WHERE id = 'tc3'`)).toEqual([])
    expect(await rows(db, `SELECT 1 FROM run_credentials WHERE run_id = 'run2'`)).toEqual([])
    await db.prepare(`DELETE FROM generations WHERE id = 'gt'`).run()
    expect(await rows(db, `SELECT id FROM generation_steps WHERE generation_id = 'gt'`)).toEqual([])
    expect(await rows(db, `SELECT id FROM step_outbox WHERE id = 'so2'`)).toEqual([])
    expect((await rows(db, `SELECT id FROM generations WHERE run_id = 'run1'`)).length).toBe(8)
    expect((await rows(db, `SELECT id FROM testimony_checks`)).map((r) => r.id).sort()).toEqual(['tc1', 'tc2'])
    await db.prepare(`DELETE FROM grader_runs WHERE id = 'gr1'`).run()
    expect(await rows(db, `SELECT 1 FROM grader_credentials`)).toEqual([])
  })

  it('shows the trap it avoids: dropping the parent first cascades into the children', async () => {
    // The order 0015 never uses. On the same store, with foreign keys on as both stores keep them,
    // DROP TABLE generations deletes every attempt, outbox row and reservation before it drops the table.
    legacy = await openDatabaseBefore('0015_provider_google')
    const { db } = legacy
    await seedLegacy(db)
    expect((await rows(db, 'SELECT id FROM generation_attempts')).length).toBeGreaterThan(0)
    await db.batch([db.prepare('CREATE TABLE scratch_attempts AS SELECT * FROM generation_attempts'), db.prepare('DROP TABLE step_outbox'), db.prepare('DROP TABLE step_reservations'), db.prepare('DROP TABLE generation_steps'), db.prepare('DROP TABLE testimony_checks'), db.prepare('DROP TABLE generations')])
    expect(await rows(db, 'SELECT id FROM generation_attempts')).toEqual([])
    expect(await rows(db, 'SELECT id FROM outbox')).toEqual([])
    expect(await rows(db, 'SELECT generation_id FROM attempt_reservations')).toEqual([])
    expect((await rows(db, 'SELECT id FROM scratch_attempts')).length).toBeGreaterThan(0)
  })

  it('restores a backup taken before the migration into a migrated store, credentials revoked and without secrets', async () => {
    legacy = await openDatabaseBefore('0015_provider_google')
    const h = await createHarness()
    try {
      await seedLegacy(legacy.db)
      const snapshot = await exportSnapshot({ ...h.deps, db: legacy.db })
      expect(snapshot.migrations).not.toContain('0015_provider_google')
      expect(snapshot.tables.provider_credentials.every((row) => row.status === 'revoked' && row.ciphertext === null && row.nonce === null)).toBe(true)
      const target = await createHarness()
      try {
        await restoreSnapshot(target.deps, snapshot)
        for (const table of BACKUP_TABLES) {
          const n = (await target.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n
          expect(Number(n), table).toBe(snapshot.tables[table].length + (table === 'audit_events' ? 1 : 0))
        }
        expect(await rows(target.db, `SELECT DISTINCT status FROM provider_credentials`)).toEqual([{ status: 'revoked' }])
        expect(await rows(target.db, `SELECT ciphertext FROM provider_credentials WHERE ciphertext IS NOT NULL`)).toEqual([])
        // The restored store accepts Google keys.
        await target.db.prepare(`INSERT INTO provider_credentials (id, owner_user_id, provider, label, ciphertext, nonce, encryption_key_version, status, created_at) VALUES ('kg', 'u1', 'google', 'G', 'c', 'n', 'v1', 'active', 1)`).run()
      } finally {
        await target.dispose()
      }
    } finally {
      await h.dispose()
    }
  })
})
