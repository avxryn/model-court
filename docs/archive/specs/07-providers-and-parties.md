# Spec 07: More providers and more parties

**Delivered** Nov 19, 2026: built on `claude/roadmap-1-3` and deployed to the live app (build `fbe5c5c`); decisions D-106–D-112 in `docs/decisions.md`. Open questions were answered with this spec's proposed defaults, for Avery to confirm. The status line below is the spec as first written.

Status: draft, Nov 18, 2026. Research only. No code, no paid calls. Roadmap item 7 (`docs/roadmap.md`).
Read with `docs/provider-contracts.md`, `docs/architecture.md` and `docs/archive/specs/02-scenarios.md` (its
"compare through an anchor" is the other half of the "more parties" answer).

Summary of the recommendations:

| Part | Recommendation |
|---|---|
| A. Google Gemini | **Do it.** A third fixed-endpoint BYOK provider `google` on the Gemini API's stateless `generateContent` endpoint, `store: false` on every request, 8 routes plus one optional, all unverified until Avery's live check. Needs a table-rebuild migration, because four tables have `CHECK (provider IN ('openai','anthropic'))`. |
| B. OpenAI-compatible route | **No arbitrary base URL, now or later.** A fixed-host OpenRouter provider would be acceptable but is deferred: it mainly adds open-weight models, and it brings routing and data-collection settings that have to be pinned to keep a party one fixed setup. Avery decides whether to schedule it (Q6). |
| C. More than three parties | **Up to 5 parties, but no more than 15 testimonies per hearing** (parties × questions), so juror workload, call count and the daily cap stay where they are today. Everyone still scores every testimony (no incomplete designs). Labels go to A–E. The review worksheet gets a one-at-a-time view for 4–5 parties. To compare more setups than that, use spec 02's re-hearing and anchor comparison. |

---

## 1. Problem and who it is for

**Judges** (product leads, prompt engineers, small teams) choosing a setup for their own use case. Today
they can compare OpenAI and Anthropic models only, at most three parties at a time.

- **Gemini is missing.** It is the third model family teams most often evaluate. They cannot put it
  next to the other two without leaving the app.
- **Open-weight and self-hosted models are missing.** Teams ask "is Llama or Qwen good enough for
  this?" There is no safe way to call an endpoint the judge names (part B explains why).
- **Three parties is tight.** A typical question is "the current setup, the same prompt on two other
  models, and a revised prompt on the best one." That is four parties. Today the judge has to split it
  across hearings and compare indirectly.

**Jurors** do the extra work when parties are added. They see every testimony for every question side by
side, so their workload grows with parties × questions. Part C has to protect them.

**The operator (Avery)** carries the outbound risk. Every new provider is a new host the Worker sends
judges' keys and content to.

## 2. Scope and non-goals

In scope:

1. Provider `google` (Gemini API, Google AI Studio keys): adapter versions, registry routes, Check key,
   credential storage, an explicit outbound host allowlist, error mapping, privacy and consent copy, and
   the smoke script.
2. A risk analysis of OpenAI-compatible endpoints, with a recommendation (part B, §8.4).
3. Up to 5 parties per hearing under a 15-testimony budget: limits, contracts, blind labels, the review
   worksheet, the record (findings, headline, testimony), budget caps and the special master.

Non-goals:

