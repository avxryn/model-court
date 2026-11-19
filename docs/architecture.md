# Architecture

```mermaid
flowchart LR
    B[Browser] -->|platform sign-in| A[DeepSpace auth worker]
    B -->|Bearer JWT + JSON| API["/api/v1 (Hono in app Worker)"]
    API --> D[(ModelCourtStore: SQLite Durable Object)]
    API -->|IDs-only notice| R[RecordRoom mc_notices]
    R -->|own rows only, WebSocket| B
    API -->|outbox → enqueueJob| Q[JobRoom]
    Q --> J[handleGenerationJob]
    J -->|claim / fenced commit| D
    J --> K[decrypt owner key → fixed adapter]
    K --> O[api.openai.com/v1/responses]
    K --> N[api.anthropic.com/v1/messages]
    C[CronRoom mc-maintenance, 1 min] --> D
    C --> Q
```

## Modules

| Path | Responsibility |
|---|---|
| `src/domain/*` | Pure, browser-safe rules: Zod contracts, limits, rubric and scoring, transitions, prompt template `qa-v1`, canonical hashing, snapshot/readiness, registry. No React, SDK, or I/O (lint-enforced). |
| `src/domain/scenario*.ts` | Spec 02 (D-67–D-71): scenario and party fingerprints and diffs (`scenario.ts`), the hearing comparison (`scenario-compare.ts`), and the scenario file parser (`scenario-file.ts`). Pure; nothing is stored: versions are recomputed from immutable snapshots. |
| `src/domain/kits/*` | Task kits (spec 03, D-75–D-79): the kit contract (`types.ts`), registry (`KITS`, `kitFor`, kit and field schemas), versioned text helpers, the pure check runner, per-party check counts (`summary.ts`), and one file per kit (`general-v1`, `summarization-v1`, `classification-v1`). Message templates live in `messages.ts` (`MESSAGE_TEMPLATES`, `buildKitRequest`). |
| `src/domain/extraction/*` | Structured extraction (spec 04, D-85–D-90): the portable JSON Schema subset and wire compiler (`schema.ts`), an interpreting validator (`validate.ts`; no Ajv, which needs `new Function`), comparison rules (`compare.ts`), canonical rendering for jurors (`render.ts`), starters, base64 chunking and PDF byte checks (`bytes.ts`), the start-dialog estimate. Kit `extraction-v1` is `src/domain/kits/extraction.ts`; template `extract-v1` is in `messages.ts`. |
| `src/domain/tools/*` | Tool calling with mock tools (spec 06, D-99): the question's tool task and its rules (`task.ts`), an interpreter for the arguments' JSON Schema subset (`json-schema.ts`; no Ajv), the pure, stateless mock answerer shared with the editor's "Try a call" (`mock.ts`), and the normalized trace with its juror allowlist (`trace.ts`). The kit is `src/domain/kits/tools.ts`; template `tools-v1` and `buildToolPrompt` are in `messages.ts`. |
| `src/domain/grounded/*` | Answers from supplied sources (spec 05, D-92): the citation parser (`citations.ts`, one hand-written pass), quote and refusal matching with an offset map back to the original (`match.ts`), source fingerprints, the grounding key in words and the reading-time hint (`sources.ts`); the kit is `src/domain/kits/grounded.ts`, the sources CSV `src/domain/source-import.ts`. The same parser drives the checks and the citation chips. |
| `src/server/api.ts` | `/api/v1` boundary: identity, origin check, rate limits, body caps, HTTP mapping. |
| `src/server/services/*` | Use cases: evaluations, credentials, runs (admission/retry/cancel/open review), generation (outbox/claim/commit/lease), reviews (invites/sessions/reveal), results (scoring/verdict), checks (automatic check rows, written in the batch that accepts a testimony and read only by results; D-76), maintenance (cron). |
| `src/server/services/documents.ts`, `extraction.ts` | Spec 04 (D-87, D-89): document blobs (content-addressed per owner, base64 chunks, byte quotas in the same guarded batch, swept on the cron when unreferenced), draft and hearing references, the job's read of a hearing's copy after the claim; juror projections of extraction answers, field flags and the record's Extraction section. |
| `src/server/services/sources.ts` | Spec 05 (D-93, D-94): `evaluation_sources` (draft) and `run_sources` (immutable hearing copy), the server-written `kitFields.sources` references, admission guarded on every source hash, and `verifiedPromptSources`, which recomputes each hash before generation sends or a check reads a source. |
| `src/server/services/tool-loop.ts`, `src/server/providers/tools.ts` | Spec 06 (D-100, D-101): the tool loop (one guarded claim, fence, lease and commit per step; the step outbox and its cron; step leases; the statements cancel, delete and revoke add) and the tool-loop request bodies and parsers of both providers, reached only through `toolAdapterFor`. |
| `src/server/db/*` | `ModelCourtStore` Durable Object + D1-compatible adapter, migrations, guarded-batch helper, budget/reservation statements, audit, rate buckets. |
| `src/server/providers/*` | Two fixed-endpoint BYOK transports (OpenAI Responses, Anthropic Messages), dispatched by the adapter version a snapshot records (D-48), plus shared transport rules (no redirects, byte ceiling, normalized outcomes, no retries). |
| `src/server/credential-crypto.ts` | AES-256-GCM seal/open with canonical AAD, plus HMAC. Web Crypto only. |
| `src/server/platform.ts` | Production wiring: `verifyJwt`, `enqueueJob`, RecordRoom notice writes, `fetch`. |
| `src/pages`, `src/components` | UI on shadcn/ui (`base-nova`, Base UI). Imports server modules for types only. PDFs are drawn by pdf.js (`src/lib/pdf.ts`, loaded lazily on PDF screens, eval and XFA off, annotations off) on a canvas, never in an iframe or the browser's viewer. |

