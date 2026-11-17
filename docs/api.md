# API (`/api/v1`)

All routes require `Authorization: Bearer <platform JWT>`. Requests and responses are JSON. Every
response carries `requestId` and `Cache-Control: private, no-store`. Unknown fields are rejected (422).

Conversations (D-39): a case may carry `messages: [{role: "user"|"assistant", content}]`, the conversation so far. Review cases and results cases add `messages` (empty when none); the catalog adds `multiTurnVerifiedAt` per model.

Imported evidence (D-38): a configuration may be `{kind: "imported", key, label, provenance}`. `PUT /evaluations/:id/imports/:configurationKey` (If-Match; body `{items: [{caseKey, text}], confirmMayShareWithJurors: true}`) replaces that party's answers and returns the new revision; `DELETE` on the same path removes them. The owner evaluation view adds `imports`; the owner run view adds `imported`; results add `source`/`provenance` on imported parties and `status: "imported"` plus `sha256` on their responses.

Draft fields added in v2: optional `rubricVersion` (`reference-qa-v1` default, `safety-v1`, `writing-v1`) and an optional per-case `language` tag. Results add `cases[].language` and `byLanguage` (D-35, D-36).

Terminology: the UI calls the `owner` the **judge** and `invited` reviewers **jurors**. Field names, enum values, and error codes keep the original terms; only display strings (session labels such as `Juror 1`, and messages) use the new ones.

- Success: `{"data": …, "requestId": "req_…"}`
- Error: `{"error": {"code", "message", "retryable", "fields?", "details?"}, "requestId"}`
- `Idempotency-Key: <uuid>` is **required** for: start run, retry, invite, submit review, reveal, verdict, save credential. The same key and payload replay the original response; the same key with a different payload returns `409 IDEMPOTENCY_CONFLICT`.
- `If-Match: "<revision>"` is **required** (428 if missing) for: draft save, delete evaluation, retry, cancel, open review, rating save/submit, reveal, verdict, replace/remove credential.
- Body caps: 128 KiB (413); credential requests 16 KiB.

| Method & path | Who | Notes |
|---|---|---|
| GET `/healthz` (no `/api/v1`) | public | `{build, ready, storeOk, generationEnabled}` |
| GET `/catalog` | signed in | Model routes with `enabled` (verified) flag, limits, generation switch |
| GET/POST `/credentials`, DELETE `/credentials/:id` | own | Metadata only; POST `{provider,label,apiKey,consentToStorage:true,replacesCredentialId?}`. Admin keys are refused (422) |
| POST `/credentials/:id/renew` | own | If-Match, empty body. Resets `expiresAt` to now + `CREDENTIAL_TTL_DAYS`; 409 once expired or removed |
| GET/POST `/evaluations` | own/joined | Cursor pagination `?cursor&limit≤50`; POST seeds the example draft |
| GET `/evaluations/:id` | owner / joined reviewer | Owner: draft + runs; reviewer: title + joined runs |
| PUT `/evaluations/:id/draft` | owner | `{comparisonMode,cases,configurations}` full replacement |
| DELETE `/evaluations/:id` | owner | `{confirmTitle}` → 202 tombstone |
| POST `/evaluations/:id/runs` | owner | `{draftRevision,credentialIdsByProvider,consentToProviderProcessing:true,acknowledgeProviderCharges:true}` → 202 |
| GET `/runs/:id` | owner / reviewer | Role-specific projection; owner read reconciles expired leases |
| POST `/runs/:id/retries` | owner | `{generationIds,acknowledgePossiblePriorCharge:true}` → 202 |
| POST `/runs/:id/cancel` | owner | `{reason?}` |
| POST `/runs/:id/open-review` | owner | `{acknowledgeExcludedCases}` |
| POST `/runs/:id/invites`, DELETE `/runs/:id/invites/:inviteId` | owner | One-time URL `…/join#token=…`; replay returns `{url:null, requiresReissue:true}` |
| POST `/invites/redeem` | signed in | `{token}`; all invalid tokens → identical 409 `INVITE_UNAVAILABLE` |
| GET/PUT `/runs/:id/review`, POST `/runs/:id/review/submit` | own session | Anonymous DTO; drafts partial; submit needs complete ratings |
| DELETE `/runs/:id/reviewers/:sessionId` | owner | Unsubmitted invited sessions only |
| POST `/runs/:id/reveal` | owner | `{acknowledgePendingCount}` must equal current pending count |
| GET `/runs/:id/results` | participant, after reveal | Mapping, cohorts, coverage, evidence, verdicts |
| GET `/runs/:id/export?format=json\|csv` | owner, after reveal | Certified record (cases, responses, ratings by juror label, findings, verdicts, versions, `certification.contentSha256`); CSV is one row per rating with formula-neutralized cells. No keys, credential/session/response IDs, invite tokens, or user IDs |
| POST `/runs/:id/verdicts` | owner, after reveal | `{outcome,selectedConfigurationKey?,rationale,limitations}` → appended revision |

Error codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, REVISION_CONFLICT, STATE_CONFLICT,
IDEMPOTENCY_CONFLICT, INCOMPLETE_REVIEW, INVITE_UNAVAILABLE, ACTIVE_RUN_EXISTS, PAYLOAD_TOO_LARGE,
VALIDATION_FAILED, UNSUPPORTED_CONFIGURATION, CREDENTIAL_MISSING, REVISION_REQUIRED, QUOTA_EXHAUSTED,
RATE_LIMITED, GENERATION_DISABLED, CREDENTIAL_WRITES_DISABLED, INTERNAL`.

Generation outcome codes (owner-only): see `ERROR_TEXT` in `src/components/common.tsx`.