- **Vertex AI** (Google Cloud's Gemini endpoint). It needs OAuth or service-account credentials, not an
  API key, and a per-project regional host. Not BYOK in this app's sense.
- **Google's Interactions API** (`POST /v1beta/interactions`). Google now recommends it for new
  projects, but it stores requests by default and keeps conversation state on the server (§7.1).
- **Any judge-typed base URL** (part B).
- **Incomplete-block review** (each juror scores only some parties). It complicates reliability and
  headline maths for little gain at this app's scale of 1–3 jurors (§9.3).
- **More than 5 questions or more than 3 invited jurors.** Unchanged.
- Gemini-specific features: Google Search grounding, tools, files, caching, safety-setting overrides.
  No tools are ever sent, so grounding's 30-day storage never applies.
- Price tables and cost estimates. Spec 01 owns them; this spec lists what it needs from 01 (§10.3).

## 3. User flow

### 3.1 Saving a Gemini key (Settings → API keys)

`/settings/api-keys` (`src/pages/(app)/(protected)/settings/api-keys.tsx`) shows a third
`ProviderKeyCard` for **Google (Gemini API)**, after OpenAI and Anthropic. It works like the other two,
with three differences in its copy (final wording in §8.6):

1. "Create the key in Google AI Studio and restrict it to the Gemini API. Use a project only for Model
   Court, with billing alerts set."
2. "If the key's project is on Google's free tier, Google may use the questions and answers to improve
   its products, and people at Google may read them. Use a paid-tier project for anything private."
3. "Model Court asks Google not to keep these requests in your project's logs. Google still keeps them
   for a limited time to detect abuse."

Saving with "Check key" on (the default, D-59) makes one free list-models request with the key and
shows Valid, Invalid, Restricted or Unreachable. Pasting an OpenAI or Anthropic key into the Google card,
or a Google key into the others, is refused before anything is sent (§8.2).

### 3.2 Choosing a Gemini party (draft editor)

The party picker (`DraftEditor.tsx`, shadcn `Select` groups by provider, D-48) gets a **Google** group.
Each route shows the same facts panel as the others: context window, provider output limit, and
"Always reasons: billed as output, up to 8,704 output tokens" for every Gemini route except 2.5 Flash-Lite.
Until Avery's live check records a call, every Gemini route is marked "awaiting its live check". A draft
may choose it, and Start refuses it (F04, `src/domain/snapshot.ts`).

### 3.3 Starting a hearing with Gemini

The Start dialog already asks for one key per provider the draft needs (`credentialIdsByProvider`,
`requiredProviders` in `snapshot.ts`), and the consent checkbox lists the providers. With a Google party
the consent text adds one line: "Google: if your key's project is on the free tier, Google may use this
content to improve its products." No other step changes.

### 3.4 Four or five parties

The draft editor's "Add party" stays enabled up to the deployment's party cap (`MAX_CONFIGURATIONS_PER_RUN`,
§10.1). When parties × questions would pass 15, the editor says so before Start, in plain words: "5 parties
× 4 questions is 20 answers for each juror to score. The limit is 15: remove a question or a party."

The Start dialog adds the juror workload next to the call count: "Each juror will score 15 answers
(5 parties on 3 questions)."

Review (§9.2): with 4–5 parties the worksheet shows one testimony at a time, with tabs A–E that show which
ones are scored, plus "Compare two" for reading two testimonies side by side.

The record (§9.4): the tables get one column per party. The headline names the leader and the runner-up
instead of listing everyone.

### 3.5 Comparing more setups than fit in one hearing

The case page's "Re-hear with different parties" and "Compare" (spec 02 §3.2–3.3) cover this. Example:
hearing 1 has A–E on questions 1–3, then hearing 2 re-hears C (the anchor) against F and G on the same
questions. This spec adds no new cross-hearing feature; it points judges there from the cap message
("To compare more setups, re-hear this case with an anchor party").

## 4. Data model and migrations (`src/server/db/migrations.ts`)

### 4.1 Why Gemini needs a table rebuild

Four tables pin the provider with a column CHECK, and SQLite cannot change a CHECK in place:

| Table (migration) | Column | FKs into it | FKs out of it |
|---|---|---|---|
| `generations` (0001) | `provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic'))` | `generation_attempts`, `outbox`, `attempt_reservations` (all `ON DELETE CASCADE`) | `runs` |
| `provider_credentials` (0001, +0002, +0006 columns) | same | `run_credentials` (`ON DELETE RESTRICT`) | — |
| `run_credentials` (0001, trigger rewritten in 0006) | same | — | `runs`, `provider_credentials` |
| `grader_credentials` (0004) | same | — | `grader_runs` |

The rebuild has two traps on both stores, because both enforce foreign keys and run every migration
inside one transaction (D1 `batch`, Durable Object `transactionSync`):

1. `PRAGMA foreign_keys = OFF` has no effect inside a transaction.
2. `DROP TABLE parent` runs an implicit `DELETE FROM parent` first, and that **fires `ON DELETE CASCADE`
   on child tables**. Dropping the old `generations` while any table still references the name
   `generations` would delete every attempt, outbox row and reservation.

Also, `ALTER TABLE … RENAME` (modern semantics) rewrites FK references in child tables and re-parses
every trigger. It fails if any trigger body names a table that no longer exists.

### 4.2 Migration `0007_google_provider` (or the next free id when it lands)

The order below never drops a table while anything references its name.

```
-- provider value set for every rebuilt table
P := provider IN ('openai','anthropic','google')

-- 1. generations subtree
CREATE TABLE generations_new (... same columns ..., provider TEXT NOT NULL CHECK (P), ...)
INSERT INTO generations_new SELECT <explicit column list> FROM generations
CREATE TABLE generation_attempts_new (... generation_id TEXT NOT NULL REFERENCES generations_new(id) ON DELETE CASCADE ...)
CREATE TABLE outbox_new (... REFERENCES generations_new(id) ON DELETE CASCADE ...)
CREATE TABLE attempt_reservations_new (... REFERENCES generations_new(id) ON DELETE CASCADE ...)
INSERT … SELECT … for each of the three
DROP TABLE generation_attempts; DROP TABLE outbox; DROP TABLE attempt_reservations   -- leaves; no cascades
DROP TABLE generations            -- nothing references the name "generations" now
ALTER TABLE generations_new RENAME TO generations      -- children's FKs are rewritten to "generations"
ALTER TABLE generation_attempts_new RENAME TO generation_attempts   (same for outbox, attempt_reservations)
re-create: generations_by_run_status, attempts_by_status_deadline, outbox_by_status,
           generations_accepted_attempt_id_immutable, generation_attempts_output_text_status_finish_reason_immutable

-- 2. credentials subtree
CREATE TABLE provider_credentials_new (... all 0001+0002+0006 columns, CHECK (P), the active/revoked CHECK ...)
CREATE TABLE run_credentials_new (... credential_id REFERENCES provider_credentials_new(id) ON DELETE RESTRICT ...)
copy both; DROP TABLE run_credentials (its trigger goes with it); DROP TABLE provider_credentials
rename both; re-create one_active_credential_per_provider, provider_credentials_by_expiry,
           provider_credentials_status_immutable, provider_credentials_owner_user_id_provider_immutable,
           run_credentials_immutable (the 0006 body, verbatim)

-- 3. grader_credentials (a leaf): new, copy, drop, rename, re-create grader_credentials_immutable
```

Rules for writing it:

- Generate the `CREATE TABLE … _new` bodies from the *effective* schema (0001 columns plus every later
  `ADD COLUMN`, in the same order), with `INSERT … SELECT` naming every column. A unit test compares
  `PRAGMA table_info` before and after for every rebuilt table (§11.2).
- Copy the trigger bodies verbatim from 0001/0004/0006 (the `immutable()` helper produces the same
  names). The test lists `sqlite_master` triggers and indexes before and after and requires equal sets.
- Check that no trigger *on another table* names a rebuilt table in its body. Today only
  `run_credentials_immutable` names `provider_credentials`, and it is rebuilt with its table. The
  migration test fails if a later migration adds such a trigger.
- No `PRAGMA` is needed if the order above is followed. If a store rejects an intermediate state, the
  fallback is `PRAGMA defer_foreign_keys = ON` as the first statement. Step 1 of delivery must show
  which is true on both stores (`vitest.integration.config.ts` for D1,
  `vitest.integration.store.config.ts` for the Durable Object).
- Volume is tiny (5 questions × 3 parties × 2 attempts per hearing), so the copy is cheap. The
  Durable Object runs migrations in `blockConcurrencyWhile` before serving a call, so no request sees
  a half-migrated schema.
- The migration deliberately also allows `'google'` in tables Gemini does not use yet
  (`grader_credentials`), so the special master can use Gemini routes too.

**Do it once.** Part B's possible later `openrouter` provider would need the same rebuild. Since this
migration already pays that cost, it should replace the column CHECKs with something extensible. Two
options:

- **(a) Recommended.** Keep column CHECKs but list `'openai','anthropic','google','openrouter'` now.
  `'openrouter'` stays unusable because `PROVIDERS` in the domain does not include it, and the server
  validates every provider against `PROVIDERS` before writing.
- **(b)** Move the check into `BEFORE INSERT` triggers against a `providers(id)` lookup table, so
  later providers are one `INSERT`. This adds trigger surface for no current need.

Avery to decide (Q7). Option (a) costs nothing and avoids a second rebuild if OpenRouter is ever approved.

### 4.3 Nothing else changes in storage

- **Credential encryption is provider-agnostic.** `sealCredential` binds the ciphertext to
  `{app, credentialId, keyVersion, owner, provider, schema}` (`src/server/credential-crypto.ts`), so
  `'google'` is just another provider string. AES-256-GCM, the 12-byte random nonce and `keyVersion`
  rotation are unchanged. The one-active-key-per-provider index already allows one Google key per judge.
- `run_credentials` is keyed by `(run_id, provider)`, so a hearing with three providers pins three keys.
  Revoking one fences only its provider's work (`revokeCredentialStatements`).
- **Parties (part C) need no schema change.** Party count lives in `snapshot_json` and `assignment_json`,
  and no column constrains it.
- **Backups** (`src/server/services/backup.ts`) copy rows per table. A test must confirm that a backup
  taken before the migration restores into a migrated store, and that `provider_credentials` is still
  exported revoked with no ciphertext.

## 5. API changes (`/api/v1`, additive; D-24)

- **Provider enum.** `providerSchema = z.enum(PROVIDERS)` gains `'google'`. That flows into
  `createCredentialSchema`, `startRunSchema.credentialIdsByProvider`,
  `startSpecialMasterSchema.credentialIdsByProvider` and `retrySchema.credentialIdsByProvider`, with no
  shape change. `src/lib/dto.ts` replaces its two hard-coded `'openai' | 'anthropic'` unions (lines 33
  and 51) with `ProviderId`.
- **`GET /catalog`**: `providers` gains `{id: 'google', name: 'Google'}`. Routes gain the Gemini rows
  (§6.2). `limits` gains `maxTestimoniesPerHearing` and `configurations` reports the deployment cap as now.
- **`POST /credentials`**: accepts `provider: 'google'`. Returns a new 422 when the key is for another
  provider (§8.2):
  `{code: 'KEY_PROVIDER_MISMATCH', message: 'This looks like an OpenAI key. Paste it on the OpenAI card.'}`.
- **`POST /credentials/:id/check`** (D-59): unchanged shape. Google results use the same four values and
  reason codes.
- **Drafts and runs (part C)**: `draftInputSchema.configurations.max` becomes
  `LIMITS.maxConfigurationsPerRun` (5). A new refine adds: "parties × questions ≤
  `LIMITS.maxTestimoniesPerHearing` (15)", error path `configurations`. The server still applies the
  deployment cap (`config.maxConfigurationsPerRun`, `evaluations.ts:201`) and returns the existing 422
  when it is lower. `retrySchema.generationIds.max` and `saveRatingsSchema.ratings.max` change from
  `maxCases * maxConfigurationsPerRun` to `maxTestimoniesPerHearing`, so the limits do not jump to 25.
- **Review payloads**: `label` widens from `'A' | 'B' | 'C'` to `BlindLabel = 'A' | 'B' | 'C' | 'D' | 'E'`
  (`AssignmentCase` in `runs.ts:631`, the reviewer projection in `reviews.ts:184`). Old sessions only hold
  A–C, which are still valid.
- `docs/api.md`: one line each for the provider value, `KEY_PROVIDER_MISMATCH` and the testimony limit.

## 6. Provider adapter changes

### 6.1 The Gemini endpoint and why it was chosen

Read from Google's docs on Nov 18, 2026. They have moved from ai.google.dev to aistudio.google.com; the old
URLs redirect there.

- Host `https://generativelanguage.googleapis.com`; generation `POST /v1beta/models/{model}:generateContent`;
  model list `GET /v1beta/models`. Auth is the header `x-goog-api-key: <key>`. The docs' REST examples use
  the header, and older pages show a `?key=` query parameter. **The key never goes in the URL**, because
  URLs end up in logs and traces.
- Google now labels `generateContent` "legacy" and recommends the Interactions API for new projects. It
  also says existing integrations "remain supported" and gives no shutdown date. This spec still picks
  `generateContent`:
  - It is stateless, so the whole conversation is sent each time. That matches the D-39 adapter shape.
  - It returns one candidate, so it maps onto `ProviderOutcome` like the other two providers.
  - Interactions stores every request by default (`store` defaults to true; 55 days on the paid tier,
    1 day on free) and builds conversation state on the server.

  Adapter versions are additive, so a later `google-interactions-v1` can replace it without touching
  recorded hearings (Q3).
- `v1beta`, not `v1`. Every current docs example, `thinkingConfig.thinkingLevel` and the `store` field
  are documented on `v1beta`. The live check confirms the body is accepted.
- **Request logging.** From Oct 26, 2026, *new* Google projects log `generateContent` requests by default,
  for 55 days, visible on the project's AI Studio Logs page. Older projects keep logging off unless it was
  turned on. A request-level `store` overrides the project setting. Over REST it is a top-level boolean.
  A third-party live test reports that `"store": false` returns 200 and a non-boolean value returns 400.
  This app's own live check must confirm both, and Avery must look at the Logs page (§11.4). Google's
  separate abuse-monitoring copy is not affected by `store`.

### 6.2 Routes (`src/domain/registry.ts`)

`PROVIDERS = ['openai', 'anthropic', 'google']`, `PROVIDER_NAMES.google = 'Google'`. Add a builder
`google(modelId, label, line, adapterVersion, extra)` like `openai()`/`anthropic()`:

- `key: 'google-' + modelId.replaceAll('.', '-')`
- `docsUrl: 'https://aistudio.google.com/docs/models/' + modelId`
- `verifiedAt: null` and `multiTurnVerifiedAt: null`

Bump `PROVIDER_REGISTRY_VERSION` to the delivery date (e.g. `2026-12-xx.1`).

Proposed lineup, from the models and thinking pages read Nov 18, 2026. The implementing session must
re-read every route's own model page and fill in `contextTokens` and `providerMaxOutputTokens` from it;
only Gemini 4 Carbon's page was read here.

| Key | Model | Line | Adapter version | Why this version |
|---|---|---|---|---|
| `google-gemini-4-carbon` | `gemini-4-carbon` | Gemini 4 | `google-generate-low-v1` | Cannot disable thinking; levels low/medium/high (default medium). 1,048,576 context, 65,536 default output. |
| `google-gemini-4-argon` | `gemini-4-argon` | Gemini 4 | `google-generate-low-v1` | Cannot disable thinking (default medium). |
| `google-gemini-4-neon` | `gemini-4-neon` | Gemini 4 | `google-generate-low-v1` | Cannot disable thinking (default high). Confirm `low` is accepted. |
| `google-gemini-4-hydrogen` | `gemini-4-hydrogen` | Gemini 4 | `google-generate-low-v1` | Cannot disable thinking (default high). Confirm `low` is accepted. |
| `google-gemini-3-8-flash` | `gemini-3.8-flash` | Gemini 3 | `google-generate-low-v1` | Stable; `minimal` not supported. |
| `google-gemini-3-6-flash` | `gemini-3.6-flash` | Gemini 3 | `google-generate-minimal-v1` | Stable; `minimal` makes thinking unlikely but not impossible. |
| `google-gemini-3-5-flash-lite` | `gemini-3.5-flash-lite` | Gemini 3 | `google-generate-minimal-v1` | Stable; default `minimal`. |
| `google-gemini-3-1-flash-lite` | `gemini-3.1-flash-lite` | Gemini 3 | `google-generate-minimal-v1` | Stable; default `minimal`. |
| `google-gemini-2-5-flash-lite` | `gemini-2.5-flash-lite` | Gemini 2.5 | `google-generate-budget-off-v1` | "Served until further notice"; `thinkingBudget: 0` turns thinking off. Optional (Q1). |

Left out, and recorded in `docs/provider-contracts.md` like D-48's exclusions:

- **Previews**: `gemini-3.1-pro-preview`, `gemini-3-flash-preview`. Previews get shut down (the docs
  already list `gemini-3-pro-preview` and `gemini-3.1-flash-lite-preview` as shut down), which would
  strand retries of recorded hearings.
- **Deprecated** `gemini-2.5-flash` and `gemini-2.5-pro`. On Dec 1, 2026 their requests are silently
  routed to other models (`gemini-3.5-flash-lite` and `gemini-3.8-flash`). A recorded hearing would then
  name a model that did not answer.
- **Not text models**: Live, TTS, image, robotics and `-image` variants.

`ADAPTER_PROFILES` gains:

```ts
'google-generate-low-v1':        { provider: 'google', multiTurn: true, reasoning: 'low' },
'google-generate-minimal-v1':    { provider: 'google', multiTurn: true, reasoning: 'low' },
'google-generate-budget-off-v1': { provider: 'google', multiTurn: true, reasoning: 'off' },
```

`minimal` is recorded as `reasoning: 'low'`, not `'off'`. Google says the model may still think, and
thinking tokens count toward `maxOutputTokens`, so the route needs the headroom to avoid empty answers.

`src/server/services/evaluations.ts:36` `PREFERRED_DEFAULTS` gains `google: 'google-gemini-3-6-flash'`
because the `Record<ProviderId, …>` type requires it. The default new draft stays OpenAI vs Anthropic.

### 6.3 `src/server/providers/google.ts` (new)

```ts
export const GOOGLE_API_ORIGIN = 'https://generativelanguage.googleapis.com'
export const googleGenerateUrl = (modelId: string) =>
  `${GOOGLE_API_ORIGIN}/v1beta/models/${encodeURIComponent(modelId)}:generateContent`
export type GoogleThinking = 'low' | 'minimal' | 'budget-off'

export function googleRequestBody(system: string, messages: readonly TranscriptMessage[], maxOutputTokens: number, thinking: GoogleThinking) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    generationConfig: {
      maxOutputTokens: thinking === 'budget-off' ? maxOutputTokens : maxOutputTokens + LIMITS.reasoningHeadroomTokens,
      thinkingConfig: thinking === 'budget-off' ? { thinkingBudget: 0 } : { thinkingLevel: thinking },
    },
    store: false,
  }
}
export const makeGoogleAdapter = (thinking: GoogleThinking): Adapter => async (fetchFn, request, timeoutSignal) => { … }
```

Request rules:

- `modelId` always comes from the registry, never from user input. A registry unit test also requires
  `/^[a-z0-9][a-z0-9.-]*$/`, so `encodeURIComponent` is a second guard, not the only one.
- Send `thinkingLevel` or `thinkingBudget`, never both. Sending both is a documented 400 on Gemini 4.
- Send no `temperature`, `safetySettings`, `tools`, `toolConfig` or `cachedContent`. No `includeThoughts`
  either: thoughts are not returned by default.
- Headers: `x-goog-api-key: <key>`. Request ID: no response header is documented, so the adapter falls
  back to the body's `responseId`. `postJson` (`common.ts`) takes `requestIdHeader: string | null` and
  the adapter fills `providerRequestId` from the body when the header is absent.

Response mapping (keep §6.5 of `docs/provider-contracts.md` in step):

| Gemini response | `ProviderOutcome` |
|---|---|
| `candidates[0].content.parts[]` where `typeof text === 'string'` and `thought !== true` | `text` (joined). `thoughtSignature` is ignored. |
| `candidates[0].finishReason` | `finishReason` (verbatim). `MAX_TOKENS` → `truncated: true`. |
| no candidates and `promptFeedback.blockReason` set | failure `PROVIDER_BLOCKED` (definite) |
| `finishReason` in `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII`, `LANGUAGE` with no text | `PROVIDER_BLOCKED` |
| the same with some text | kept, `truncated: true`, `finishReason` recorded (matches the Anthropic "text plus refusal" rule) |
| `MALFORMED_RESPONSE`, `OTHER`, `FINISH_REASON_UNSPECIFIED` with no text | `EMPTY_OUTPUT` through `finishText` |
| `usageMetadata.promptTokenCount` | `inputTokens` |
| `candidatesTokenCount + (thoughtsTokenCount ?? 0)` | `outputTokens`, so it is billed output, like OpenAI's and Anthropic's `output_tokens`, which already include reasoning. `null` if `candidatesTokenCount` is missing. |
| `modelVersion` | `observedModel`. Shown after unsealing like today. A later version should compare it to `modelId` and say so on the record if Google silently routed elsewhere (Q1). |
| `responseId` | `providerRequestId` (fallback) |

Error mapping. Google documents two error shapes:

- the long-standing `{error: {code: 400, message, status: 'INVALID_ARGUMENT', details: [{'@type': '…ErrorInfo', reason: 'API_KEY_INVALID'}]}}`
- a newer table `{error: {code: 'authentication', message}}`

The adapter reads only `error.code`, `error.status` and `error.details[].reason`, matches them against
fixed allowlists, and **never stores or logs `message`**.

| HTTP / signal | Code |
|---|---|
| 401, or 400 with reason `API_KEY_INVALID` / `API_KEY_EXPIRED` | `PROVIDER_AUTH_FAILED` |
| 402 (`payment_required`: prepay credits used up) | `PROVIDER_QUOTA_EXHAUSTED` |
| 403 (`PERMISSION_DENIED`: project restricted or unverified, leaked key blocked) | `PROVIDER_ACCESS_DENIED` |
| 400 `FAILED_PRECONDITION` (billing off, free tier not available in the region) | `PROVIDER_ACCESS_DENIED` |
| 404 / `model_not_found` | `PROVIDER_MODEL_UNAVAILABLE` |
| 429 with code `quota_exceeded` (daily quota) | `PROVIDER_QUOTA_EXHAUSTED` |
| other 429 (`RESOURCE_EXHAUSTED`, `rate_limit_exceeded`) | `PROVIDER_RATE_LIMITED` |
| 500, 503 | `PROVIDER_UNAVAILABLE` |
| 504 `DEADLINE_EXCEEDED`, 499 | `PROVIDER_UNAVAILABLE` with **`definite: false`**: Google may have spent thinking tokens. Same "possibly billed" handling as a timeout. |
| other 4xx | `PROVIDER_REJECTED_REQUEST` |

`classifyHttpError` gets an optional `hint.accessDenied` so the 400 `FAILED_PRECONDITION` case does not
need a special path.

### 6.4 Wiring (`src/server/providers/index.ts`)

`transports` gains:

```ts
'google-generate-low-v1': makeGoogleAdapter('low'),
'google-generate-minimal-v1': makeGoogleAdapter('minimal'),
'google-generate-budget-off-v1': makeGoogleAdapter('budget-off'),
```

`adapterFor` already refuses a version from another provider, so a Google key can never reach an OpenAI
transport and the reverse. Update the comment "Only two fixed endpoints" and `docs/architecture.md:28`.

### 6.5 Explicit outbound allowlist (`src/server/providers/endpoints.ts`, new)

Today the allowlist is implicit: three string constants. With a third host it becomes code:

```ts
export const PROVIDER_ORIGINS: Readonly<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
}
/** Wraps deps.providerFetch: refuses before any network I/O unless the URL is https, on an allowlisted
 *  origin, with no userinfo or explicit port, and redirect is 'manual'. */
export function allowlistedFetch(inner: typeof fetch, provider?: ProviderId): typeof fetch
```

- `platform.ts:75` wires `providerFetch: allowlistedFetch((input, init) => fetch(input, init))` (any
  allowlisted origin), so `generation.ts`, `special-master.ts` and `credentials.ts` (Check key) all pass
  through it without changes.
- A refused URL throws a fixed `OutboundRefused` error, which the adapters map to
  `PROVIDER_REJECTED_REQUEST` (definite: nothing was sent). It logs `{event: 'outbound_refused',
  origin}`. The origin is a registry constant, never user text.
- `KEY_CHECK_URLS` and every `*_URL` constant are built from `PROVIDER_ORIGINS`, so a unit test can
  assert that every URL any adapter or the key check builds has an allowlisted origin.
- A provider's key only ever goes to that provider's origin. `adapterFor` (and `checkProviderKey`)
  wrap the fetch they pass down as `allowlistedFetch(inner, provider)`, which accepts only
  `PROVIDER_ORIGINS[provider]`. This is a second guard after `adapterFor`'s provider check.

### 6.6 Check key (`src/server/providers/key-check.ts`)

- `KEY_CHECK_URLS.google = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1'`, header
  `x-goog-api-key`. Free; it lists models and generates nothing.
- Classification. Google returns 400 (reason `API_KEY_INVALID`) for a bad key on the long-standing error
  shape, and 401 on the newer one. Today the check never reads the body, so a 400 would show as
  "unreachable". For `google` only, `checkProviderKey` reads at most **4 KiB** of a 400 body, parses it,
  and looks only for the reason tokens `API_KEY_INVALID`/`API_KEY_EXPIRED` → `invalid`/`AUTH_FAILED`.
  Nothing else from the body is kept, stored, logged or returned. If parsing fails, or no allowlisted
  token is found, the result is `unreachable`/`UNEXPECTED_STATUS` as today.
- 403 → `restricted` (for example a project that is not verified). The copy says "Google recognised the
  key but refused it. Check that the key's project has the Gemini API enabled and billing set up."
- The live check must try one deliberately broken key (§11.4) to settle 400 vs 401.

### 6.7 Smoke script (`scripts/provider-smoke.ts`)

It already lists every `MODEL_ROUTES` entry and tests each through its own adapter version, so Gemini
routes appear with no change. Two edits:

1. The key prompt names the provider of the selected routes ("Google AI Studio key (hidden):"). It still
   uses the hidden prompt and never takes the key from argv or env.
2. For Google routes, print `store` was sent as `false` and the `observedModel`, so the record row can
   say so.

## 7. Blinding, BYOK and security analysis (part A)

### 7.1 Where the judge's content goes with Gemini

| Copy | Who controls it | Mitigation |
|---|---|---|
| Project request logs (AI Studio Logs page, up to 55 days) | Google project setting. On by default for projects created on or after Oct 26, 2026. | `store: false` on every request (top-level, overrides the project). Live check confirms nothing appears on the Logs page. |
| Abuse-monitoring log | Google, "for a limited period", paid and free | Cannot be turned off. Stated in the privacy notice. |
| Product improvement and human review | Google, **free-tier ("Unpaid Services") projects only** | Plain-words warning on the key card, the Start consent and the privacy page. Model Court cannot detect the tier. |
| Interactions-style stored conversations | not used | `generateContent` only (§6.1) |
| Grounding storage (30 days) | not used | No tools are ever sent. |

The Gemini API terms (effective Mar 23, 2026) also say:

- Users must be 18 or older.
- An API client "made available" to users in the EEA, Switzerland or the UK may use only Paid Services.

Model Court is such a client, but the key and its tier belong to the judge. Recommended copy for the
terms page: "Judges in the EEA, Switzerland or the UK must use a Gemini key from a paid-tier project."
Avery decides whether that is enough (Q2).

### 7.2 BYOK invariants (unchanged, checked for Gemini)

- **Plaintext key:** exists only in `saveCredential`, `withRunCredential` and `checkCredential`. It is
  in a header, never in a URL, job payload, receipt, log, audit row or API response.
- **Receipts:** keyed by an HMAC digest (`hmacHex`), never the key itself.
- **Errors:** provider error text is never stored. The Gemini adapter reads only allowlisted enum
  tokens (§6.3), and the key check reads at most 4 KiB of one 400 body (§6.6).
- **Redirects:** refused (`redirect: 'manual'` → `PROVIDER_REDIRECT_REFUSED`). This matters more for
  `x-goog-api-key` and `x-api-key` than for `Authorization`: browsers and fetch strip `Authorization`
  on cross-origin redirects, but not custom headers.
- **Cross-provider leaks:** refused at save time (§8.2) and at dispatch (`adapterFor` provider check,
  §6.5 origin check).
- **Paid-call shape:** outbox → job → guarded claim → send outside a transaction → fenced commit, with
  no automatic paid retry. Unchanged; Gemini is just another transport.

### 7.3 Blinding

- **What jurors see:** never a provider name, model, duration, tokens or finish reason before
  unsealing (`assignment_json` and reviewer projections, unchanged).
- **New identity clues:** Gemini tends to answer in heavy Markdown and will name itself if asked.
  This is the same class of clue the other two providers give, and the juror "suspected identity clue"
  flag covers it. No Gemini-specific filtering: editing testimony would weaken the record.
- **Length:** reasoning routes are not held to 512 visible tokens (D-48). Every Gemini route except
  2.5 Flash-Lite reasons, so Gemini answers may run longer than non-reasoning parties'. This is already
  true of the OpenAI and Anthropic reasoning routes, and the facts panel says so.
- **Latency:** thinking adds latency, but latency is hidden until unsealing.
- **Special master:** grading with a Gemini model may favour Gemini answers. The record already shows
  the grader's agreement with the jury first (D-40), and nothing else changes.

### 7.4 Threats considered for part A

| Threat | Outcome |
|---|---|
| Key placed in a URL (`?key=`) and logged by an intermediary | Header only; unit test asserts no `key=` in any built URL. |
| Judge pastes an OpenAI key on the Google card; Check key sends it to Google | Prefix refusal before save (§8.2). |
| Model ID injection into the path | Registry-only model IDs, pattern test, `encodeURIComponent`. |
| Huge or endless response | The existing 256 KiB body cap and 16 KiB stored-text cap. |
| Silent model rerouting by Google (deprecations) | Deprecated models excluded; `observedModel` recorded; later warning (Q1). |
| A new host widens the Worker's outbound surface | Explicit origin allowlist with a test (§6.5). |

## 8. BYOK details

### 8.1 Credential lifecycle for Google

Same as the other two providers: 7-day TTL with renew (D-23), one active key per provider, replace
with If-Match, revoke fences pinned work, re-pin on retry (D-59), restore cutoff (D-33). No new columns.

### 8.2 Key format rules (`src/domain/contracts.ts`)

Google does not document a fixed format, and its newer "authorization keys" (bound to a service account,
the default for keys created in AI Studio since May 28, 2026) have none published. So the Google card
**does not require** a prefix. It refuses keys that clearly belong to another provider:

```ts
export const FOREIGN_KEY_PREFIXES: Record<ProviderId, readonly string[]> = {
  openai: ['sk-ant-', 'AIza', 'sk-or-'],
  anthropic: ['AIza', 'sk-or-', 'sk-proj-'],
  google: ['sk-'],                       // covers sk-proj-, sk-ant-, sk-or-
}
```

`createCredentialSchema.superRefine` adds a `KEY_PROVIDER_MISMATCH` issue with the matching provider's
name. This is a hard refusal, because otherwise Check key would send the key to the wrong company.
`ADMIN_KEY_PREFIXES` is unchanged: Google has no admin-key equivalent. The card's guidance instead says
to restrict the key to the Gemini API.

### 8.3 Unrestricted keys

Google's docs say unrestricted standard keys are now rejected, and standard keys with restrictions still
work. If an unrestricted key gets a 403, Check key shows `restricted` with the copy in §6.6. Nothing else
is needed.

### 8.4 Part B: OpenAI-compatible endpoints

**Arbitrary base URL (judge types `https://…/v1`): not acceptable.**

| Risk | On Cloudflare Workers |
|---|---|
| SSRF into private networks | **Low but not zero.** Workers have no VPC and no instance metadata service, and the judge's laptop or LAN is unreachable. But `fetch` reaches any public host, Cloudflare-proxied hosts (including other zones and possibly this deployment's own hostnames), and anything the DeepSpace platform exposes publicly. The app cannot enumerate these. |
| DNS rebinding | **Cannot be mitigated in the app.** Workers resolve DNS inside the runtime: the code cannot resolve, inspect or pin the IP before connecting. An IP-range check is therefore impossible, and only a fixed hostname allowlist works. |
| Redirects | Refusing them (as today) is mandatory: `x-api-key`-style headers survive cross-origin redirects. Even then, the first host is attacker-chosen. |
| Key exfiltration | The direct case (the judge's own key to the judge's own host) is the judge's own risk. The real case is indirect. Spec 02 adds scenario files that carry parties, so a shared scenario could carry an attacker's base URL. If such a party ever accepted an existing OpenAI key ("it's OpenAI-compatible"), opening someone else's scenario would send that key to the attacker. Any design would have to forbid pairing a first-party key with a custom host and refuse base URLs from imports. That is a lot of rules to get right, for a feature few judges need. |
| Content exfiltration | Questions, references and system prompts go to the typed host. That is fine for the judge's own server, and harmful if the host came from an import. |
| Outward abuse | The deployment becomes a POST relay from Cloudflare egress IPs to arbitrary hosts. The operator (Avery) answers for it. Call caps limit volume, not targets. |
| Juror safety | A judge-controlled endpoint can return any text, including phishing links aimed at jurors. React escapes it and there are no live links, but it is still shown as testimony. |
| "Self-hosted" value | Low. A model on the judge's machine or LAN is unreachable from Workers unless exposed to the internet (a tunnel), which is a risk in itself. Imported evidence (D-38) already covers "I ran my own model offline": import its answers as a party. |

