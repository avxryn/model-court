# Model Court

**Put AI to the test.** Compare AI setups (models, prompts, settings) on your own questions through
blind human review, then record a decision supported by the actual responses, ratings, automatic
checks, cost and speed.

Sign in → add your provider keys → write a case (questions, a scoring guide, two to five parties) →
start the hearing → review anonymously (you as the judge, plus up to three invited jurors) → unseal →
record a verdict.

**Roles.** The person who creates a case is the **judge**: they supply the keys, may review, unseal the
record, and record the verdict. Invited reviewers are **jurors**, and their ratings are **the jury's
findings**. The judge's own review is context-aware (they chose the parties), so it is always scored
separately and never mixed into the jury's findings. Code, the API and the specs keep the original
terms: `owner` = judge, `invited` reviewer = juror, configuration = party, run = hearing.

- **Live generation is strictly BYOK.** The judge's own OpenAI, Anthropic or Google keys pay for every
  call. There is no platform credit, sponsored call, or billing selector.
- **Jurors need no keys** and never see which model wrote which answer before the record is unsealed.
- **The public sample (`/sample`) is an illustrative, hand-written fixture.** It makes no provider
  requests and needs no account.

Live URL: https://model-court.app.space

## Status (Nov 19, 2026)

The v1 submission build (tag `submission-candidate-1`) and all seven roadmap items (`docs/roadmap.md`)
are deployed. The live app runs build `fbe5c5c`.

| Area | State |
|---|---|
| v1 and v2 | Courtroom case file, two or three parties, CSV import, certified-record export, rubric templates, imported evidence, next-turn conversations, the special master (advisory AI grader), accountless guest jurors |
| Roadmap 1–7 | Cost, speed and consistency per party; reusable scenarios and re-hearing; task kits with automatic checks (summarization, classification, structured extraction, answers from supplied sources, tool calling with mock tools); Google Gemini as a third provider; up to five parties |
| Live provider checks | One real call each on OpenAI GPT-6 Luna and Anthropic Claude Haiku 5.5 (Nov 17). Not yet checked: multi-message calls, structured output, PDF input, tool calls, and every Gemini route. Hearings that need an unchecked capability are refused with a plain message until its paid smoke check is recorded |
| Live party cap | 3 (the code allows 5; `MAX_CONFIGURATIONS_PER_RUN`) |
| Tests | About 670 unit tests and 290 integration tests, run against both local D1 and the real `ModelCourtStore` Durable Object with provider HTTP stubbed, plus Playwright smoke tests |
| Not yet exercised live | A full signed-in hearing with jurors, and the signed-in screens added by the roadmap |

Evidence is in `docs/verification.md`, decisions and deviations in `docs/decisions.md`.

## Platform primitives used

| DeepSpace primitive | Use |
|---|---|
| Authentication (platform auth worker, `verifyJwt`, `AuthGate`, `AuthOverlay`) | Identity for every API call; no custom auth |
| SQLite Durable Object (`ModelCourtStore`, in the app DO manifest) | Authoritative domain data with transactional guards. Managed D1 needs an admin tier, so this replaces it (D-20) |
| JobRoom + `enqueueJob` | Durable generation, one job per attempt (or tool-loop step), IDs-only payloads |
| CronRoom (`mc-maintenance`, every minute) | Outbox re-dispatch, lease expiry, cleanup |
| RecordRoom (`mc_notices`, own-row read) | Safe live invalidation notices |
| App secrets store | Credential encryption root and request-HMAC key |
| `deepspace deploy` | Hosting at `<name>.app.space` |

**Direct provider integrations (not DeepSpace-managed AI):** the OpenAI Responses API, the Anthropic
Messages API and the Gemini API (`generateContent`), called from the Worker with the judge's decrypted key,
only to those three fixed hosts (`src/server/providers/endpoints.ts`, `docs/provider-contracts.md`).

