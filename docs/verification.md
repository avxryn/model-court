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

### Not yet verified by the agent (blocked or pending)

- Anything requiring a DeepSpace login: `dev start`, `test run` (Playwright multi-user fixture), registration, secrets, deploy.
- Deployed D1 provisioning, JobRoom execution, CronRoom arming, RecordRoom notice ACLs across two users (V3 deployed, V5, V6).
- Real provider calls: V2 (local smoke), V12 (deployed BYOK egress), T34.
- Encryption round trip with the deployed secret binding (V13 deployed half).
- Authenticated screens rendered with real data; keyboard-only review; 200% zoom; Firefox and Safari.
- Performance targets N01–N03 (T25), backup/restore (V9, T27).

## B. Human verification (you)

Record only what you personally observed. Leave rows empty until then.

| Date | What I checked | Environment | Result | Notes |
|---|---|---|---|---|
| | | | | |