**Fixed-host OpenRouter (`https://openrouter.ai/api/v1/chat/completions`): acceptable, deferred.** It
is the only way to add open-weight models (Llama, Qwen, DeepSeek, Mistral) with a key-only, fixed-host
design. Conditions if Avery schedules it (Q6):

- A fourth provider id `openrouter` (allowed by the 4.2 (a) CHECK) with its own key card and `sk-or-`
  prefix. Key check `GET https://openrouter.ai/api/v1/key` (free; body never read).
- Curated registry routes only, each pinned to one upstream: `provider: {order: [<upstream>],
  allow_fallbacks: false, require_parameters: true, data_collection: 'deny', zdr: true}`. Without this,
  one model slug can be served by different hosts and quantizations, so a "party" is not one setup, and
  the default `data_collection: 'allow'` permits upstreams that may train on the content. The route
  records the upstream; the adapter checks the response's upstream and model and fails
  (`PROVIDER_MODEL_UNAVAILABLE`) on a mismatch. Confirm the response field name in the live check.
- No OpenAI, Anthropic or Google models through OpenRouter. They are reachable directly, and "the same
  model via a reseller" is a confusing party.
- Copy: OpenRouter charges its own fee on top of the upstream price, and the judge's OpenRouter account
  privacy settings also apply.

