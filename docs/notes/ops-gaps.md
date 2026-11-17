# Ops gaps: root-key re-encryption and store backup/restore

Branch `claude/gracious-meitner-eaf9fe`, based on `next` at `9f3fac5`. Nothing was deployed, pushed, or
uploaded. This note records decisions and evidence instead of `docs/decisions.md` and
`docs/verification.md`. Fold it into those files when the branch is merged.

## Decisions

**O-1. Re-keying is cron-driven and set in `[vars]`; no route reaches it.**
`CREDENTIAL_REKEY_TARGET_VERSION` makes the maintenance cron (`src/cron.ts` → `runCredentialOps`)
re-encrypt up to 250 active keys per tick (pages of 25). To enable it, the operator deploys a config
change, so only the app owner can start it, and it creates no new attack surface. An owner-only HTTP
endpoint was rejected: it would put plaintext-handling code behind a public route.

**O-2. Re-keying keeps no state and is guarded per row.** Each tick selects
`status = 'active' AND encryption_key_version <> target` with keyset pagination by id. The update is a
`runGuarded` batch that requires the exact row it read (same id, version, nonce, and ciphertext, still
active). A concurrent revoke, replace, or second tick therefore turns into `skipped`, never a lost
write. Nothing is persisted between ticks, so fixing a wrong root and redeploying simply resumes. The
alternative of recording per-row failures was rejected: a wrong root would have marked every row
failed, and those markers would outlive the fix.

**O-3. Re-keying changes only `ciphertext`, `nonce`, and `encryption_key_version`.** Revision, expiry,
and last-use stay the same, so `If-Match` values held by open Settings tabs stay valid and owners notice
nothing. The AAD is the same canonical `CredentialBinding` construction, with `keyVersion` set to the
target. Each new ciphertext is opened and compared before the update. If that check fails, the tick
aborts.

**O-4. Unreadable rows are left alone unless the operator opts in.** A row that fails authentication
(tampered, swapped between rows, or a wrong root) is reported in `unreadable` and `unreadableIds` and not
touched. `CREDENTIAL_REKEY_REVOKE_UNREADABLE="true"` revokes such rows through
`revokeCredentialStatements`, which fences their runs and deletes the ciphertext. It is a separate flag
because a wrong v1 root makes every row unreadable.

**O-5. Backups never contain credential secrets.** `exportSnapshot` writes every credential row as
revoked, with no ciphertext, nonce, or root version. It drops `credential.*` command receipts, because
their `request_hash` is an HMAC of the submitted API key. `restoreSnapshot` applies the same redaction
again on the way in, so even a raw or hand-made file cannot restore a usable key. Restored work pinned to
any key is fenced (`CREDENTIAL_REVOKED`, unsent reservations released).

**O-6. Backups are consistent and sealed.** Export reads all tables in one store call (one
`transactionSync` on the Durable Object). The file still holds user content, so `sealSnapshot` uses
AES-256-GCM with a dedicated key and an authenticated header. A credential root is never used for it.
The size limit for a single store call (Durable Object RPC payload) has not been measured. For a v1-sized
store it is not a concern. Past that, export needs paging, which loses the single-transaction guarantee.

**O-7. Export fails closed on unknown tables.** `BACKUP_TABLES` lists every data table in parent-first
order. Export refuses a table that is missing from the list. Table names with the prefixes `sqlite_`,
`_cf_`, `d1_`, or `__` are treated as platform tables. Miniflare's Durable Object store includes
`__miniflare_do_name`, which the store-suite run found. **v2 sessions that add a table in a migration
must add it to `BACKUP_TABLES`.** `backup-restore.test.ts` fails if they don't.

**O-8. Post-restore revocation is a cutoff, not a one-shot.** `CREDENTIAL_REVOKE_CREATED_BEFORE=<ms>`
revokes every active key created before the cutoff, on every tick. Leaving it set is idempotent and never
touches keys saved after the restore. This covers platform point-in-time restores, which bring back old
ciphertext in place.

**O-9. A malformed operator value turns the operation off.** An unknown re-key target root or a
non-integer cutoff disables that operation and adds a `problems` entry, so `/healthz` shows `ready:false`.

## What changed

- `src/server/services/credential-ops.ts`: `rekeyCredentials`, `revokeCredentialsCreatedBefore`, `runCredentialOps`.
- `src/server/services/backup.ts`: `exportSnapshot`, `restoreSnapshot`, `sealSnapshot`, `openSnapshot`, `BACKUP_TABLES`.
- `src/server/config.ts`: three new operator `[vars]` (`credentialOps`).
- `src/cron.ts`: runs `runCredentialOps` after maintenance.
- `scripts/provision-app-secrets.mjs`: `--rotation-root v2` adds only the next root, with the same refusal to overwrite.
- `docs/runbook.md`: new configuration rows, plus rewritten "Root-key rotation" and "Backup and restore (V9)" sections.
- Tests: `tests/integration/credential-rekey.test.ts` (12), `tests/integration/backup-restore.test.ts` (6).
- No schema migration, and no change to `src/server/api.ts`, `src/pages`, or `src/components`.

## Evidence (agent, local)

- `npm run check` passed on 2026-11-17: typecheck, lint, 35 unit tests, and 75 integration tests on each store (the
  integration suite runs on local D1 and again on the `ModelCourtStore` Durable Object).
- Re-key cases, on both stores: fresh nonce and ciphertext; opens under v2 and not under v1; revision and
  expiry unchanged; generation sends the right keys after v1 is removed; resumable 1-row and 2-row batches;
  an idempotent rerun changes nothing; revoked rows byte-identical; ciphertext swapped between rows refused;
  a flipped byte refused; with the opt-in flag, unreadable rows revoked; a wrong v1 root changes nothing and
  succeeds after the fix; a missing root is skipped; an unknown target is refused; no sentinel key in the
  report, logs, audit rows, receipts, outbox, or generations; the cron entry point runs only when enabled.
- Post-restore cutoff: keys created before the cutoff are revoked and their queued generations fenced;
  later keys are untouched; a rerun is a no-op; no provider call afterwards.
- Backup cases, on both stores: no sentinel in the export; every credential row revoked with nulls; no
  credential receipts; triggers in the schema; the live store unchanged by export; unknown table refused;
  a sealed round trip; wrong key, flipped tag byte, and edited header refused; a restore into a fresh store
  matches row counts, leaves no usable key, fences the queued run, makes no provider call, and keeps the
  `revoked → active` trigger; an unredacted file is still stripped; refusals (non-empty target, other app,
  bad format, digest mismatch, unknown table, injected column name, missing migration) write nothing.

## Not verified (needs the live platform)

- The first live re-key tick: that the cron runs `runCredentialOps` with the deployed `[vars]`, and that the
  `credential.rekey` log line shows up in `npx deepspace logs`.
- `--rotation-root v2` was not run (it lists secrets on the platform). Only its argument check ran locally.
- Any path that moves a snapshot between the live Durable Object and the operator: point-in-time recovery
  (DeepSpace exposure unknown) or sealed export to a per-app R2 bucket (not provisioned). The runbook lists
  both as unverified options and rules out a public route.
- The single-call export size limit on the live Durable Object.
