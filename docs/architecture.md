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
| `src/server/api.ts` | `/api/v1` boundary: identity, origin check, rate limits, body caps, HTTP mapping. |
| `src/server/services/*` | Use cases: evaluations, credentials, runs (admission/retry/cancel/open review), generation (outbox/claim/commit/lease), reviews (invites/sessions/reveal), results (scoring/verdict), maintenance (cron). |
| `src/server/db/*` | `ModelCourtStore` Durable Object + D1-compatible adapter, migrations, guarded-batch helper, budget/reservation statements, audit, rate buckets. |
| `src/server/providers/*` | Two fixed-endpoint BYOK transports (OpenAI Responses, Anthropic Messages), dispatched by the adapter version a snapshot records (D-48), plus shared transport rules (no redirects, byte ceiling, normalized outcomes, no retries). |
| `src/server/credential-crypto.ts` | AES-256-GCM seal/open with canonical AAD, plus HMAC. Web Crypto only. |
| `src/server/platform.ts` | Production wiring: `verifyJwt`, `enqueueJob`, RecordRoom notice writes, `fetch`. |
| `src/pages`, `src/components` | UI on shadcn/ui (`base-nova`, Base UI). Imports server modules for types only. |

## Trust boundaries and blinding

- Identity comes only from a verified platform JWT. Every route resolves the caller's role per evaluation (`src/server/access.ts`). Invisible, deleted, and missing resources all return the same 404.
- Pre-reveal reviewer payloads are built by explicit allowlists (`getReview`, `reviewerRunView`, reviewer `getEvaluation`). Generation and attempt IDs, configuration keys, and provider/model identity stay in the server-only `assignment_json`.
- Jobs and notices carry opaque IDs only. Client sockets cannot touch the JobRoom.
- Results exist only after reveal and use the cohort frozen in the reveal transaction (`reveal_cohort_json`).
- Re-hearing, comparing, copying and scenario files (spec 02) are judge-only routes and fields; a hearing's parties appear in the case's hearing list only once it is unsealed, and jurors' projections are unchanged. Every hearing of a case is compared side by side, never pooled; an anchor party (same fingerprint in every hearing) is the only bridge (`src/server/services/scenarios.ts`, `comparison.ts`).

## State and durability

Run states: `generating → ready → reviewing → revealed → decided`; `canceled` from generating or ready.
Every transition is one guarded D1 batch that re-checks the mutable preconditions at commit time
(`src/server/db/sql.ts`). No provider call happens inside a batch.

Generation sequence:
1. **Admission:** snapshot, hash, pinned `run_credentials`, generations, reservations, and outbox commit atomically (one guarded batch).
2. **Dispatch:** best-effort `enqueueJob`; cron re-dispatches anything left pending.
3. **Claim:** a conditional `pending → running` with a fresh fencing token consumes the reservation.
4. **Call:** the job re-checks the credential, decrypts it, and calls the fixed endpoint under a 90-second deadline.
5. **Commit:** only if the fence, run state, deletion state, and credential are all still current.
6. **Lease:** after 120 seconds an attempt becomes `uncertain`, applied by cron and on owner reads.

No automatic paid retry exists. A manual retry is attempt 2 of 2.

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
