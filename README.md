# Model Court

**Put AI to the test.** Compare two AI configurations through blind human review, then record a
decision supported by the actual responses and ratings.

Sign in → add your provider keys → write cases and two configurations → generate → review
anonymously (you as the judge, plus up to three invited jurors) → reveal → record a verdict.

**Roles.** The person who creates an evaluation is the **judge**: they supply the keys, may review, reveal the models, and record the verdict. Invited reviewers are **jurors**, and their ratings are **the jury’s findings**. The judge’s own review is context-aware (they chose the configurations), so it is always scored separately and never mixed into the jury’s findings. Code, the API, and the spec keep the original terms: `owner` = judge, `invited` reviewer = juror.

- **Live generation is strictly BYOK.** The judge's own OpenAI and/or Anthropic keys pay for every call. There is no platform credit, sponsored call, or billing selector.
- **Jurors need no keys.**
- **The public sample (`/sample`) is an illustrative, hand-written fixture.** It makes no provider requests and needs no account.

Live URL: https://model-court.app.space (generation disabled until providers are verified) · Built from specification v1.2 (Nov 15, 2026).

## Status (Nov 16, 2026)

| Area | State |
|---|---|
| Domain rules, D1 schema, API, generation pipeline, review, reveal, results, verdict, credentials | Implemented; covered by 35 unit and 49 integration tests (local D1, stubbed provider HTTP) |
| UI (shadcn/ui on Base UI) | All screens implemented; landing, sample, and the signed-out gate checked in a browser; authenticated screens not yet exercised with real sign-in |
| DeepSpace registration, secrets, deploy | Done Nov 17: app `app_01M7M0ATC59NFTPZSJJS47J0BX`, release `rel_01M7M2S7YJHBV8PYN8FE77R48P` (UI polish merged; store-stub fix D-22), `GENERATION_ENABLED="false"` |
| Real provider calls | **None made.** Both model routes are disabled (`verifiedAt: null`) until a recorded smoke call |

See `docs/implementation-plan.md` for the checklist, `docs/verification.md` for evidence, and
`docs/decisions.md` for deviations.

## Platform primitives used

| DeepSpace primitive | Use |
|---|---|
| Authentication (platform auth worker, `verifyJwt`, `AuthGate`, `AuthOverlay`) | Identity for every API call; no custom auth |
| SQLite Durable Object (`ModelCourtStore`, in the app DO manifest) | Authoritative domain data with transactional guards. Managed D1 needs an admin tier, so this replaces it (D-20) |
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

## Keeping your API key safe

- Create a **dedicated Model Court–only key** with a low monthly spend cap and access only to the model you test. Admin or organization keys are refused.
- Saved keys **expire after 7 days** unless renewed in Settings. Expiry stops queued work the same way removal does. Settings also shows when each key was last used, and for which run.
- **After testing, remove the key in Settings and rotate or delete it at the provider.** Removing it in Model Court does not revoke it at OpenAI or Anthropic.
- Turn on **two-factor authentication** for the GitHub or Google account you sign in with, and for your provider accounts.

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
| `npm run test:integration` / `test:integration:store` | Real Hono API + real local D1 / the real `ModelCourtStore` Durable Object + real JWT verification. Stubbed: auth issuer key, JobRoom queue, notices, provider HTTP. **No paid calls are possible.** |
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

Text only · 1–5 cases · exactly 2 configurations · 512 output tokens · fixed rubric · 3 jurors ·
2 attempts per generation · 20 calls/user/day · 100/day and 500 lifetime per deployment.

## Known unfinished edges

- Not deployed. No real provider call made. V2/V3-deployed/V5/V6/V9/V12/V13-deployed are open.
- Read-request rate limiting (120 per minute) not implemented (D-13).
- Root-key re-encryption tool for rotation not implemented (runbook).
- Backup/restore procedure for managed D1 unverified (V9).
- Playwright E2E for the multi-user path not written yet; the scaffold's specs still need updating to the new UI.
- Accessibility checks beyond radio naming and 390px layout (keyboard-only review, 200% zoom, contrast audit) are pending.