### 8.5 Privacy notice and site copy (files to edit)

| File | Change |
|---|---|
| `src/pages/(site)/privacy.tsx:44,47,58` | "OpenAI or Anthropic" → "OpenAI, Anthropic or Google". Add a Google paragraph: `store: false`, abuse-monitoring copy, free-tier use for product improvement and human review. |
| `src/pages/(site)/terms.tsx:24,52` | Add Google; trademarks "Google and Gemini"; the EEA/CH/UK paid-tier line (Q2); the 18+ line already covers Google's age rule. |
| `src/pages/(app)/(protected)/settings/api-keys.tsx:26` | "your own OpenAI, Anthropic or Google keys" |
| `src/components/settings/ProviderKeyCard.tsx:238` | Per-provider hint; Google: "Use a key restricted to the Gemini API." |
| `src/pages/index.tsx:20,27,60`, `src/components/site/SiteChrome.tsx:76` | Name Google; "Not affiliated with or endorsed by OpenAI, Anthropic or Google." |
| Start dialog consent | The Google line from §3.3, shown only when a Google party is present. |

### 8.6 Copy (final candidates; plain words, court terms only as display strings)

- Key card intro: "Gemini parties use your own Google AI Studio API key. Google bills your Google
  project. Model Court asks Google not to keep these requests in your project's logs. Google still keeps
  a copy for a limited time to check for abuse."
