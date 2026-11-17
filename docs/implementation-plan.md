# Model Court — implementation plan and checklist

Blueprint: *Model Court Technical Specification v1.2* (Nov 15, 2026). This file maps
the spec's phases (§12.1) and acceptance tests (§11.2) to the actual build. A box is
checked only when the stated evidence exists in `docs/verification.md`.

Status legend: `[x]` done with evidence · `[~]` implemented, evidence pending
(usually needs DeepSpace login, deployment, or a real provider key) · `[ ]` not done.

## Platform facts established (SDK `deepspace@0.44.2`, scaffold `create-deepspace@latest`, Nov 16 2026)

- Scaffold: Vite + React 19 + Hono worker + generouted, Tailwind v4, Base UI primitives
  (`@base-ui/react ~1.6`), Zod 4.5. Node 24.19 / npm 11.6.2 (via `npx npm@11.6.2`).
- Auth: platform auth worker; `verifyJwt({publicKey, issuer}, token)` → `{userId, claims}`.
- Jobs: `enqueueJob(env.JOB_ROOMS, 'app:<id>', type, payload, {maxAttempts})` posts to the
  JobRoom's internal `/enqueue`, which does **not** consult `authorizeWrite`; client
  WebSocket enqueue/cancel/retry does. JobRoom runs one handler at a time.
- Cron: `CronRoom` tasks in `src/cron.ts`, armed by `armCronRoom` middleware.
- D1: `[[d1_databases]] database_id = "auto"` provisions at first deploy; local Miniflare
  D1 verified: guard-CHECK `batch()` rollback, triggers via `prepare().run()`, FKs on.
- `runMigrations` splits on `;` naively → cannot carry trigger bodies (spec §5.6 warning).
- Secrets: per-app store via `deepspace secrets`; bound at deploy, never fetched at runtime;
  `secrets upload -` reads stdin (no value on a command line).
- Generic scaffold surfaces that could spend owner credits or expose data: integration
  proxy (`/api/integrations/:name/:endpoint`, default developer-billed), AI chat + agent
  tool routes, server actions, files proxy, Yjs/canvas/presence/cron/jobs sockets.

## Phase mapping

| Spec phase | Slice in this repo | Tests |
|---|---|---|
| P0 platform proof | scaffold, D1 binding, route lock-down, crypto round trip, shadcn | T28 (local half), T30, V3 local, V4/V7 by code + tests; V5/V6/V12/V13 need deploy |
| P1 persistence/access | `src/domain/*`, `src/server/db/*`, credentials, evaluations/draft, run admission | T01–T05, T31, T32 |
| P2 generation | outbox, budget, jobs, adapters, retry/cancel, lease reconciliation, cron | T06–T08, T18, T26, T33 |
| P3 review/decision | invites, assignments, ratings, submit, reveal, results, verdict | T09–T15 |
| P4 release quality | sample, failure UI, deletion/cleanup, audit, a11y | T17, T19–T22 |
| P5 submission | deploy, smoke, README, submission note | T23, T34 (user + agent) |

## Checklist

