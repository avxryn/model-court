# Verification record

Agent work and human verification are recorded **separately**. A passing stubbed test
is not evidence that a real provider call works. Nothing below claims a deployed or
paid-provider result unless it says so.

## A. Agent-performed checks (coding agent, local machine)

Environment: Windows 11, Node 24.19.0, npm 11.6.2 via `npx`, `deepspace@0.44.2`,
wrangler/workerd from the lockfile, Vitest 4.1, local D1 via `wrangler getPlatformProxy`.

| Date | Scenario | Command / method | Observation | Spec |
|---|---|---|---|---|
| 2026-11-16 | Local D1 transaction semantics | throwaway probe against `getPlatformProxy` D1 | A failed CHECK inside `batch()` rolled back every statement. A zero-row UPDATE reported `changes: 0` and did **not** roll back. Triggers created via `prepare().run()` aborted updates. `PRAGMA foreign_keys = 1`. | V3 (local half) |
| 2026-11-16 | Typecheck, lint, boundary rules | `npm run typecheck`, `npx eslint .`; planted probe files | Clean. The boundary rule flagged a value import of `@/server/config` from `src/lib` and a `react` import in `src/domain`, allowed a type-only import, then the probes were deleted. | T29 (partial) |
| 2026-11-16 | Unit tests | `npm run test:unit` | 35 passed: rubric/scoring fixtures incl. §11.4, tie, near-tie, disagreement, forged rating; draft limits by code point/UTF-8; canonical hashing; prompt excludes expected behavior; adapter mappings. | T03, T04 (stubbed), T14 |
| 2026-11-16 | API integration tests (real Hono app + real local D1 + real ES256 `verifyJwt`; auth issuer, JobRoom, notices, and provider HTTP stubbed) | `npm run test:integration` | 49 passed (incl. 3 regressions from the independent review, D-19). | T01, T02, T05–T13, T15, T16 (notice payload only), T18, T20, T26, T31–T33 (stubbed provider) |
| 2026-11-16 | Concurrency | inside the integration suite | 20 sequential submit-vs-reveal races: commit order decided membership, and no late submission entered a cohort. 20 simultaneous admissions under a 30-call global cap never over-allocated. A double-clicked Run created one run and one set of reservations (after fix D-14). | T13, T18 |
| 2026-11-16 | Production build and bundle scan | `vite build` with a temporary, gitignored dummy-id config (output deleted) | Built. The client bundle contains no provider URLs, `x-api-key`, `X-App-Action`, `AES-GCM`, `command_guards`, `APP_OWNER_JWT`, or sentinel key strings. The HTML has no inline scripts. | T22 (client build half), T30 |
| 2026-11-16 | Route lock-down on the real Worker in local workerd | `vite` dev + `curl` | `/api/v1/evaluations` without a token → 401. Integration proxy, actions, AI chat, files, `/_deepspace/*`, `/ws/jobs/*`, `/ws/cron/*`, and arbitrary `/ws/<room>` → 404. `/healthz` shows `ready:false` with secrets unset. | V4, V7 (local) |
| 2026-11-16 | Public sample in the browser pane | Chromium pane at 800px and 390px | Renders with no horizontal overflow at 390px. A rubric label click selects its radio, and a 0 marks the note as required. Reveal shows the mapping and the example verdict. **Zero** `/api` or provider requests were observed. | T19 (local), T21 (partial) |
| 2026-11-16 | Radio accessibility | DOM inspection | Found unnamed `role=radio` elements (Base UI). Fixed by adding `aria-labelledby` to the items and groups, then re-checked the DOM. | T21 (partial) |

| 2026-11-16 | Independent code review (separate agent, read-only, not shown my conclusions) | review of src/server, domain scoring, worker wiring | No violations of identity, blinding, credential, transition, budget, or receipt rules found; 3 low-severity issues fixed (D-19). Not a substitute for your own review. | T29 (partial) |

| 2026-11-17 | First deploy attempt | `npx deepspace deploy` | Refused: D1 custom binding requires an admin tier (account is free). No release created. | V3 → D-20 |
| 2026-11-17 | Durable Object SQLite semantics | local workerd probe + `npm run test:integration:store` | Probe: trigger abort, `transactionSync` rollback on guard CHECK, partial unique, RETURNING, JSON, FK cascade all hold. Full integration suite 49/49 against the real `ModelCourtStore`; a mode check confirmed the run used the Durable Object, not D1. | V3 (revised) |

