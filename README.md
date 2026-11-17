# Model Court

**Put AI to the test.** Compare two AI configurations through blind human review, then record a
decision supported by the actual responses and ratings.

Sign in → add your provider keys → write cases and two configurations → generate → review
anonymously (yourself and up to three invited reviewers) → reveal → record a verdict.

- **Live generation is strictly BYOK.** The evaluation owner's own OpenAI and/or Anthropic keys pay for every call. There is no platform credit, sponsored call, or billing selector.
- **Invited reviewers need no keys.**
- **The public sample (`/sample`) is an illustrative, hand-written fixture.** It makes no provider requests and needs no account.

Live URL: _not deployed yet_ · Built from specification v1.2 (Nov 15, 2026).

## Status (Nov 16, 2026)

| Area | State |
|---|---|
| Domain rules, D1 schema, API, generation pipeline, review, reveal, results, verdict, credentials | Implemented; covered by 35 unit and 49 integration tests (local D1, stubbed provider HTTP) |
| UI (shadcn/ui on Base UI) | All screens implemented; landing, sample, and the signed-out gate checked in a browser; authenticated screens not yet exercised with real sign-in |
| DeepSpace registration, secrets, deploy | **Not done.** Needs your approval and sign-in |
| Real provider calls | **None made.** Both model routes are disabled (`verifiedAt: null`) until a recorded smoke call |

See `docs/implementation-plan.md` for the checklist, `docs/verification.md` for evidence, and
`docs/decisions.md` for deviations.

## Platform primitives used

| DeepSpace primitive | Use |
|---|---|
| Authentication (platform auth worker, `verifyJwt`, `AuthGate`, `AuthOverlay`) | Identity for every API call; no custom auth |
| Managed D1 (`[[d1_databases]] database_id = "auto"`) | Authoritative domain data with transactional guards (ADR-01) |
| JobRoom + `enqueueJob` | Durable generation, one job per attempt, IDs-only payloads |
| CronRoom (`mc-maintenance`, every minute) | Outbox re-dispatch, lease expiry, cleanup |
| RecordRoom (`mc_notices`, own-row read) | Safe live invalidation notices |
| App secrets store | Credential encryption root and request-HMAC key |
| `deepspace deploy` | Hosting at `<name>.app.space` |

**Direct provider integrations (not DeepSpace-managed AI):** OpenAI Responses API and Anthropic
Messages API, called from the Worker with the owner's decrypted key (see `docs/provider-contracts.md`).

**Main tradeoff:** strict BYOK. Users pay their providers directly and the app never spends the
operator's credits, but evaluating live generation needs a key, and the app must hold encrypted keys
so queued work survives a closed browser. The trusted operator, who holds the encryption root, could
technically decrypt them.

## Local setup

Requirements: Node 24 (`.nvmrc`) and npm ≥ 11.6. With npm 10, prefix installs with `npx npm@11.6.2`.

```bash
npx npm@11.6.2 ci
npm run check          # typecheck + lint + unit + integration (no network, no keys)
```

Running the full app locally needs a DeepSpace sign-in:

```bash
npx deepspace auth login
npx deepspace app init
npx deepspace dev start
```

## Tests

| Command | What it covers |
|---|---|
| `npm run test:unit` | Pure rules: scoring, validation, prompt construction, adapter mappings |
| `npm run test:integration` | Real Hono API + real local D1 + real JWT verification. Stubbed: auth issuer key, JobRoom queue, notices, provider HTTP. **No paid calls are possible.** |
| `npx deepspace test run` | Scaffold Playwright suites (needs sign-in) |
| `npm run smoke:providers` | **Paid**, manual: one request per provider; keys typed into a hidden prompt in your own terminal |

## Deploy

See `docs/runbook.md` → "First deployment". Generation stays off (`GENERATION_ENABLED="false"`) until the
verification steps below pass.

### Verification after deploy

1. Signed out: `/` and `/sample` work and make no `/api` requests.
2. Account A: add keys in Settings, create an evaluation, start a run, and close the browser. Generation completes (V6/V12).
3. Account A: open review, create an invite. Account B (a different browser) redeems it and submits. Confirm B never sees model names before reveal (T10).
4. Account A: reveal, then record a verdict. B sees the results.
5. Remove a key while a run is queued: nothing further is sent (T33).
6. Check `/healthz`, `npx deepspace logs`, and the CSP header on the deployed origin.

## Repository map

`src/domain` (pure rules) · `src/server` (API, services, D1, adapters, crypto) · `src/pages` (routes) ·
`src/components` (UI) · `tests/integration` (API + D1) · `scripts` (secrets provisioning, provider smoke) ·
`docs` (architecture, API, runbook, decisions, verification, provider contracts, submission).

## Limits (P0)

Text only · 1–5 cases · exactly 2 configurations · 512 output tokens · fixed rubric · 3 invited reviewers ·
2 attempts per generation · 20 calls/user/day · 100/day and 500 lifetime per deployment.

## Known unfinished edges

- Not deployed. No real provider call made. V2/V3-deployed/V5/V6/V9/V12/V13-deployed are open.
- Read-request rate limiting (120 per minute) not implemented (D-13).
- Root-key re-encryption tool for rotation not implemented (runbook).
- Backup/restore procedure for managed D1 unverified (V9).
- Playwright E2E for the multi-user path not written yet; the scaffold's specs still need updating to the new UI.
- Accessibility checks beyond radio naming and 390px layout (keyboard-only review, 200% zoom, contrast audit) are pending.