### P0 — platform proof
- [x] Scaffold with documented workflow (`npm create deepspace@latest .`)
- [x] D1 binding `MODEL_COURT_DB` declared; local batch/trigger semantics proven
- [x] Generic paid/data routes removed or denied; JobRoom client access denied
- [x] shadcn/ui (`base-nova`, Base UI) source + `components.json` adopted
- [x] AES-256-GCM credential crypto with AAD; tamper/wrong-root tests
- [~] DeepSpace login, app registration, secrets upload, deploy (needs user approval)
- [~] V12 deployed direct BYOK call per provider (needs user's own keys in the deployed app)

### P1 — persistence and access
- [x] Zod contracts, limits by code points + UTF-8 bytes, strict unknown-field rejection
- [x] Append-only migrations incl. immutability triggers
- [x] Guarded-transaction helper (receipt `guard_ok` CHECK) + idempotency receipts
- [x] Evaluations CRUD, keyset pagination, If-Match revisions, 404 for invisible
- [x] Credentials API: save/replace/remove, safe metadata only, HMAC request digest
- [x] Run admission: snapshot + hash + run_credentials + reservations + outbox atomically

### P2 — generation
- [~] Outbox dispatch (API best effort + cron repair) to JobRoom; IDs-only payload
- [x] Claim with fencing token; fenced commit; uncertain on lease expiry; no auto retry
- [~] OpenAI Responses + Anthropic Messages adapters; byte ceiling; redirect refusal; error normalization
- [x] Manual retry (max 2 attempts), cancel, credential revocation fencing
- [x] Budget buckets: user/day, global/day, lifetime; release only proven-unsent

### P3 — review and decision
- [x] Open review freezes eligible manifest; owner session
- [x] Invites: 256-bit token in URL fragment, SHA-256 at rest, 24h, single use, 3 slots
- [x] Stable Fisher–Yates assignment per session; anonymous DTO allowlist
- [x] Draft save with revision CAS; submit complete set; immutable after submit
- [x] Reveal with pending-count acknowledgment; frozen cohort
- [x] Deterministic scoring (invited vs owner cohorts, exact ties, disagreement)
- [x] Verdict revisions (append-only)

### P4 — release quality
- [x] Public `/sample` fixture, labeled illustrative, zero network to providers
- [~] Safe notices collection (`mc_notices`) + focus/15s reconciliation
- [~] Deletion tombstone + cron cleanup
- [x] Audit events (IDs/codes only)
- [~] Security headers
- [ ] Keyboard/390px checks (manual, user)

### P5 — submission
- [~] README, architecture, API, runbook, provider contracts, submission note
- [ ] Deployed smoke record (agent) + personal verification (user)

### Notes on [~] items (Nov 16)
- Outbox, cron, notices: logic tested locally with the JobRoom/RecordRoom boundary stubbed; real DeepSpace JobRoom/CronRoom/RecordRoom behavior needs a deploy (V5, V6).
- Adapters: request/response mapping unit-tested against the documented schemas; no real call yet (V2/V12).
- Deletion: tombstone and purge tested locally; scheduled execution needs a deploy.
- Security headers: implemented; verify on the deployed origin.
- Docs: drafted; deployment facts, the live URL, and human verification are still empty by design.

## Stretch goals (after submission — not part of P0)

Collected on Nov 17, 2026 from use-case discussions. These come after the Nov 20 submission, and after the spec's own P1 items (third configuration, CSV import, JSON export, result charts). Each one needs its own scope, versioning (rubric/snapshot), and tests before it starts. None of them may weaken BYOK, blinding, or evidence immutability.

### S1. Use cases that work today (document and demo; no code)
- [ ] **Model selection before launch.** Example: moving a support bot to a cheaper model. Show coverage and latency next to quality in the walkthrough.
- [ ] **Prompt regression testing.** Configuration-comparison mode, old vs new system instructions on the same cases.
- [ ] **Policy / knowledge-base assistants.** HR, IT helpdesk, refunds, internal docs. Grounding and abstention are what the rubric already scores.
- [ ] **Provider-update regression check.** Re-run frozen cases after a model alias changes; compare against the earlier verdict in the run history.
- [ ] **Domain-expert sign-off.** Lawyers, clinicians, compliance officers, or teachers review blind without keys.
- [ ] **Teaching and hiring exercises.** Rubric scoring plus the reveal and the disagreement view as discussion material.

### S2. Small additions
- [ ] **Rubric templates (versioned).** Ship variants alongside `reference-qa-v1`:
  - safety / red-team: prompt injection, jailbreak resistance, refusal boundaries;
  - writing quality: tone, clarity, faithfulness for emails, release notes, summaries.

  Historical runs keep their recorded rubric version.
- [ ] **Decision export for procurement / vendor selection.** Dated, owner-only export of cases, responses, ratings, rationale, and snapshot hash. Builds on the P1 JSON export.
- [ ] **Per-language breakdown for localization reviews.** Tag cases by language; show results per language with native-speaker reviewers.

### S3. Conversation evaluation
- [ ] **S3a. Next-turn evaluation (recommended first).**
  - A case holds a fixed transcript; each configuration writes the next assistant turn, so both see identical history.
  - Changes: the case schema gains a `messages[]` list; a new message-template version; multi-message adapters; conversation display in review.
  - Budget, blinding, and scoring stay unchanged.
- [ ] **S3b. Whole-conversation evaluation.**
  - Multi-turn generation with a scripted or simulated user, so the input stays controlled.
  - Needs per-turn budget accounting and failure states, and larger output caps.
  - Needs a conversation rubric: coherence, memory, tone, task completion.
- [ ] **S3c. Blind review of existing transcripts.** Import conversations as evidence (no generation), with explicit provenance labels.

### S4. Imported evidence and baselines
- [ ] **Human baseline as a configuration.** Import human-written answers to compare against AI output. Uses the same imported-evidence source as S3c.
- [ ] **LLM-judge calibration.** Add an automated judge as a separate, clearly labeled reviewer class. Show agreement and disagreement with the human cohort before anyone relies on it (spec §16.3 item 5).

### Out of scope even as stretch goals
Large-scale statistical benchmarking, public leaderboards, fully automated scoring without human review, and any shared or platform-paid generation.