**Main tradeoff:** strict BYOK. Users pay their providers directly and the app never spends the
operator's credits, but evaluating live generation needs a key, and the app must hold encrypted keys
so queued work survives a closed browser. The trusted operator, who holds the encryption root, could
technically decrypt them.

## Keeping your API key safe

- Create a **dedicated Model Court–only key** with a low monthly spend cap and access only to the models you test. Admin or organization keys are refused, and so is a key pasted on another provider's card.
- Saved keys **expire after 7 days** unless renewed in Settings. Expiry stops queued work the same way removal does. Settings also shows when each key was last used, and for which hearing.
- **After testing, remove the key in Settings and rotate or delete it at the provider.** Removing it in Model Court does not revoke it at OpenAI, Anthropic or Google.
- Turn on **two-factor authentication** for the account you sign in with, and for your provider accounts.

## Local setup

Requirements: Node 24 (`.nvmrc`) and npm ≥ 11.6. With npm 10, prefix installs with `npx npm@11.6.2`.

```bash
npx npm@11.6.2 ci
npm run check          # typecheck, lint, unit, integration on both stores, smoke (no keys, no paid calls)
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
| `npm run test:unit` | Pure rules: scoring, validation, prompt construction, adapter mappings, kits and checks, cost and speed |
| `npm run test:integration` / `test:integration:store` | Real Hono API + real local D1 / the real `ModelCourtStore` Durable Object + real JWT verification. Stubbed: auth issuer key, JobRoom queue, notices, provider HTTP. **No paid calls are possible.** |
| `npx deepspace test run smoke` | Playwright against a local dev server: public pages, landing links, the sample, accessibility (axe) |
| `npx deepspace test run all` | Also the signed-in and two-account specs, which skip until DeepSpace test accounts exist (`npx deepspace test accounts create ... --password-stdin`) |
| `npm run smoke:providers` | **Paid**, manual: real calls per provider and mode (single, multi, json, pdf, tools); keys typed into a hidden prompt in your own terminal |

## Deploy

See `docs/runbook.md`. Keep generation off (`GENERATION_ENABLED="false"`) on a new deployment until
the providers pass `npm run smoke:providers`. A migration that rebuilds tables (0009, 0015) needs a
backup first; the live backup path is not built yet (runbook, "Backup and restore").

### Verification after deploy

1. Signed out: `/` and `/sample` work and make no `/api` requests; `/healthz` shows the new build.
2. Account A: add keys in Settings, create a case, start a hearing, and close the browser. Generation completes.
3. Account A: open review, create an invite. Account B (a different browser) redeems it and submits. Confirm B never sees model names, cost or check results before unsealing.
4. Account A: unseal, then record a verdict. B sees the results.
5. Remove a key while a hearing is queued: nothing further is sent.
6. Check `npx deepspace logs --level error` and the CSP header on the deployed origin.

## Repository map

`src/domain` (pure rules, kits, checks, limits, registry) · `src/server` (API, services, store, provider
adapters, crypto) · `src/pages` (routes) · `src/components` (UI) · `tests/integration` (API on both
stores) · `tests/*.spec.ts` (Playwright) · `scripts` (secrets provisioning, provider smoke) · `docs`
(architecture, API, runbook, decisions, verification, provider contracts, roadmap, specs).

## Limits

1–5 questions · 2–5 parties (3 on the live app) and at most 15 answers per juror · 1–3 samples per
answer · 512 output tokens (plus reasoning headroom where reasoning cannot be turned off) · 3 invited
jurors · 2 attempts per answer · 20 calls per user per day, 100 per day and 500 in total per deployment.

## Known unfinished edges

- No live backup path yet (V9): items 1–7 were deployed without one, on Avery's choice.
- No full signed-in hearing with jurors on the live app yet; the roadmap's signed-in screens are covered by render and integration tests, not by Playwright.
- Paid smoke checks pending for multi-message calls, structured output, PDF, tool calls and Gemini, so those hearings stay blocked.
- Accessibility checks beyond axe and the 390 px layout (keyboard-only review, 200% zoom, contrast audit) are pending.
