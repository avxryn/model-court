# API (`/api/v1`)

All routes require `Authorization: Bearer <platform JWT>`. Requests and responses are JSON. Every
response carries `requestId` and `Cache-Control: private, no-store`. Unknown fields are rejected (422).

Guest jurors (D-41), no account: `POST /invites/redeem-as-guest` `{token, displayName}` and `POST /juror/resume` `{resume}` (same-origin only; rate-limited per IP) set the `__Host-mcj-<runId>` cookie and return `{runId}` (plus `resumeSecret` once, on join). The cookie authorizes only `GET /runs/:id`, `GET/PUT /runs/:id/review`, `POST /runs/:id/review/submit`, and `GET /runs/:id/results` for its own hearing. The owner run view adds `participants[].guest` (`{name, devices}`, owner only). All GETs are limited to 120 per minute per caller (D-42).

Special master (D-40), judge only, after unsealing: `GET /runs/:id/special-master` (jurors get 404); `POST /runs/:id/special-master` (Idempotency-Key; body `{modelKey, credentialIdsByProvider, consentToProviderProcessing: true, acknowledgeProviderCharges: true}`; 202 with `plannedCalls`; counts toward the generation rate limit); `POST /runs/:id/special-master/:graderRunId/cancel`.

Conversations (D-39): a case may carry `messages: [{role: "user"|"assistant", content}]`, the conversation so far. Review cases and results cases add `messages` (empty when none); the catalog adds `multiTurnVerifiedAt` per model.

Imported evidence (D-38): a configuration may be `{kind: "imported", key, label, provenance}`. `PUT /evaluations/:id/imports/:configurationKey` (If-Match; body `{items: [{caseKey, text}], confirmMayShareWithJurors: true}`) replaces that party's answers and returns the new revision; `DELETE` on the same path removes them. The owner evaluation view adds `imports`; the owner run view adds `imported`; results add `source`/`provenance` on imported parties and `status: "imported"` plus `sha256` on their responses.

Draft fields added in v2: optional `rubricVersion` (`reference-qa-v1` default, `safety-v1`, `writing-v1`) and an optional per-case `language` tag. Results add `cases[].language` and `byLanguage` (D-35, D-36).

Cost and speed (D-63), after reveal, every participant: results add `priceTable: {version, readOn, sources: {openai, anthropic}, predates}` and `setupMetrics: {<configurationKey>: {source, calls: {planned, succeeded, failed, uncertain, canceled, retries, errorCodes, providerCalls, medianPerAnswer}, latency: {medianMs, slowestMs, n}, tokens: {medianInput, medianOutput, totalInput, totalOutput, totalCachedInput, totalReasoning, unknownUsage}, cost: {status: "estimated"|"partial"|"no_price"|"imported", perAnswerMedianMicroUsd, perThousandMicroUsd, hearingMicroUsd, possiblyBilledUnknown, cachedAssumedFull}}}`. Amounts are integer micro-dollars (µUSD) estimated at list prices from the dated table for the hearing's creation day; `null` means unknown, never 0. Medians and latency use succeeded answers on eligible questions; totals count every call. Results responses add `cachedInputTokens` and `reasoningTokens` (D-64; `null` when not recorded, including every attempt before migration `0008`). `coverage` is unchanged. The JSON export adds `versions.priceTableVersion` and `setupMetrics: {priceTable, byConfiguration}`, both under `certification.contentSha256`; CSV is unchanged.