## Trust boundaries and blinding

- Identity comes only from a verified platform JWT. Every route resolves the caller's role per evaluation (`src/server/access.ts`). Invisible, deleted, and missing resources all return the same 404.
- Pre-reveal reviewer payloads are built by explicit allowlists (`getReview`, `reviewerRunView`, reviewer `getEvaluation`). Generation and attempt IDs, configuration keys, and provider/model identity stay in the server-only `assignment_json`.
- Jobs and notices carry opaque IDs only. Client sockets cannot touch the JobRoom.
- Results exist only after reveal and use the cohort frozen in the reveal transaction (`reveal_cohort_json`).
- Re-hearing, comparing, copying and scenario files (spec 02) are judge-only routes and fields; a hearing's parties appear in the case's hearing list only once it is unsealed, and jurors' projections are unchanged. Every hearing of a case is compared side by side, never pooled; an anchor party (same fingerprint in every hearing) is the only bridge (`src/server/services/scenarios.ts`, `comparison.ts`).
- Automatic check results (`testimony_checks`, D-76) are read only through results and the export, after reveal, for every role including the judge; a source scan (`checks-isolation.test.ts`) keeps every other module from naming the table. Checks see testimony content, the question and the kit settings only, and never feed scores, the headline or the verdict.

- Extraction (spec 04): before unsealing a juror sees an answer only as the server's canonical rendering in the field list's order (never the provider's bytes) or the same neutral line when it isn't JSON, and the question's document, identical for every party; never the answer key, comparison rules, schema hash or a check. Document bytes never enter a job payload, log, audit row or notice. A document's response always downloads (`Content-Disposition: attachment`, a `sandbox` CSP), and a guest cookie reaches one more route, the GET of its own hearing's document.
- Tool use (spec 06): every party gets the same tools and, for each call it makes, the canned response chosen by a pure function of the frozen task and that call, so parties cannot affect each other. Jurors see the tools and each trace through an explicit allowlist (`jurorTrace`): Model Court's step and call numbers, canonical JSON arguments, the results, the final answer and how the loop ended; never provider call ids, finish reasons, reasoning, tokens, timing, which canned row answered, or check results. Provider-native replay data stays in `generation_steps.replay_json` until the attempt finishes, is never returned, exported or logged, and is dropped at the end.
- Answers from sources (spec 05): every party gets the same numbered sources in the judge's order under template `grounded-v1`; the sources are read by the job after the claim from the hearing's own copy and verified against the snapshot's hashes, and never travel in a job payload. Jurors see the sources (without the judge's origin notes) and the grounding key before unsealing, never a check result or a quote highlight; check results, origin notes and hashes appear only in results and the export after unsealing.