- Free-tier warning: "On Google's free tier, Google may use what you send to improve its products, and
  people at Google may read it. Use a paid-tier project for anything private. In the EEA, Switzerland
  or the UK, a paid-tier project is required."
- Check key restricted: "Google recognised this key but refused to list models. Make sure the key's
  project has the Gemini API turned on and billing set up."

## 9. More than three parties (part C)

### 9.1 Juror workload is the binding constraint

Every juror scores every testimony on three 0–2 lines, with an optional note. Today's maximum is
5 questions × 3 parties = 15 testimonies = 45 scores, and each question asks a juror to read up to three
answers of about 2,000 characters each, side by side. Going to 5 parties × 5 questions would mean 25
testimonies and 75 scores, with five answers to hold in mind per question. Reliability falls as fatigue
and position effects rise. The same multiplier also hits:

- **Calls:** 25 calls is over the default 20-a-day per-judge cap (`MAX_DAILY_CALLS_PER_USER`), so such a
  hearing could never start on the default deployment. The special master would add up to 25 more.
- **Seats:** still 3 invited jurors plus the judge, so more parties mean fewer ratings per testimony
  relative to the number of comparisons.

**Decision:** keep the per-juror workload at today's maximum and let the judge choose its shape.

```ts
// src/domain/limits.ts
maxConfigurationsPerRun: 5,          // was 3
maxTestimoniesPerHearing: 15,        // parties × questions; today's 3 × 5
```

