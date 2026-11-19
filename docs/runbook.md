# Operator runbook

All commands run from the app directory, signed in to the DeepSpace CLI as the app owner.
Never paste secret values into commands, chats, or documents.

## Configuration

| Setting | Where | Default |
|---|---|---|
| `MODEL_COURT_STORE` | Durable Object binding (`ModelCourtStore`, migration `v2`) | created on first deploy; one app-wide instance |
| `GENERATION_ENABLED` | `wrangler.toml [vars]` | `"false"`: the fail-closed spending switch |
| `CREDENTIAL_WRITES_ENABLED` | `[vars]` | `"true"`; set `"false"` to pause add/replace (removal always works) |
| `CREDENTIAL_ACTIVE_KEY_VERSION` | `[vars]` | `"v1"` |
| `CREDENTIAL_TTL_DAYS` | `[vars]` | `"7"`; saved keys expire this long after saving or renewal (1–90) |
| `MAX_DAILY_CALLS_PER_USER` / `_GLOBAL` / `MAX_LIFETIME_CALLS_GLOBAL` | `[vars]` | 20 / 100 / 500 |
| `MAX_DOCUMENT_BYTES_PER_USER` / `MAX_DOCUMENT_BYTES_GLOBAL` (spec 04, D-87) | `[vars]` | 33554432 (32 MiB) / 268435456 (256 MiB) |
| `PUBLIC_APP_ORIGIN` | `[vars]` | empty → the request origin is used for invite links |
| `APP_COMMIT` | `[vars]` | set to the shipped commit before each deploy |
| `CREDENTIAL_ENCRYPTION_KEY_V1`, `CREDENTIAL_REQUEST_HMAC_KEY` | DeepSpace secrets store | create with `npm run secrets:provision -- --apply` |
| `CREDENTIAL_ENCRYPTION_KEY_V2` | DeepSpace secrets store | absent; added only for a rotation (`npm run secrets:provision -- --rotation-root v2 --apply`) |
| `CREDENTIAL_REKEY_TARGET_VERSION` | `[vars]` | empty (off). Set to `"v2"` during rotation: the cron re-encrypts active keys to that root |
| `CREDENTIAL_REKEY_REVOKE_UNREADABLE` | `[vars]` | empty (off). `"true"` revokes keys that fail authentication during re-keying |
| `CREDENTIAL_REVOKE_CREATED_BEFORE` | `[vars]` | empty (off). After a restore: epoch ms; the cron revokes every active key created before it |

The three operator settings are read only by the maintenance cron (`src/server/services/credential-ops.ts`).
No HTTP route reaches them. A malformed value turns the operation off and shows up in `/healthz` as `ready:false`.

`/healthz` reports `ready:false` when any setting is missing or malformed. Generation then stays
disabled even if `GENERATION_ENABLED` is `true`.

## First deployment

1. `npx deepspace auth whoami`. If needed, run `npx deepspace auth login` (browser OAuth; done by you).
2. `npx deepspace app init`: registers the app and mints `DEEPSPACE_APP_ID`. Commit `wrangler.toml` afterwards.
3. `npm run secrets:provision` (dry run), then `npm run secrets:provision -- --apply`. The values are generated in memory and piped over stdin.
4. `npm run check`, then commit. Set `APP_COMMIT` to the commit, commit again, and run `npx deepspace deploy`.
5. Check `/healthz` → `ready: true`, `generationEnabled: false`.
6. Run the verification steps in README §"Verification after deploy". Only then set `GENERATION_ENABLED = "true"` and redeploy.

## Disable generation (kill switch)

Set `GENERATION_ENABLED = "false"` and run `npx deepspace deploy`. New runs and retries return 503. The sample,
reviews, results, and credential removal keep working. Jobs already queued still claim; to stop
those, the owner cancels the run.

## Symptoms