Repeats (D-65): the draft accepts optional `samplesPerAnswer` (2 or 3; absent = once; 422 when every party is imported, or above the deployment's `MAX_SAMPLES_PER_ANSWER`, re-checked at Start). The catalog adds `limits.samplesPerAnswer` (deployment max, 1–3) and `priceTable: {version, readOn, sources}` (the newest table). Start creates questions × generated parties × samples generations, so `plannedCalls` includes samples; sample *k* is first dispatched (*k* − 1) minutes after Start. The owner run view adds `samplesPerAnswer` and `generations[].sampleNo`; `counts.planned` counts every sample. `POST /runs/:id/retries` accepts up to 45 `generationIds`, one per sample. A question is eligible when every generated party has at least one succeeded sample; jurors get the **primary** sample (lowest-numbered success) and nothing else, so the reviewer run view and the review DTO are unchanged (same shape at 1 and 3 samples, tested). Results add `samplesPerAnswer`, `cases[].responses[].sampleNo` (the primary) and, when `samplesPerAnswer > 1`, `cases[].responses[].samples[]` (`sampleNo, primary, status, errorCode, attemptCount, text, truncated, inputTokens, outputTokens, cachedInputTokens, reasoningTokens, durationMs`); `coverage` and `setupMetrics` count every sample, and with repeats each generated party's `setupMetrics` entry has `consistency: {compared, sameAnswer, medianOverlap, answeredEveryTime, planned, medianLengthSpread, latencySpread, questions: [{caseKey, n, same, overlap, lengthSpread, answeredEveryTime}]}` (D-66; `null` without repeats and for imported parties). The JSON export adds `run.samplesPerAnswer` (only with repeats) and carries `samples` on each response.

Scenario versions (D-68), owner branch of `GET /evaluations/:id` only: adds `draftScenarioHash` (64 hex, `scenario-v1`), `draftScenarioVersion` (the version the saved draft's questions match, or `null`), `nextScenarioVersion`, and `draftDiff` (`{added, removed: [{key, title}], edited: [{fromKey, toKey, title}], rubricChanged, templateChanged, kitChanged}` against the newest hearing when the draft matches no hearing, else `null`). Each `runs[]` entry adds `scenarioHash`, `scenarioVersion` (1-based, by first appearance, display only), `number` (1-based position in the case, oldest first), `partyCount`, and, **only while that hearing is `revealed` or `decided`**, `parties: [{key, label, fingerprint, source: "model"|"imported", provider, modelId}]` and `changes` (versus the previous unsealed hearing of the same version: `added`, `removed`, `model` with `from`/`to`, `prompt`, `source`, `provenance`, `answers`); before that both are `null`. Nothing is stored: every value is recomputed from the immutable snapshots. The reviewer branch is unchanged.

Terminology: the UI calls the `owner` the **judge** and `invited` reviewers **jurors**. Field names, enum values, and error codes keep the original terms; only display strings (session labels such as `Juror 1`, and messages) use the new ones.

- Success: `{"data": …, "requestId": "req_…"}`
- Error: `{"error": {"code", "message", "retryable", "fields?", "details?"}, "requestId"}`
- `Idempotency-Key: <uuid>` is **required** for: start run, retry, invite, submit review, file and unseal, reveal, verdict, save credential. The same key and payload replay the original response; the same key with a different payload returns `409 IDEMPOTENCY_CONFLICT`.
- `If-Match: "<revision>"` is **required** (428 if missing) for: draft save, delete evaluation, retry, cancel, open review, rating save/submit, file and unseal, reveal, verdict, replace/remove credential.
- Body caps: 128 KiB (413); credential requests 16 KiB.

| Method & path | Who | Notes |
|---|---|---|
| GET `/healthz` (no `/api/v1`) | public | `{build, ready, storeOk, generationEnabled}` |
| GET `/catalog` | signed in | Model routes with `enabled` (verified) flag, limits (including `samplesPerAnswer`), price table, generation switch |
| GET/POST `/credentials`, DELETE `/credentials/:id` | own | Metadata only; POST `{provider,label,apiKey,consentToStorage:true,replacesCredentialId?}`. Admin keys are refused (422) |
| POST `/credentials/:id/renew` | own | If-Match, empty body. Resets `expiresAt` to now + `CREDENTIAL_TTL_DAYS`; 409 once expired or removed |
| GET/POST `/evaluations` | own/joined | Cursor pagination `?cursor&limit≤50`; POST seeds the example draft |
| GET `/evaluations/:id` | owner / joined reviewer | Owner: draft + runs; reviewer: title + joined runs |
| PUT `/evaluations/:id/draft` | owner | `{comparisonMode,cases,configurations,rubricVersion?,samplesPerAnswer?}` full replacement |
| POST `/evaluations/:id/draft/restore` | owner (jurors and strangers 404) | If-Match. `{fromRunId, questions: boolean, parties: boolean}` (at least one true). Copies that hearing's frozen questions and rubric and/or its parties, comparison mode and repeats into the draft; imported parties get their exact frozen answers back. 404 for a hearing of another case; 422 when the result is not a valid draft for this deployment. → `{revision, draft, imports}`. No provider call, no budget (D-69) |
| DELETE `/evaluations/:id` | owner | `{confirmTitle}` → 202 tombstone |
| POST `/evaluations/:id/runs` | owner | `{draftRevision,credentialIdsByProvider,consentToProviderProcessing:true,acknowledgeProviderCharges:true,expectedScenarioHash?}` → 202 `{runId,status,revision,plannedCalls,scenarioHash}`. A different `expectedScenarioHash` → 409 `STATE_CONFLICT` `details: {scenarioChanged: true, scenarioHash}` before anything is written; the 21st hearing of a case → 429 `QUOTA_EXHAUSTED` (D-69) |
| GET `/runs/:id` | owner / reviewer | Role-specific projection; owner read reconciles expired leases |
| POST `/runs/:id/retries` | owner | `{generationIds (≤ 45, one per sample),acknowledgePossiblePriorCharge:true}` → 202 |
| POST `/runs/:id/cancel` | owner | `{reason?}` |
| POST `/runs/:id/open-review` | owner | `{acknowledgeExcludedCases}`. Needed only when some answer failed: once every planned answer is in, review opens by itself (audit `review.open` with no actor and `automatic: true`) |
| POST `/runs/:id/invites`, DELETE `/runs/:id/invites/:inviteId` | owner | One-time URL `…/join#token=…`; replay returns `{url:null, requiresReissue:true}` |
| POST `/invites/redeem` | signed in | `{token}`; all invalid tokens → identical 409 `INVITE_UNAVAILABLE` |
| GET/PUT `/runs/:id/review`, POST `/runs/:id/review/submit` | own session | Anonymous DTO; drafts partial; submit needs complete ratings |
| DELETE `/runs/:id/reviewers/:sessionId` | owner | Unsubmitted invited sessions only |
| POST `/runs/:id/reveal` | owner | `{acknowledgePendingCount}` must equal current pending count |
| POST `/runs/:id/review/file-and-unseal` | owner, no jury | `{}`; If-Match is the judge's session revision. Files the judge's complete worksheet and reveals in one commit. 409 `STATE_CONFLICT` with `details.juryPresent` while any juror holds a seat or an unused summons is out |
| GET `/runs/:id/results` | participant, after reveal | Mapping, cohorts, coverage, cost and speed (`priceTable`, `setupMetrics`), evidence, verdicts |
| GET `/runs/:id/export?format=json\|csv` | owner, after reveal | Certified record (cases, responses, ratings by juror label, findings, verdicts, versions, `certification.contentSha256`); CSV is one row per rating with formula-neutralized cells. No keys, credential/session/response IDs, invite tokens, or user IDs |
| POST `/runs/:id/verdicts` | owner, after reveal | `{outcome,selectedConfigurationKey?,rationale,limitations}` → appended revision |

Error codes: `UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, REVISION_CONFLICT, STATE_CONFLICT,
IDEMPOTENCY_CONFLICT, INCOMPLETE_REVIEW, INVITE_UNAVAILABLE, ACTIVE_RUN_EXISTS, PAYLOAD_TOO_LARGE,
VALIDATION_FAILED, UNSUPPORTED_CONFIGURATION, CREDENTIAL_MISSING, REVISION_REQUIRED, QUOTA_EXHAUSTED,
RATE_LIMITED, GENERATION_DISABLED, CREDENTIAL_WRITES_DISABLED, INTERNAL`.

Generation outcome codes (owner-only): see `ERROR_TEXT` in `src/components/common.tsx`.