Allowed shapes: 2–3 parties × up to 5 questions (as today), 4 parties × up to 3 questions, 5 parties ×
up to 3 questions. Imported parties count toward the 15: they cost no calls, but jurors score them.
Calls per hearing stay ≤ 15, inside the default 20-a-day cap. `quotaBlock` messages are unchanged.

Operator cap: `MAX_CONFIGURATIONS_PER_RUN` (`src/server/config.ts:80`) now accepts 2–5. **Its default
stays 3**, so a deployment changes nothing until the operator raises it (Q5).

The judge-facing trade-off, in the draft editor: "More parties means fewer questions in one hearing.
With 3 questions the count is less certain. To compare more setups on all 5 questions, re-hear this
case with an anchor party."

### 9.2 Blind labels and the worksheet

- **Labels:** `buildAssignment` (`runs.ts:634`) uses
  `const labels = ['A', 'B', 'C', 'D', 'E'] as const` and the `BlindLabel` type (§5). Labels are already
  re-shuffled per juror per question, so a label never follows a party across questions. Keep that.
- **Position balance (new, small):** with up to five positions, random shuffles leave position bias
  uneven over 1–4 raters. Use a balanced rotation instead:
  - When review opens, draw one random base order per question. Store it in a new server-only field
    `positionBase` of `eligible_manifest_json`, which the existing trigger makes immutable once set.
  - Give the *k*-th session that joins the rotation by *k* (mod parties).
  - Every party then sits in each position equally often when raters = parties, and as evenly as
    possible otherwise.

  The rotation is computed in `buildAssignment(manifest, newId, rotation)`. Labels follow position as
  today. Optional (Q8). If declined, keep `shuffle`.
- **Worksheet** (`src/components/review/Worksheet.tsx`, `CaseFile.tsx`):
  - **2–3 parties:** unchanged. `WorksheetGrid` with `md:grid-cols-2`; the third card wraps.
  - **4–5 parties:** a `Tabs` row "Testimony A … E", each tab showing a scored tick (same pattern as
    `QuestionPager`). One testimony at full width with its `RubricForm` below it.
  - **"Compare two":** a toggle that splits the area into two columns, each with its own A–E selector,
    for reading two answers side by side. Scoring stays per testimony.
  - **Keys:** `[`/`]` for the previous/next testimony, alongside the existing question keys, with
    `Kbd` hints.
  - **"File" stays disabled** until every testimony on every question is scored (unchanged rule).
  - Use shadcn `Tabs` and `ToggleGroup` from the existing `base-nova` registry (D-08); no new primitives.