| Symptom | Action |
|---|---|
| `CREDENTIAL_UNAVAILABLE` on many attempts | Disable generation. Check `npx deepspace secrets list` for the root name and version (never print values). **Never overwrite a root as a fix**: that makes every saved key undecryptable. |
| Suspected user-key exposure | Disable generation. The affected users remove their keys in Settings (or the operator revokes the rows). Tell them to rotate the key **at the provider**. Fix the leak before re-enabling. |
| Unusual spend | Disable generation. Inspect `budget_buckets`, `attempt_reservations`, and `audit_events`. The Durable Object store has no console yet, so this needs a temporary read-only operator query. Re-enable only after a bypass test passes. |
| Run stuck generating | `npx deepspace logs --search outbox` / `attempt.`. Cron re-dispatches pending outbox rows and expires leases after 120 seconds. Never resend all calls by hand. |
| Provider failing repeatedly | Set the route's `verifiedAt` to `null` in `src/domain/registry.ts` and deploy. Old evidence stays readable. |
| `/healthz` shows `storeOk:false` or API 500s mentioning "different Durable Object" | A Durable Object stub was reused across contexts. Stubs must be created per request/job/cron run (D-22). Roll back to the previous release if needed. |
| Live updates stale | The UI falls back to a 15-second authorized refetch and refetches on focus. Check RecordRoom logs and the `mc_notices` schema. |
| Deletion not finishing | The tombstone already blocks access. Check `[cron] mc-maintenance` log lines; cleanup retries every minute in batches of 10. |
| Identity leak suspected | Disable review routes by deploying a fix, mark the affected runs as potentially unblinded, and rerun the evaluation if needed. |

## Root-key rotation

Re-keying runs in the maintenance cron, once a minute, on up to 250 active keys per tick. Each key is
decrypted under the root its row records. It is then sealed under the target root with a fresh nonce and
the same canonical AAD, which now names the target version. The new ciphertext is opened once as a check
before a guarded update replaces the old one. The update changes only `ciphertext`, `nonce`, and
`encryption_key_version`. Revision, expiry, and last-use stay the same, so owners notice nothing and
`If-Match` values stay valid. Revoked rows are never selected. The job keeps no state: every tick picks
up the active rows that are not on the target yet, so it can be stopped, redeployed, or run twice safely.
Each re-keyed row writes a `credential.rekey` audit event. Log lines carry counts and opaque ids only,
never key material.

1. Set `CREDENTIAL_WRITES_ENABLED="false"` and `GENERATION_ENABLED="false"`, then deploy. Re-keying
   tolerates concurrent saves, renewals, and removals. Pausing writes keeps the window short and the counts
   easy to read.
2. Run `npm run secrets:provision -- --rotation-root v2` (dry run), then add `--apply`. This generates
   `CREDENTIAL_ENCRYPTION_KEY_V2` in memory and refuses to overwrite an existing root. The Worker reads
   only `v1` and `v2`, so a third root needs a code change in `src/server/config.ts`.
3. Set `CREDENTIAL_ACTIVE_KEY_VERSION="v2"` (new saves use v2) and `CREDENTIAL_REKEY_TARGET_VERSION="v2"`,
   then deploy. Watch `npx deepspace logs --search credential.rekey`. Each tick logs `rekeyed`,
   `unreadable`, `revokedUnreadable`, `rootMissing`, `skipped`, and `remaining`.
   - `remaining: 0` means every active key is on v2. Continue with step 4.
   - If every row is `unreadable` and none is `rekeyed`, the v1 root in the secrets store is not the one
     that sealed the keys. Nothing was changed. Clear the target, deploy, and investigate.
     **Never overwrite a root as a fix.**
   - If a few rows are `unreadable` (ids in `unreadableIds`), those rows were altered or corrupted. They
     are already unusable: generation fails them with `CREDENTIAL_UNAVAILABLE`. To finish, set
     `CREDENTIAL_REKEY_REVOKE_UNREADABLE="true"` and deploy. The next tick revokes them through the normal
     path (fences their runs, deletes ciphertext). Then clear the flag. Never set this flag while the
     first case above is possible: it would revoke every key.
   - `rootMissing > 0` means a row records a root this Worker does not have. Restore that secret, never a
     new value under its name.
4. Clear `CREDENTIAL_REKEY_TARGET_VERSION`, re-enable writes and generation, deploy, and run one
   verification run (README §"Verification after deploy").