| 2026-11-17 | Deploy | `npx deepspace deploy` (commit ebd870c) | Live at https://model-court.app.space, release rel_01M7M1JKZ3WJ7P1YTKCN0EGF30, edge and data plane confirmed, bundle retained. | T23 (partial) |
| 2026-11-17 | Deployed smoke (signed out) | `curl` + Chromium pane | `/healthz` → `{"build":"ebd870c","ready":true,"generationEnabled":false}` (secrets bound). `/`, `/sample`, `/evaluations` → 200. `/api/v1/evaluations` without or with a bad token → 401. Integration proxy, actions, AI chat, files, `/_deepspace/*`, debug, `/ws/jobs`, `/ws/cron`, arbitrary `/ws/<room>` → 404. CSP, X-Frame-Options, nosniff, Referrer-Policy present. No console errors on `/sample` and the signed-out gate. | V4, V7, T19 (deployed), §9.5 |
| 2026-11-17 | Deployed scheduler + store | `npx deepspace logs --search cron` | `[cron] mc-maintenance ok 303ms` after the deploy wake-up; the task ran migrations and maintenance against the live `ModelCourtStore`. | V6 (scheduler half), V3 (revised, deployed) |

| 2026-11-17 | Redeploy with merged UI polish (D-21) | `npx deepspace deploy` (commit 658e27b) + curl + Chromium pane | Release rel_01M7M28GWSM7YQTBEYH5956K7G; `/healthz` build 658e27b, ready true, generation off. Pages 200, API 401, integration proxy 404, CSP present. Fresh `/sample`: 18 labelled radios, label click selects, reveal works, no horizontal overflow, no console errors, no `/api/v1` or provider requests. Merge kept radio `aria-labelledby` wiring and all scaffold test ids; no server/domain/palette changes. | T19, T23 (partial), T30 |

| 2026-11-17 | Incident: signed-in API 500s (user report, req_fd2b2616…) | `npx deepspace logs` | Cause: cached Durable Object stub reused across contexts ("Cannot perform I/O on behalf of a different Durable Object"); cron also failing. Fixed in D-22, released rel_01M7M2S7YJHBV8PYN8FE77R48P (ef9dc24). Over ~2 min after release: 2 cron runs ok, 8/8 `/healthz` store checks ok, zero 5xx or I/O errors in logs. Signed-in page load after the fix still needs your confirmation. | V3/V6 (deployed) |

| 2026-11-17 | Key safeguards (D-23) | `npm run check` | 35 unit tests pass; 57 integration tests pass on local D1 and 57 on the Durable Object store. New tests: admin keys refused at save (both providers) with nothing stored; 7-day expiry and renewal; an expired key is never decrypted before the cron sweep (zero provider calls, reservations released); cron revokes expired keys via the revocation path (ciphertext removed, queued work fenced, blocked from new runs); last use recorded with run id and no key material. Not deployed yet. | T31–T33 (extended) |
| 2026-11-17 | Key safeguards deployed (D-23) | `npx deepspace deploy --json`; `/healthz` x5; `deepspace logs` | Release `rel_01M7N1VZ51HAWR7C3MH00RXG49` (build `52868f5`), serving and data plane confirmed. `/healthz` returned build 52868f5, ready, storeOk true, generation disabled on 5 of 5 calls. `/api/v1/credentials` 401 unauthenticated; `/sample` 200. Cron `mc-maintenance ok` at 09:26, 09:28, 09:29 (local), after the deploy. The sweep now queries `expires_at`, so migration 0002 ran on the live store. No error-level logs in the 6 minutes after deploy. Renew and expiry UI not yet seen signed in. | V5, T31–T33 |
| 2026-11-17 | Provider smoke (V2/T04) | `npm run smoke:providers`, run by you in your terminal; the agent read the output | Both routes succeeded. OpenAI `gpt-6-luna`: `completed`, 153/24 tokens, observed model matches. Anthropic `claude-haiku-5-5`: `end_turn`, 228/151 tokens, observed model matches. An earlier Anthropic attempt with a different key was normalized to `PROVIDER_AUTH_FAILED`. Both routes now have `verifiedAt: 2026-11-17`. Not yet deployed; live generation is still off. | V2, T04 |

### Not yet verified by the agent (blocked or pending)

Updated 2026-11-17. Sign-in, registration, secrets, deploy, the Durable Object store, and cron are verified above.

- Deployed generation (V12, T34): a real run in the live app with keys saved in Settings. This needs live generation turned on, which is a redeploy.
- JobRoom execution in production, and RecordRoom notice access across two users (V5 jobs, V6). Both need a live run.
- Encryption round trip with the deployed secret binding (V13 deployed half). This happens on the first live run.
- Playwright E2E (`deepspace test run`) has not been executed.
- Authenticated screens with real data; keyboard-only review; 200% zoom; 390px width; Firefox and Safari.
- Performance targets N01–N03 (T25), backup/restore (V9, T27).

## B. Human verification (you)

Record only what you personally observed. Leave rows empty until then.

| Date | What I checked | Environment | Result | Notes |
|---|---|---|---|---|
| 2026-11-17 | Signed-in pages load after the D-22 fix (reported in chat: "Yes, they load") | https://model-court.app.space, release rel_01M7M2S7YJHBV8PYN8FE77R48P | Pass | Your own browser and account |
| | | | | |
