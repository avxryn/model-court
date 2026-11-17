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
| `PUBLIC_APP_ORIGIN` | `[vars]` | empty → the request origin is used for invite links |
| `APP_COMMIT` | `[vars]` | set to the shipped commit before each deploy |
| `CREDENTIAL_ENCRYPTION_KEY_V1`, `CREDENTIAL_REQUEST_HMAC_KEY` | DeepSpace secrets store | create with `npm run secrets:provision -- --apply` |

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

## Root-key rotation (planned, manual)

1. Set `CREDENTIAL_WRITES_ENABLED="false"` and `GENERATION_ENABLED="false"`, then deploy.
2. Add `CREDENTIAL_ENCRYPTION_KEY_V2` (generate the same way the provisioning script does; never print it), then deploy.
3. Re-encrypt active rows from v1 to v2 with fresh nonces (**not implemented yet**; this is a gap), verify, and set `CREDENTIAL_ACTIVE_KEY_VERSION="v2"`.
4. Retire v1 only after the backup and rollback check.

Until step 3 exists, rotate by asking users to re-add their keys after a root change.

## Backup and restore

V9 is unresolved: the data lives in the `ModelCourtStore` SQLite Durable Object, and no export/restore procedure exists yet. A restore
must leave `provider_credentials` rows revoked and without ciphertext. The schema makes revocation
one-way (a trigger blocks `revoked → active`), but a raw restore could reinsert old rows, so after any
restore revoke every credential row before re-enabling generation.

## Rollback

`npx deepspace releases`, then `npx deepspace rollback` to a retained bundle. Code rollback does not roll
back the store. All migrations are additive, so the previous bundle can read the current schema. Never approve
a rollback that deletes Durable Object classes.