- **Practice sample** (`/sample`): unchanged (3 parties). One Playwright case uses a 5-party fixture
  instead.

### 9.3 Why not incomplete blocks

With 5 parties, each juror could score only 3 per question. With at most 4 raters this leaves some pairs
of parties never scored by the same rater on a question. The headline's per-question "winner" would then
compare means from different people. Inter-rater reliability (`ReliabilitySection`) and the disagreement
view would need per-pair coverage rules. Not worth it at this scale; revisit only if the seat limit grows.

### 9.4 Record: findings, headline, testimony

- **Headline maths** (`src/components/record/headline.ts`, D-60): already N-party (`tallyQuestions`
  computes per-question winners, wins/ties/losses and totals for any number of parties). Two changes
  for N ≥ 4:
  - The `lead` sentence names the leader and the runner-up only ("Party C won 2 of 3 questions; Party A
    won 1; the others none").
  - A **pairwise table** ("row beat column on k of n questions") replaces the single head-to-head table.
    It is a square matrix, scrollable inside its frame at narrow widths.

  The `close` rule (margin ≤ 1 point) and "names no winner when close" stay. Add tests with 4 and 5
  parties, including three-way ties.
- **`FindingsTable`, `PartiesSection`, `TestimonySection`:** one column or card per party.
  - `PartiesSection` goes from `md:grid-cols-2` to `md:grid-cols-2 xl:grid-cols-3`.
  - `TestimonySection` with 4–5 parties uses the same tabs-plus-compare pattern as the worksheet.
  - `FindingsTable` already scrolls sideways at 390 px (results-headline hand-over). With 5 parties this
    is expected: keep the first column sticky and add an `aria-describedby` hint "Scroll sideways for
    more parties".
- **Export** (`src/server/services/export.ts`): parties are already listed per row. Check CSV column
  generation for any fixed A–C assumptions (none found in a grep; confirm in tests).
- **Special master:** grades one testimony per item, so its call count follows testimonies (≤ 15).
  Calibration is per testimony and works unchanged.

### 9.5 Cross-hearing comparison stays the answer for "many setups"

Spec 02's anchor comparison (`compareHearings`, `src/domain/scenario.ts`) already handles "more setups
than one hearing holds", with honest caveats about different juries. This spec only adds the pointer
copy in §3.5. Spec 02's §6.2 rule ("restoring parties that exceed today's `MAX_CONFIGURATIONS_PER_RUN`
returns 422") also needs the testimony limit: restoring 5 parties onto a 5-question draft returns 422
with the §3.4 message.

## 10. Limits and cost

### 10.1 Limits (summary)

| Limit | Today | After |
|---|---|---|
| `LIMITS.maxConfigurationsPerRun` | 3 | 5 |
| `LIMITS.maxTestimoniesPerHearing` | (implicit 15) | 15, enforced in `draftInputSchema` and at Start |
| `MAX_CONFIGURATIONS_PER_RUN` operator range / default | 2–3 / 3 | 2–5 / 3 |
| Calls per hearing (max) | 15 | 15 |
| Daily per-judge / daily global / lifetime caps | 20 / 100 / 500 | unchanged |
| Output cap, Gemini reasoning routes | — | 512 + 8,192 (`reasoningHeadroomTokens`) |
| Check key timeout, rate | 10 s, 6/min | unchanged; Google included |

### 10.2 Cost, in plain words

- Gemini routes that reason are billed for thinking as output (Google: price = output + thinking tokens;
  thinking tokens are billed even if the answer is cut off).
- The facts panel and Start dialog reuse D-48's wording: "This model always reasons. Its reasoning is
  billed as output, up to 8,704 output tokens per answer."
- The 8,192-token headroom is a guess for Gemini as it was for the others, and the live check records
  real `thoughtsTokenCount` values.

### 10.3 Asks of spec 01 (setup metrics) and the kit framework (spec 03)

- **Spec 01:** dated Gemini price rows per route (input, output, and whether thinking is priced as
  output), and cost estimates for `google-*` adapter versions using
  `outputTokens = candidates + thoughts` (§6.3).
- **Spec 03:** adapter profiles may need capability flags (`structuredOutput`, `pdfInput`, `tools`) so a
  kit can filter routes. Gemini supports structured outputs and function calling; specs 04 and 06
  would add `google-*` adapter versions with `responseMimeType`/`responseJsonSchema` and
  `functionDeclarations`. This spec's versions send none of those.

## 11. Test plan

### 11.1 Unit (`vitest run`)

- `src/server/providers/adapters-google.test.ts` (new):
  - **Request bodies:** golden bodies for each version, single and multi-turn (`assistant` → `model`).
    `systemInstruction`, `store: false`, `thinkingLevel` vs `thinkingBudget` (never both),
    `maxOutputTokens` with and without headroom, and no `temperature`/`tools`/`safetySettings`.
  - **URL and headers:** URL built from the registry ID, no `key=` anywhere, `x-goog-api-key` set.
  - **Text:** thought parts and `thoughtSignature` ignored.
  - **Finish reasons:** `MAX_TOKENS` → truncated; `promptFeedback.blockReason` → blocked; `SAFETY` with
    and without text; `MALFORMED_RESPONSE` empty → `EMPTY_OUTPUT`.
  - **Usage and IDs:** usage summing and nulls, `responseId` fallback, `modelVersion` as observed model.
  - **Errors:** both error shapes (legacy 400 `API_KEY_INVALID`, new 401 `authentication`), 402, 403,
    400 `FAILED_PRECONDITION`, 404, 429 `quota_exceeded` vs others, 504 → not definite.
  - **Transport:** redirect refused; body cap; provider `message` never present in the outcome.
- `adapter-versions.test.ts`: every `google-*` version maps to a transport; `adapterFor('google-generate-low-v1', 'openai', 1)` → null; old versions unchanged (byte-identical bodies).
- `key-check.test.ts`: Google URL and header; 200/401/403; 400 with `API_KEY_INVALID` → invalid; 400
  with other JSON or invalid JSON → unreachable; at most 4 KiB read; the result never contains body text.
- `endpoints.test.ts` (new): `allowlistedFetch` refuses http, other hosts, look-alike hosts
  (`generativelanguage.googleapis.com.evil.test`), userinfo, ports, a provider/origin mismatch, and
  `redirect: 'follow'`. Every URL constant in `src/server/providers` uses an allowlisted origin.
- `registry.test.ts`: Google routes have Google adapter versions, `verifiedAt: null`, model IDs match the
  pattern, keys are unique, and no preview or deprecated IDs (explicit denylist).
- `contracts.test.ts`: `FOREIGN_KEY_PREFIXES` refusals per card; 5 parties allowed; 5 × 4 refused with the
  testimony message; 4 × 3 allowed; imported parties count.
- `headline.test.ts`: 4- and 5-party tallies, three-way ties, runner-up sentence, pairwise matrix.
- `runs.test.ts`: `buildAssignment` with 5 parties, labels A–E, and balanced rotation (each position
  equally often over 5 sessions) if adopted.
- `config.test.ts`: `MAX_CONFIGURATIONS_PER_RUN` 2–5 accepted, 6 rejected with a problem line, default 3.

### 11.2 Integration, both stores

Run on both stores (`vitest.integration.config.ts` (D1) and `vitest.integration.store.config.ts`
(Durable Object)):

- **Migration test (new, most important).** Build a store at `0006`, seed every rebuilt table:
  - a hearing with generations, two attempts, outbox rows and reservations in each state;
  - active and revoked credentials; `run_credentials`; a grader run with `grader_credentials`.

  Apply the new migration, then assert:
  - row counts and every column value are identical;
  - `PRAGMA foreign_key_check` is empty;
  - the set of triggers and indexes in `sqlite_master` is the same as before;
  - every immutability trigger still raises (accepted attempt, revoked credential, `run_credentials`
    re-pin rules);
  - one active credential per provider is still enforced;
  - `'google'` is accepted and `'bogus'` rejected;
  - deleting an evaluation still cascades to generations, attempts, outbox and reservations.

  Also prove the trap is avoided: a deliberately wrong order (drop the parent first) loses child rows
  in the test fixture.
- **Full Gemini flow with a fake `providerFetch`:** save a Google key, Check key, start a 3-provider
  hearing, generate, open review, unseal. Then:
  - revoking the Google key fences only Google generations;
  - retry with re-pin to a new Google key (D-59);
  - the special master on a Google route;
  - an outbound refusal (fake registry URL) records `PROVIDER_REJECTED_REQUEST` and releases the
    reservation.
- **Five parties:** 5 × 3 starts, 5 × 4 is refused at draft save and at Start, three jurors review with
  labels A–E, the record's tally matches the unit fixture, and export has five party columns.
- **Backup and restore:** round-trip with Google credentials, and restore of a pre-migration backup into
  a migrated store.

### 11.3 Playwright (`npm run test:smoke`, `tests/smoke.spec.ts`)

- The API keys page shows the Google card with the free-tier warning. Saving a key with an `sk-` prefix
  on it shows the mismatch message, using a fake key; no network.
- The draft editor's Google group shows "awaiting its live check", and Start is disabled for an
  unverified route.
- A 5-party worksheet fixture:
  - tabs A–E, scored ticks, "Compare two", and the `[`/`]` keys;
  - File is enabled only when everything is scored.
- A 5-party record: headline sentence, pairwise matrix, and FindingsTable sideways scroll hint, at 1280
  and 390 px, light and dark, with axe checks (as in the results-headline work).

### 11.4 Manual live check (Avery, own terminal, paid)

Avery runs this; nobody pastes a key into chat. The key is typed only at the smoke script's hidden prompt
or in the app's own Settings form.

1. In Google AI Studio, create a key in a project used only for this. Restrict it to the Gemini API, set
   a billing alert, and note whether the project was created before Oct 26, 2026.
2. Run `npm run smoke:providers`, choose the Google route keys (start with `google-gemini-3-6-flash` and
   `google-gemini-4-carbon`), and use `single` mode. Then run `multi` mode for the same routes.
3. For each route, record in `docs/provider-contracts.md`:
   - outcome kind, `finishReason`, tokens in/out (and note `thoughtsTokenCount` if printed);
   - observed model, `responseId`, duration, and whether the answer was truncated.
4. Open the project's **Logs** page in AI Studio and confirm the smoke requests do **not** appear
   (`store: false` worked). If they appear, stop: the adapter must not be enabled.
5. In the app's Settings (deployed or local), save the key with Check key on and confirm "Valid". Then
   save a deliberately broken copy (change one character, typed in the form, not chat) and record whether
   Google answered 400 or 401, and that the app showed "Invalid".
6. Only after rows exist: set `verifiedAt` (and `multiTurnVerifiedAt`) on those routes, then run the
   deployed check (V12) with one Gemini party.

## 12. Delivery (session-sized steps, each on a branch, none merged or deployed until Avery says so)

1. **Provider CHECK migration** (§4.2) with the migration test on both stores. No behaviour change:
   `PROVIDERS` still has two entries. Riskiest step, so it goes first and stands alone.
2. **Outbound allowlist and key-rule hardening** (§6.5, §8.2): `endpoints.ts`, `allowlistedFetch` wiring,
   `FOREIGN_KEY_PREFIXES`, `KEY_PROVIDER_MISMATCH`. Useful even without Gemini.
3. **Gemini adapter and registry** (§6.2–6.4, §6.6, §6.7): `google.ts`, three adapter versions, eight or
   nine unverified routes, the Google key check, the `postJson` request-ID fallback, the smoke script,
   `PROVIDERS`/`dto.ts`/`PREFERRED_DEFAULTS`, and the `docs/provider-contracts.md` section. Unit and
   integration tests.
4. **Gemini UI and copy** (§3.1–3.3, §8.5–8.6): key card, picker group, Start consent line, privacy,
   terms, home and footer copy. Playwright. A decision row (next D-number) in `docs/decisions.md`.
5. **Live check (Avery)** (§11.4), then a small commit setting `verifiedAt` with the smoke rows.
6. **Five parties: limits, contracts, assignment** (§5, §9.1–9.2 labels and rotation): no UI beyond the
   editor's limit message. Integration tests with 5 parties.
7. **Five parties: worksheet and record UI** (§9.2 worksheet, §9.4): Playwright and axe at two widths.
   Can run in parallel with steps 3–4 (no shared files except `limits.ts`, which step 6 owns).
8. **(Only if Avery approves Q6) OpenRouter** as a fixed-host provider (§8.4), with its own spec addendum
   and live check.

## 13. Open questions for Avery

1. **Gemini lineup.** Approve the 8 routes in §6.2 (four Gemini 4, four Gemini 3 stable)? Include
   `gemini-2.5-flash-lite` (the only Gemini route with thinking fully off, but an older model)? Also:
   should the record warn when Google's `modelVersion` differs from the requested model?
2. **EEA/UK/Switzerland.** Is the terms line "judges there must use a paid-tier key" enough under
   Google's "API clients made available to EEA users may use only Paid Services", or do you want Gemini
   hidden for those judges? Model Court cannot detect a key's tier.
3. **generateContent vs Interactions.** Accept the "legacy"-labelled but supported `generateContent`
   now, with a later `google-interactions-v1` adapter if Google announces a shutdown?
4. **Parties.** Approve "up to 5 parties, at most 15 testimonies per hearing"? Alternatives:
   - keep 3 and rely on spec 02 alone;
   - allow 20 (4 × 5) with a higher default daily cap.
5. **Live deployment.** Should `MAX_CONFIGURATIONS_PER_RUN` stay 3 on the live app after this ships, or
   go to 5?
6. **OpenRouter.** Do you want open-weight models badly enough to schedule the fixed-host OpenRouter
   provider (§8.4)? If so, which upstream models first?
7. **Migration extensibility.** List `'openrouter'` in the new CHECKs now (option (a), avoids a second
   rebuild) or keep exactly three values?
8. **Position balance.** Replace per-juror random order with the balanced rotation (§9.2)?
9. **Your Google project.** Was it created before Oct 26, 2026? It matters only for what you should
   expect on the Logs page during the live check.

## Sources read (Nov 18, 2026)

Google: AI Studio API reference (generate-content, models, overview), docs on thinking, models,
logs-datasets, api-key, api-errors, troubleshooting, and the Gemini API terms (effective Mar 23, 2026).
OpenRouter: provider-selection guide. A third-party report on `store: false` over REST (GitHub
fatheus97/mealbot#524) was used only as a hint to confirm in the live check.