## State and durability

Run states: `generating → ready → reviewing → revealed → decided`; `canceled` from generating or ready.
Every transition is one guarded D1 batch that re-checks the mutable preconditions at commit time
(`src/server/db/sql.ts`). No provider call happens inside a batch.

Generation sequence:
1. **Admission:** snapshot, hash, pinned `run_credentials`, generations, reservations, and outbox commit atomically (one guarded batch).
2. **Dispatch:** best-effort `enqueueJob`; cron re-dispatches anything left pending.
3. **Claim:** a conditional `pending → running` with a fresh fencing token consumes the reservation.
4. **Call:** the job re-checks the credential, decrypts it, and calls the fixed endpoint under a 90-second deadline. Every provider request (generation, tool steps, the special master, Check key) goes through `allowlistedFetch` (`src/server/providers/endpoints.ts`, spec 07 §6.5, D-107): https only, the key's own provider's fixed origin from `PROVIDER_ORIGINS`, no userinfo or port, redirects refused; anything else is refused before any network I/O as a definite, unsent `PROVIDER_REJECTED_REQUEST`.
5. **Commit:** only if the fence, run state, deletion state, and credential are all still current.
6. **Lease:** after 120 seconds an attempt becomes `uncertain`, applied by cron and on owner reads.

No automatic paid retry exists. A manual retry is attempt 2 of 2.

Tool loop (spec 06, D-101): admission reserves one unit per planned call (each question's step cap,
`step_reservations`). Step 1 is the attempt's own `mc.generate` job; its claim creates the attempt
(`kind = 'tool_loop'`) and step 1. Each step is claimed with its own fence and 120-second lease, sent
outside any batch with the request rebuilt from the snapshot and the finished steps' replay data, and
committed only if its fence, the run, the case and the key are current. A commit with calls below the
cap answers them from the frozen canned responses (pure) and creates step k+1 and its `step_outbox`
row in the same batch; the next `mc.tool-step` job claims it. The final commit writes the trace,
the checks and the accepted generation, releases the unused units and drops every step's replay data.
A failure, an uncertain outcome or a pre-send key failure ends the loop and releases every later unit;
no step is ever sent twice, and a loop waiting between steps is never mistaken for an expired call.

## Budget

Call-count ceilings, not currency. `budget_buckets` hold per-user daily, global daily, and global
lifetime counters with `CHECK (allocated ≤ limit)`. Reservations are released exactly once and only
when the call was provably never sent (cancel or revoke before claim, deletion, pre-send credential failure).
Uncertain and consumed calls are never refunded.

## Why a relational store (ADR-01, revised by D-20)

Unique submissions, atomic reveal-versus-submit ordering, frozen snapshots, and quota reservations
need relational constraints and guarded multi-statement transactions. The spec chose managed D1; the
free DeepSpace tier refuses D1 bindings, so the same schema runs in an app-owned SQLite Durable Object
(`ModelCourtStore`). Each adapter call executes inside `transactionSync`, so a batch commits or rolls back
as a whole, and the object processes calls one at a time (single writer, like D1). Only the Worker holds
the binding. The integration suite runs against both D1 and the real Durable Object. RecordRoom still
carries only safe invalidation notices.
