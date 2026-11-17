# API (`/api/v1`)

All routes require `Authorization: Bearer <platform JWT>`. Requests and responses are JSON. Every
response carries `requestId` and `Cache-Control: private, no-store`. Unknown fields are rejected (422).

- Success: `{"data": …, "requestId": "req_…"}`
- Error: `{"error": {"code", "message", "retryable", "fields?", "details?"}, "requestId"}`
- `Idempotency-Key: <uuid>` is **required** for: start run, retry, invite, submit review, reveal, verdict, save credential. The same key and payload replay the original response; the same key with a different payload returns `409 IDEMPOTENCY_CONFLICT`.
- `If-Match: "<revision>"` is **required** (428 if missing) for: draft save, delete evaluation, retry, cancel, open review, rating save/submit, reveal, verdict, replace/remove credential.
- Body caps: 128 KiB (413); credential requests 16 KiB.

| Method & path | Who | Notes |
|---|---|---|
| GET `/healthz` (no `/api/v1`) | public | `{build, ready, generationEnabled}` |
| GET `/catalog` | signed in | Model routes with `enabled` (verified) flag, limits, generation switch |
| GET/POST `/credentials`, DELETE `/credentials/:id` | own | Metadata only; POST `{provider,label,apiKey,consentToStorage:true,replacesCredentialId?}` |
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
| POST `/runs/:id/verdicts` | owner, after reveal | `{outcome,selectedConfigurationKey?,rationale,limitations}` → appended revision |

Error codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, REVISION_CONFLICT, STATE_CONFLICT,
IDEMPOTENCY_CONFLICT, INCOMPLETE_REVIEW, INVITE_UNAVAILABLE, ACTIVE_RUN_EXISTS, PAYLOAD_TOO_LARGE,
VALIDATION_FAILED, UNSUPPORTED_CONFIGURATION, CREDENTIAL_MISSING, REVISION_REQUIRED, QUOTA_EXHAUSTED,
RATE_LIMITED, GENERATION_DISABLED, CREDENTIAL_WRITES_DISABLED, INTERNAL`.

Generation outcome codes (owner-only): see `ERROR_TEXT` in `src/components/common.tsx`.