5. Retire v1 only once `remaining` has been 0 and a backup exists. A rollback to an older release keeps
   the live secrets (`deepspace rollback`), and every v1 release already reads `CREDENTIAL_ENCRYPTION_KEY_V2`,
   so v2 rows stay readable after a rollback. Releases built before the rotation still set
   `CREDENTIAL_ACTIVE_KEY_VERSION="v1"`. Rolling back to one of them after v1 is removed fails closed:
   saving keys and generation stay off until v2 is made active again. Removing v1 is the only step that
   cannot be undone.

Verified locally on both stores (`tests/integration/credential-rekey.test.ts`): fresh nonces, AAD bound to
v2, generation after v1 removal, resumable batches, idempotent reruns, revoked rows unchanged, tampered and
swapped ciphertext refused, wrong-root no-op, no plaintext anywhere. **Not yet run on the live platform.**
The cron tick and the `deepspace logs` output need a live check the first time this runs.

## Deploying migration 0009 (repeats, D-65): needs Avery's OK

`0009_generation_samples` rebuilds `generations`, `generation_attempts`, `outbox` and `attempt_reservations` in
place, in one transaction, the first time the store starts on the new code. Do not deploy it without Avery's
explicit go-ahead, and then:

1. Take a sealed V9 backup (below) and keep it until the new version has run a hearing end to end.
2. If the store is large, restore that backup into a fresh store and start it on the new code first; check
   that the row counts of the four tables match.
3. Deploy when no hearing is generating (a claim or commit that races the rebuild waits for it, but there is
   no reason to test that live).
4. After the deploy, open an old record and an old hearing's owner view: testimony, findings and Cost and speed
   must read as before, with every generation at sample 1.

If the migration fails, the transaction rolls back and the store keeps the old schema; the new code then
cannot serve hearings (it writes `sample_no`), so roll the app back (`npx deepspace rollback`). Once it has
succeeded, rolling the app back is also safe: the older code never names `sample_no`, and its inserts get the
default of 1. The schema itself is not rolled back; restore the backup for that.

## Deploying migration 0015 (Google provider, spec 07, D-106): needs Avery's OK

`0015_provider_google` rebuilds eleven tables in place, in one transaction, the first time the store starts on
the new code: `generations`, `generation_attempts`, `outbox`, `attempt_reservations`, `testimony_checks`,
`generation_steps`, `step_reservations`, `step_outbox`, `provider_credentials`, `run_credentials` and
`grader_credentials`. Only the provider CHECK changes. Do not deploy it without Avery's explicit go-ahead, and then
follow the 0009 steps above: a sealed V9 backup kept until a hearing has run end to end on the new version, a
trial restore into a fresh store first if the store is large (compare the eleven tables' row counts), no hearing
generating during the deploy, and afterwards an old record, an old hearing's owner view and Settings → API keys
must read as before. If the migration fails, the transaction rolls back and the old schema stays; roll the app
back. Once it has succeeded, rolling the app back is safe (older code never writes `'google'`), but a Google key
saved since then would be unusable by the older code; revoke such keys first.

## Migration 0010 (case origin, spec 02, D-71)

`0010_case_origin` adds four nullable columns to `evaluations` and one trigger that keeps them unchanged once set.
It is additive and fast, but it ships after 0008/0009, so the 0009 rules above apply to the release that carries it.
Rolling the app back is safe: older code never names the columns. Backups taken before it restore after it.

## Migration 0012 (extraction documents, spec 04, D-87)

`0012_extraction_documents` only creates five tables, three indexes and three triggers; no existing table changes, so it
needs no backup first (unlike 0009). Older code never names the tables. A store backup (D-32) now carries text documents
whole and leaves PDF bytes out (`redactions.pdfChunksOmitted`); after a restore those PDFs read "Source file not restored"
until the judge uploads the same file again on the draft, which restores the hearing's copy too.

## pdf.js (spec 04 decision 9, D-90)

`pdfjs-dist` is pinned to an exact version (6.5.438) and loaded only on PDF screens, from the app's own origin. Treat every
update as a security change: read its release notes for security fixes, keep `src/lib/pdf.ts`'s options (XFA off, annotations
not rendered, no scripting; 6.x has no eval path), run `npm run check` (`src/lib/pdf.test.ts` opens the fixture with the real
library) and look at a PDF worksheet before deploying. Check for a new release at least once a month while extraction is live.

## Backup and restore (V9)

The data lives in one `ModelCourtStore` SQLite Durable Object. `src/server/services/backup.ts` provides
the parts that can be tested locally:

- `exportSnapshot` reads every Model Court table in one store call, so the snapshot is consistent. It
  includes the schema, the migration ledger, and all rows. Credential secrets never leave the store:
  every `provider_credentials` row is exported **revoked with no ciphertext, nonce, or root version**.
  Receipts of `credential.*` commands are dropped, because they hold a keyed digest of the submitted key.
  Export refuses a table that is missing from `BACKUP_TABLES`, so a new migration cannot be left out of
  a backup without anyone noticing.
- `sealSnapshot` / `openSnapshot` encrypt the file with AES-256-GCM under a dedicated 32-byte backup
  key, with the header authenticated. The snapshot still holds user content (prompts, responses, ratings,
  verdicts), so never store it unsealed. Never use a credential root as the backup key.
- `restoreSnapshot` loads into an **empty**, migrated store and refuses anything else. It also refuses
  another app's file, a digest mismatch, unknown tables, column names that are not identifiers, and
  migrations the target lacks. It forces every credential row revoked without ciphertext again, even for
  a file that was not made by `exportSnapshot`. It drops credential receipts and fences all queued or
  in-flight work pinned to a restored key (`CREDENTIAL_REVOKED`, reservations released). It writes a
  `store.restore` audit event. It is not one transaction across tables: if it fails, discard the target
  store and restore into a fresh one.
- `CREDENTIAL_REVOKE_CREATED_BEFORE` (cron) revokes every active key created before a cutoff, through
  the normal revocation path. Use it after any restore that may have brought back ciphertext, such as a
  platform point-in-time restore. A key the user removed after the restore point would otherwise come back.

Verified locally on both stores (`tests/integration/backup-restore.test.ts`, and the post-restore cases in
`credential-rekey.test.ts`).

### What still needs the live platform (unverified)

No operator path yet runs `exportSnapshot` against the live store or carries a file in or out. Choose one,
then verify it end to end on a staging app before relying on it:

1. **Durable Object point-in-time recovery.** SQLite-backed Durable Objects keep 30 days of history
   (`ctx.storage.getBookmarkForTime`, `onNextSessionRestoreBookmark`). This needs a method on
   `ModelCourtStore` and a way for the operator to call it. It is unknown whether DeepSpace exposes
   either. The restore happens in place and **brings back old ciphertext**, so step 3 below is mandatory.
2. **Sealed export to per-app storage.** A cron-triggered export, sealed under a new
   `MODEL_COURT_BACKUP_KEY` secret and written to a per-app R2 bucket (`[[r2_buckets]]` with
   `bucket_name = "auto"`), then downloaded with a platform tool. Neither the bucket provisioning nor a
   download command has been checked. A stronger variant seals to an operator-held public key, so the
   Worker cannot read old backups.
3. **No temporary public route.** Do not add an HTTP export or restore endpoint, even one restricted to the owner.

### Restore procedure (any method)

1. Set `GENERATION_ENABLED="false"` and `CREDENTIAL_WRITES_ENABLED="false"`, then deploy.
2. Restore: for an empty store, `restoreSnapshot` with the opened file; otherwise, the platform restore.
3. Set `CREDENTIAL_REVOKE_CREATED_BEFORE` to the current epoch ms (`node -e "console.log(Date.now())"`)
   and deploy. Wait for `npx deepspace logs --search credential.restore_revoke` to show `remaining: 0`.
   Leaving the value set is harmless: keys saved after the cutoff are never touched.
4. Check `/healthz`. The `remaining` value in that log line counts the active keys created before the
   cutoff, so `0` is the check that none is left.
5. Re-enable writes and generation, deploy, and tell users to add their keys again. Saved keys never
   survive a restore by design. The schema also makes revocation one-way: a trigger blocks `revoked → active`.

## Rollback

`npx deepspace releases`, then `npx deepspace rollback` to a retained bundle. Code rollback does not roll
back the store. All migrations are additive, so the previous bundle can read the current schema. Never approve
a rollback that deletes Durable Object classes.
