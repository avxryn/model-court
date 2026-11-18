# Spec 01: Setup comparison (cost, speed and consistency)

Status: draft for review, Nov 18, 2026. Roadmap item 1 (`docs/roadmap.md`). Research only so far: no code,
no migration, no deploy. Work lands on a branch cut from `master` after the v1 submission (Nov 20, 11:59 p.m.
Eastern) and deploys only when Avery says so.

## 1. Problem and who it is for

A judge comparing setups usually wants an answer to "should we upgrade the model or change the prompt?",
and the answer is rarely about quality alone. A newer model that scores 0.3 points higher but costs four
times as much per answer and takes twice as long may be the wrong choice. So may a cheaper prompt that
works four times in five. Today the record has the jury's findings, but cost and speed are scattered or
missing:

- Tokens and duration show per testimony, one at a time, inside the Testimony accordion
  (`src/components/record/TestimonySection.tsx:70`).
- The Reliability fold (`ReliabilitySection.tsx`) has a per-party table with counts, attempts, median
  latency and truncations, but no tokens, no slowest call, no cost, and no breakdown of retries or errors.
- No price exists anywhere, so the judge has to work out cost by hand from token counts.
- Each party answers each question once, so the record cannot show whether a setup gives the same
  answer twice.

**Who it is for:** the judge (the case owner) choosing between two or three setups for one use case: a
model upgrade (comparison mode `model`, same prompt) or a prompt change (mode `configuration`, same
model). Jurors gain nothing to do. After unsealing, they can read the same table as context.

**Outcome:** after unsealing, the record has one decision table with a row per party: estimated cost,
median and slowest latency, tokens, failures and retries. When the judge asks for repeats, it also shows
how consistent each setup was across 2–3 samples of the same question.

## 2. What already exists (checked in code, Nov 18)

Recorded per attempt (`generation_attempts`, migration `0001_initial`, written by
`handleGenerationJob` in `src/server/services/generation.ts`):

| Field | Success | Definite failure | Uncertain (timeout, network, lease) | Canceled |
|---|---|---|---|---|
| `input_tokens`, `output_tokens` | provider usage, `null` when absent (never 0) | `null` | `null` | `null` |
| `duration_ms` (fetch start → body read; network included, queue wait excluded) | set | set | set for timeout/network; `null` for `PROVIDER_LEASE_EXPIRED` | `null` |
| `queue_wait_ms` | set at claim | set | set | set |
| `attempt_no` (1, or 2 for the single manual retry), `error_code`, `truncated`, `finish_reason`, `observed_model`, `provider_request_id` | set | partly | partly | — |

Not recorded: cached input tokens, reasoning/thinking tokens (both are in provider responses and dropped
by `src/server/providers/openai.ts:75–82` and `anthropic.ts:75–82`), and any price. Reasoning routes
(`openai-responses-reasoning-low-v1`, `anthropic-messages-adaptive-low-v1`) count reasoning inside
`output_tokens`, and both providers bill it as output.

Exposed today by `getResults` (`src/server/services/results.ts`), to every participant, only after reveal:

- `coverage[key]`: `planned, succeeded, failed, uncertain, canceled, successRate, attempts,
  failedAttempts, uncertainAttempts, medianLatencyMs` (succeeded attempts), `truncatedCount`; imported
  parties get `source: 'imported'` and nulls.
- `cases[].responses[]`: the accepted attempt's `inputTokens, outputTokens, durationMs, truncated,
  finishReason, observedModel, attemptCount, errorCode`.

Before reveal, the owner run view (`ownerRunView` in `src/server/services/runs.ts`) shows each generation's
`durationMs` and `queueWaitMs`. The judge's own review is context-aware, so this is not a blinding
problem. The reviewer run view (`reviewerRunView`) and the review DTO carry no generation, timing or
usage data.

One structural fact decides the repeats design: `generations` has `UNIQUE (run_id, case_key,
configuration_key)`. Three child tables reference `generations(id) ON DELETE CASCADE`:
`generation_attempts`, `outbox` and `attempt_reservations`.

## 3. Scope and non-goals

In scope:

1. A **dated, versioned price table** next to the model registry, and a pure cost estimate from recorded
   tokens. It is always labeled an estimate at list prices.
2. A **per-party decision table** on the record after unsealing: estimated cost (per answer, for this
   hearing, and per 1,000 answers), median and slowest latency, input/output tokens, failures, retries
   and possibly billed unknowns.
3. **Usage details**: record cached input tokens and reasoning tokens when the provider reports them,
   so the estimate can price cached input and the table can explain reasoning cost.
4. **Optional repeats**: a hearing-level "samples per answer" of 1 (default), 2 or 3 for generated
   parties. Jurors still score one answer per party per question. The record then shows consistency.
5. The **same numbers in the certified record export** (JSON) and a pure metrics function that items 2–6
   reuse.

Non-goals:

- Reconciling with provider invoices or usage/billing APIs. Admin keys are refused by design, and the
  provider bill is the authority.
- Fetching prices at runtime. There are no new outbound hosts, and prices are reviewed code.
- Budgets or caps in currency. Caps stay call counts (`budget_buckets`).
- Time to first token or tokens per second. Calls are non-streaming, so `duration_ms` is the whole call.
- Statistical significance. With at most 5 questions × 3 samples, the copy says the numbers are small.
- Controlling sampling (temperature, seed). The app never sends temperature (`docs/provider-contracts.md`),
  so repeats show each model's default variation.
- Jurors scoring every sample (see open question 2), and showing any of this before unsealing.
- Special master (grader) cost. That is a separate, optional line in step 6, never in the party table.

## 4. User flow

### Judge: before the hearing (draft)

- A new **"Repeats"** control on the case page sits next to the paid-call count (`CaseActionBar.tsx`) in the
  hearing options. It offers "Ask each party once (default)", "twice" or "three times". Help text: "Repeats
  show whether a setup gives the same answer each time. Jurors still score one answer per party; you can
  read the others on the record after unsealing."
- The paid-call count multiplies: "This hearing makes **30 paid calls** (5 questions × 3 parties × 2
  samples), billed to your keys."
- When the count exceeds what the caps allow, the existing `quotaBlock` message names the tightest cap.
  The repeat case adds one line: "Ask each party once instead (15 calls)." It is computed by the same
  pure rule, and the server stays the authority.
- Imported parties are never repeated. The control is hidden when every party is imported, and its text
  says "Imported answers are used once."

### Judge: during the hearing

The hearing page groups calls by question and party, with sample dots (`●●○`). The owner run view gains
`sampleNo` per generation. Retry works per sample, as attempt 2 of 2, as today. Deliberation opens by itself
only when every planned call succeeded (D-58 unchanged, applied to every sample). Otherwise the judge
retries or opens with exclusions as today. A failed extra sample never excludes a question by itself
(see §6.3).

### Juror

Nothing changes. Each question shows one testimony per party (A/B/C), shuffled per question. The review
DTO has the same shape and size for a 1-sample and a 3-sample hearing. A juror cannot tell repeats were
taken.

### Judge and jurors: the record after unsealing

A new section **"Cost and speed"** (`#setup`) sits between Findings and Judgment, with a SheetIndex
entry. It contains:

1. **One sentence** tying the numbers to the headline. It comes from `headline.ts`'s outcome and never
   names a winner the headline does not: "Party B scored higher on 4 of 5 questions; its answers cost
   about 3.1× as much as Party A's and took 1.4 s longer at the median." When the outcome is close or
   tied, it only states cost and speed.
2. **The decision table.** There is one row per party (it scales to item 7's larger panels), with these
   columns:

   | Column | Content |
   |---|---|
   | Party | Label, then model (and "imported" for imported parties) |
   | Cost per answer | Median estimated cost per answer on eligible questions, e.g. "$0.0031" or "under $0.0001" |
   | This hearing | Estimated total for every call that returned usage. If any call is possibly billed with unknown usage, adds "+ 1 call of unknown cost" |
   | Per 1,000 answers | Mean cost per answer × 1,000, labeled "at this hearing's mix" |
   | Median / slowest | e.g. "1.8 s / 3.2 s" (succeeded calls) |
   | Tokens per answer | Median in / out; out notes "includes reasoning" on reasoning routes and shows the reasoning share when known |
   | Failures and retries | e.g. "1 failed (rate limited), 1 retried, 0 uncertain"; codes are shown through `ERROR_TEXT` |
   | Consistency | Only with repeats (see below) |

   Imported parties read "Imported, not generated: no cost or timing" across the row.
3. **Footnote in plain words**: "Estimated at list prices from price table 2026-11-NN.1 (read
   Nov NN, 2026, from OpenAI's and Anthropic's pricing pages). Your provider bill is the authority; it can
   differ because of discounts, cached input, taxes, or failed calls that were still charged. Times include
   network overhead and exclude waiting in the queue. With N answers per party, 'slowest' is a single
   call." Routes without a price read "No price on file for this model" and are never shown as $0.
4. **With repeats, the Consistency column and a fold.** The column holds, for example, "Same answer
   3 of 5 · wording overlap 82% · answered every time 5 of 5". The fold ("Read every sample") lists each
   question with all samples per party side by side, with the primary sample marked "scored by the
   jury". Copy: "Wording overlap compares letters, not meaning: two answers can agree in different words.
   Read the samples before you conclude."

At under 640 px, each party's row becomes a stacked card (definition list), so the section never scrolls
sideways (avoiding the `FindingsTable` 390 px issue noted in the results-headline handover).

The Reliability fold keeps its coverage table, but its "Median latency" column moves to the new table
(a UI change only; `coverage.medianLatencyMs` stays in the API).

### Sample page (`/sample`)

The illustrative fixture (`src/sample/fixture.ts`, D-16, no provider names) gains a small decision table
with illustrative numbers, labeled "Illustrative numbers", shown after the sample is unsealed. It uses
the same `SetupTable` component with fixture metrics, so the public page shows what a judge will get.

## 5. Calculations (pure, browser-safe)

### 5.1 Price table: `src/domain/prices.ts` (new), re-exported from `registry.ts`

```ts
export interface RoutePrice {
  inputUsdPerMTok: number          // as published, USD per 1M input tokens
  cachedInputUsdPerMTok: number | null
  outputUsdPerMTok: number         // reasoning/thinking tokens are billed as output on both providers
}
export interface PriceTable {
  version: string                  // '2026-11-NN.1'; append-only, never edited once published
  readOn: string                   // ISO date the pages were read
  effectiveFrom: string            // ISO date; hearings created on/after it use this table
  sources: Record<ProviderId, string>  // pricing page URLs
  /** How the provider counts cached input: OpenAI includes it in input_tokens; Anthropic reports it separately. */
  cachedInputIncludedInInput: Record<ProviderId, boolean>
  prices: Record<string, RoutePrice>   // by route key (MODEL_ROUTES[].key)
  unpriced: Record<string, string>     // route key → reason ("no list price published")
}
export const PRICE_TABLES: readonly PriceTable[]
export function priceTableFor(createdAt: number, tables = PRICE_TABLES): { table: PriceTable; predates: boolean }
```

- **Numbers come from the providers' pricing pages**, read by the implementing session and cited in a
  new "Prices" section of `docs/provider-contracts.md`, the way D-48 recorded model pages. No paid call
  is needed. This spec deliberately gives no prices.
- Only standard (non-batch, default service tier) prices are recorded, because that is what hearings
  send. If a provider prices long prompts differently above a threshold, the entry records the
  standard tier, and the estimate says so. Hearing prompts are at most about 24K characters (system
  prompt, question, reference and history limits in `LIMITS`), far below any long-context tier.
- `priceTableFor` picks the latest table whose `effectiveFrom` is on or before the hearing's
  `runs.created_at`. Hearings older than the first table use the first table with `predates: true`, and
  the footnote says "prices read after this hearing". This keeps the snapshot untouched, so there is no
  snapshot hash change and old records keep reading. Because published tables are immutable, a record's
  estimate never changes after the fact.

### 5.2 Cost of one call

All amounts are integer micro-dollars (µUSD): tokens × USD per 1M tokens = µUSD exactly, rounded once per call.

```
openai:    (input − cached) × inputPrice + cached × cachedPrice + output × outputPrice
anthropic: input × inputPrice + cached × cachedPrice + output × outputPrice   (cached reported separately)
```

- If `cachedInputUsdPerMTok` is null or cached tokens are unknown, cached tokens are priced as full
  input. The estimate is then an upper bound, and the footnote says so.
- If input or output tokens are `null`, the call's cost is **unknown**. It is never 0.
- If a definite failure has `null` usage, it adds nothing ("not charged as far as we know"). An
  uncertain attempt (or a failure with `definite: false`) counts toward "N calls of unknown cost, possibly
  billed".

### 5.3 Per-party metrics: `src/domain/setup-metrics.ts` (new)

`setupMetrics(input: SetupMetricsInput, table: PriceTable): Record<configKey, PartyMetrics>` is a pure
function of one hearing's rows, so item 2's comparison page can lay several hearings side by side and
can pass one price table to compare like with like.

```ts
interface UsageRecord {            // one testimony (one generation), however many provider calls it took
  caseKey: string; configurationKey: string; sampleNo: number
  status: GenerationStatus
  attempts: Array<{ attemptNo: number; status: AttemptStatus; errorCode: string | null; definite: boolean | null
                    inputTokens: number | null; outputTokens: number | null
                    cachedInputTokens: number | null; reasoningTokens: number | null; durationMs: number | null }>
  calls?: number                   // provider calls inside one attempt; 1 today, >1 for item 6 tool loops
}
interface PartyMetrics {
  source: 'generated' | 'imported'
  calls: { planned: number; succeeded: number; failed: number; uncertain: number; canceled: number
           retries: number; errorCodes: Record<string, number> }
  latency: { medianMs: number | null; slowestMs: number | null; n: number }
  tokens: { medianInput: number | null; medianOutput: number | null; totalInput: number; totalOutput: number
            totalCachedInput: number | null; totalReasoning: number | null; unknownUsage: number }
  cost: { status: 'estimated' | 'partial' | 'no_price' | 'imported'
          perAnswerMedianMicroUsd: number | null; perThousandMicroUsd: number | null
          hearingMicroUsd: number | null; possiblyBilledUnknown: number }
  consistency: ConsistencyMetrics | null   // null when samplesPerAnswer = 1
}
```

Rules:
- **Totals** (this hearing, failures, retries) count every call that was made. **Per-answer medians and
  latency** use succeeded answers on eligible questions only. Every party is then measured on the same
  questions. The footnote says this.
- Latency uses succeeded attempts' `durationMs`. Failed durations are excluded (a fast 401 is not speed).
- `retries` counts attempts with `attemptNo = 2`.
- "Slowest" is the maximum, not a percentile. Percentiles mean nothing with 5–15 calls.

### 5.4 Consistency: `src/domain/consistency.ts` (new)

Per (question, party) with n ≥ 2 succeeded samples:

- **Same answer**: every pair is identical after normalization (Unicode NFC, trimmed, whitespace runs
  collapsed).
- **Wording overlap**: the mean pairwise Jaccard similarity of character 3-gram sets on lowercased,
  normalized text. Character n-grams are used instead of words so that untagged and non-space-separated
  languages (D-36) behave the same.
- **Length spread**: (max − min) / median of output tokens.
- **Answered every time**: all planned samples succeeded.

Party summary: questions with the same answer every time, median wording overlap, questions answered every
time, median length spread, and latency spread (slowest / median across all samples). The `ConsistencyMetrics` type has a
`byKit?: { agreement: number; key: string }` slot that later kits fill (§10).

## 6. Data model and migrations

Migration ids below assume item 2 lands `0007_case_origin` first. When landing, take the next free id
in `MIGRATIONS` (`src/server/db/migrations.ts`). Never edit an applied migration.

### 6.1 `0008_attempt_usage_details` (step 3, small, additive)

```sql
ALTER TABLE generation_attempts ADD COLUMN cached_input_tokens INTEGER CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0)
ALTER TABLE generation_attempts ADD COLUMN reasoning_tokens   INTEGER CHECK (reasoning_tokens   IS NULL OR reasoning_tokens   >= 0)
```

Old rows read `null` ("not recorded"). `ProviderSuccess` (`src/server/providers/common.ts`) gains
`cachedInputTokens` and `reasoningTokens`, both through `nonNegativeInt`. The adapters read them from
OpenAI `usage.input_tokens_details.cached_tokens` and `usage.output_tokens_details.reasoning_tokens`,
and from Anthropic `usage.cache_read_input_tokens`. Anthropic reasoning stays `null` because its usage
does not break thinking out. The implementer confirms these field names against the providers' docs and
records them in `docs/provider-contracts.md`. The request bodies do not change, so no adapter version
changes. The success commit in `generation.ts:264` writes the two columns.

### 6.2 `0009_generation_samples` (step 4, a table rebuild)

The `UNIQUE (run_id, case_key, configuration_key)` constraint cannot be altered in SQLite. The table is
rebuilt with `sample_no` and `UNIQUE (run_id, case_key, configuration_key, sample_no)`.

The **standard 12-step rebuild is unsafe here**. It assumes `PRAGMA foreign_keys = OFF`, which neither
D1 nor the Durable Object store lets a migration set. With foreign keys on, `DROP TABLE generations` runs
an implicit `DELETE` that **fires `ON DELETE CASCADE`** and would erase every attempt, outbox row and
reservation. `defer_foreign_keys` does not stop cascade actions.

The migration therefore rebuilds the parent and its three children together, **children dropped first**,
in one migration batch (one transaction on both stores):

1. `CREATE TABLE generations_next (…same columns…, sample_no INTEGER NOT NULL DEFAULT 1 CHECK (sample_no BETWEEN 1 AND 3), UNIQUE (run_id, case_key, configuration_key, sample_no))`,
   then `INSERT INTO generations_next SELECT …, 1 FROM generations`.
2. The same for `generation_attempts_next`, `outbox_next` and `attempt_reservations_next`, with
   identical columns and checks (including 6.1's columns), each `REFERENCES generations_next(id) ON DELETE CASCADE`.
3. `DROP TABLE attempt_reservations`, `outbox`, `generation_attempts`, then `generations`. Children go
   first, so nothing cascades. Their triggers drop with them.
4. `ALTER TABLE generations_next RENAME TO generations`. With `legacy_alter_table` off (the default on
   both stores), SQLite rewrites the children's `REFERENCES generations_next` to `generations`. Then rename
   the three children.
5. Recreate the indexes `generations_by_run_status`, `attempts_by_status_deadline` and `outbox_by_status`,
   and the triggers `generations_accepted_attempt_id_immutable` and
   `generation_attempts_output_text_status_finish_reason_immutable` (same names, same bodies via
   `immutable()`). Add `immutable('generations', 'run_id, case_key, configuration_key, sample_no', …)`.

Table names stay the same, so `BACKUP_TABLES` (D-32) is unchanged. Restore inserts by column name, so a
backup taken before this migration restores with `sample_no` defaulting to 1. **Before deploying,
take a V9 backup (`docs/runbook.md`).** If the store is large, run the migration once against a restored
copy first. The integration test in §9 checks every step above on both stores.

Rejected alternatives: (a) encoding the sample in `configuration_key` (`A#2`) avoids the rebuild but
breaks the meaning of a column that results, export, eligibility, the owner view and the special
master all join on. (b) Sibling "sample runs" collide with
`one_active_run_per_evaluation` and with every hearing list. (c) A parallel sample pipeline, like the
special master's `grader_*` tables, would duplicate claim, fence, lease and reservation code.

### 6.3 Draft, snapshot and manifest (no migration: JSON)

- `draftInputSchema` (`src/domain/contracts.ts`) gains `samplesPerAnswer: z.union([z.literal(2),
  z.literal(3)]).optional()`. When absent, the value is 1, so existing drafts and snapshots keep their
  hashes, as with `rubricVersion`. A refine rejects it when there are no generated parties.
- `RunSnapshot` gains an optional `samplesPerAnswer?: 2 | 3`. `buildSnapshot` copies it only when set. It is
  part of the hashed, immutable hearing plan.
- `startRun` creates `cases × generatedParties × samples` generations. Each gets the same
  `attempt_reservations` (attempt 1) and `outbox` rows as today.
- `computeEligibility` (`runs.ts`): a question is eligible when every generated party has **at least one**
  succeeded sample and every imported party has its answer. The manifest entry is the **primary
  sample**: the lowest-numbered succeeded sample. The entry gains an optional `sampleNo` (absent = 1), and
  `assignment_json` is unchanged. Picking the lowest number is deterministic and never selects by content.
  Failed samples still show in Failures and Consistency, so no failure is hidden.
- `autoOpenReview`: unchanged rule ("every planned call in and nothing to exclude"), now over every sample.
- Every `generations.find(g => g.case_key === … && g.configuration_key === …)` moves to two helpers in
  `runs.ts`, `samplesFor(generations, caseKey, configKey)` and `primarySample(…)`. They are used by
  `results.ts`, `export.ts`, `ownerRunView` and `computeEligibility`. `GenerationRow` gains `sample_no`.

## 7. API changes (`docs/api.md`)

Additive only, with no renames (v2 ground rule):

| Route | Change |
|---|---|
| `GET /catalog` | `limits.samplesPerAnswer` (deployment max, 1–3). `priceTable: {version, readOn, sources}`. In step 6, also per route `price` (for the draft-page ceiling) |
| `PUT /evaluations/:id/draft` | Accepts `samplesPerAnswer` (2 or 3). 422 if above the deployment max |
| `POST /evaluations/:id/runs` | No shape change. `plannedCalls` includes samples. Admission re-checks `samplesPerAnswer ≤` the deployment max |
| `GET /runs/:id` (owner) | `samplesPerAnswer`; `generations[].sampleNo`; `counts.planned` counts every sample |
| `GET /runs/:id` (reviewer), `GET/PUT /runs/:id/review` | **No change** (asserted by test) |
| `POST /runs/:id/retries` | `generationIds` max becomes `maxCases × maxConfigurationsPerRun × maxSamplesPerAnswer` (45) |
| `GET /runs/:id/results` | `samplesPerAnswer`; `priceTable: {version, readOn, sources, predates}`; `setupMetrics: Record<configKey, PartyMetrics>`; `cases[].responses[].sampleNo` (primary) and `cases[].responses[].samples[]` (`sampleNo, primary, status, errorCode, attemptCount, text, truncated, inputTokens, outputTokens, cachedInputTokens, reasoningTokens, durationMs`) when `samplesPerAnswer > 1`. `coverage` counts every call slot (identical to today at 1 sample) |
| `GET /runs/:id/export?format=json` | Adds `versions.priceTableVersion`, `setupMetrics` and `samples`, all covered by `certification.contentSha256`. CSV is unchanged (one row per rating) |

Config: `MAX_SAMPLES_PER_ANSWER` in `src/server/config.ts` (1–3, default 3; 1 turns repeats off).
`LIMITS.maxSamplesPerAnswer = 3` in `src/domain/limits.ts`. `Deps` gains `priceTables` (default
`PRICE_TABLES`) so tests can inject a fixture table.

## 8. Blinding, BYOK and security analysis

**Blinding (never weaker before unsealing):**
- Cost, latency, tokens, failures and consistency exist only in `getResults` and the export. Both refuse
  before `revealed`, as today. Nothing new reaches `reviewerRunView`, the review DTO, guest-juror
  projections (D-41), or RecordRoom notices (IDs only).
- Jurors see exactly one testimony per party per question. Extra samples' generation and attempt IDs never
  enter `assignment_json` or any reviewer payload. A test asserts that the 1-sample and 3-sample review
  DTOs have identical key sets and response counts.
- `samplesPerAnswer` is hearing-wide, never per party. Any per-party difference in sample count, timing
  or failure count therefore stays on the server and the judge's own (context-aware) view.
- The special master grades the manifest's primary answers only (its `plannedCalls` does not change).
- The judge already sees per-call durations before unsealing. That is unchanged. The new table appears
  only on the record, so the judge's own scores are not anchored on cost.

**BYOK and paid calls:**
- The table, prices and consistency make **no provider calls** and add no outbound host. Prices are code.
- Repeats use the existing path unchanged: outbox → job → guarded claim → send outside a transaction →
  fenced commit, with one reservation per sample. There is no automatic paid retry, and a manual retry
  is attempt 2 of 2 per sample. Cancel, deletion, revocation and pre-send failures release unclaimed
  sample reservations exactly as today.
- Consent: the Start dialog's call count includes samples, and `draftRevision` pins the draft the judge
  saw. A stale UI therefore cannot start a different number of calls.
- No key, ciphertext, credential ID or request ID is added to any response, log, job payload, export or
  audit row. The new usage fields are non-negative integers parsed through `nonNegativeInt`.

**Other:**
- Repeats can triple a hearing's burst (up to 45 calls). Provider 429s come back as
  `PROVIDER_RATE_LIMITED` (no automatic retry). Recommendation (open question 5): stagger samples by
  setting sample k's `outbox.next_dispatch_at = now + (k − 1) × 60 s`, so the minute cron dispatches
  them on later ticks.
- Response size: up to 45 texts at ≤ 16 KiB each (worst case about 720 KiB, typically under 100 KiB).
  Reads are already rate-limited (D-42), and results are fetched once per page load.
- The estimate is never shown as a charge. "Estimated", "list prices" and "your bill is the authority"
  appear next to every amount (in plain words, not court terms).

## 9. Limits and cost to the user

- The decision table and consistency are **free**: no calls, computed on read.
- Repeats multiply paid calls by 2 or 3, billed to the judge's keys. Under the default caps (20 calls a day
  per judge, 100 a day shared, 500 lifetime; `src/server/config.ts`):

  | Parties × questions | 1 sample | 2 samples | 3 samples |
  |---|---|---|---|
  | 2 × 5 | 10 | 20 ✓ | 30 ✗ |
  | 3 × 5 | 15 | 30 ✗ | 45 ✗ |
  | 2 × 3 | 6 | 12 ✓ | 18 ✓ |
  | 3 × 3 | 9 | 18 ✓ | 27 ✗ |

  ✗ means it exceeds the default per-judge daily cap. The draft says so before Start (§4).
- Reasoning routes reserve up to 8,704 output tokens per call (`LIMITS.reasoningHeadroomTokens`), so
  repeats on them cost the most. The cost column shows that after the fact. Step 6's pre-hearing ceiling
  would show it before.
- Juror workload is unchanged. The judge may read up to 2 extra answers per party per question on the
  record. That reading is optional.

## 10. How it reports for later task kits (items 3–6)

The table is the common place where every kit shows cost, speed and consistency. Asks of the kit
framework (item 3), not redefinitions:

- **Usage per testimony, not per call.** A kit's testimony may take several provider calls (item 6's
  tool loop, item 4's PDF input). Kits hand `setupMetrics` one `UsageRecord` per testimony, with summed
  tokens, wall-clock `durationMs` and `calls`. The table then adds a "Calls per answer" column when any
  `calls > 1`.
- **Consistency key.** A kit may export `consistencyKey(output): string | null`: the label (item 3
  classification), canonical JSON of the extracted fields (item 4), the sorted set of cited source
  numbers (item 5), or the tool-name sequence (item 6). With repeats, the table shows "same result in k
  of n samples" from that key, in `ConsistencyMetrics.byKit`. This means more than wording overlap, which
  stays as a fallback for `text` kits.
- **Check pass rate across samples.** Automatic checks run on every sample. The table shows "passes all
  checks in k of n samples" per party, next to (never inside) the jury's findings.
- **Structured-output tokens.** If item 4's provider structured-output modes add schema tokens to the
  input, they are billed input and need no special case.
- **Prices per route key.** Item 7's Gemini (or an OpenAI-compatible route) adds `RoutePrice` entries and
  `cachedInputIncludedInInput[provider]`, mapping its usage fields onto `inputTokens`, `outputTokens`,
  `cachedInputTokens` and `reasoningTokens`. A self-hosted endpoint gets `unpriced` with "you set the
  price", or an operator-supplied table (deferred). More than three parties only adds rows.
- **Item 2 (scenarios).** `setupMetrics` takes one hearing's rows and an explicit `PriceTable`, so
  `compareHearings` can price several hearings with one table and say which one.

## 11. Test plan

`npm run check` stays green (tsc, eslint, unit, integration on D1 and on the Durable Object store, smoke).

**Unit (vitest, `src/domain`):**
- `prices.test.ts`: every `MODEL_ROUTES` key is in `prices` or `unpriced` (not both). Published tables
  are frozen (a canonical-hash fixture per version, like the rubric-version tests). `priceTableFor`
  covers boundaries and `predates`. Cost formula per provider, including the cached-input rule, null
  tokens → unknown, and µUSD rounding.
- `setup-metrics.test.ts`: medians (odd/even), slowest, failed durations excluded, retries counted from
  `attemptNo = 2`, error-code tally, eligible-only medians against all-call totals, imported parties,
  `possiblyBilledUnknown`, and `calls > 1` aggregation.
- `consistency.test.ts`: identical, whitespace-only differences, disjoint text, CJK text, n = 2 and 3,
  partial failures, empty input.
- `contracts.test.ts` / snapshot tests: `samplesPerAnswer` accepts 2 and 3 and rejects 0, 1 and 4, and is
  rejected with imported-only parties. An absent value leaves existing snapshot hash fixtures unchanged.
- `quota.test.ts`: the repeat hint line and the planned count with samples.
- `adapters-v2.test.ts`: cached and reasoning tokens parsed; missing or non-integer values → null; request
  bodies byte-identical to before.
- Render tests: `SetupSection.render.test.tsx` covers the estimate label, unknown and no-price text, the
  imported row, the sentence for lead, close and tie, and the consistency column only with repeats.

**Integration (both stores, `tests/integration/`, new `setup-metrics.test.ts` and `generation-samples.test.ts`):**
- Migration `0009`: seed a store at the previous migration with hearings in every state (pending,
  claimed, succeeded, failed, uncertain, canceled; reservations reserved, consumed and released; outbox in
  each status). Apply. Row counts and values are unchanged and `sample_no = 1`. `sqlite_master.sql` for
  the children references `generations`. `PRAGMA foreign_key_check` is empty. Both immutability triggers
  still raise. Deleting a run still cascades.
- Backup: a backup taken before `0009` restores after it (`backup-restore.test.ts`), and
  `BACKUP_TABLES` passes.
- Admission: planned calls, generations and reservations equal Q × P × S. 3 × 5 × 2 under default caps →
  `QUOTA_EXHAUSTED` with nothing written. Above `MAX_SAMPLES_PER_ANSWER` → 422 at draft save and at
  admission.
- Pipeline: each sample is claimed and fenced independently. A retry of one sample leaves the others
  untouched. Cancel releases only unclaimed sample reservations. Lease expiry applies per sample.
  Optionally, the stagger respects `next_dispatch_at`.
- Primary and eligibility: sample 1 failed and sample 2 succeeded → eligible with primary 2. All samples
  failed → excluded. Auto-open happens only when every sample succeeded.
- Blinding: review DTOs for S = 1 and S = 3 have identical shapes. A juror or guest gets no results
  before reveal. Special master plans equal eligible × parties.
- Results and export: `setupMetrics` equals the expected values from seeded attempts with an injected
  fixture price table. The export contains it under the certification hash, and contains no IDs.
- Usage details: a fake-fetch success with cached and reasoning usage persists both columns, and
  results show them.

**Playwright (`tests/`, no keys needed):**
- Smoke: `/sample` after unsealing shows the illustrative table. axe passes in light and dark, and
  there is no horizontal scroll at 390 px.
- Signed-in flow (test accounts): an imported-only hearing (no calls) reaches the record. The table
  reads "Imported, not generated", and the stacked cards hold at 390 px.
- Draft: the Repeats control updates the paid-call count and shows the cap message for 3 × 5 × 2. The
  control is hidden for imported-only drafts.
- Generated metrics cannot be produced in Playwright without paid calls. They are covered by integration
  (fake fetch) and render tests, and the deployed check (V12) covers the real path when Avery runs one.

## 12. Delivery (session-sized steps)

Each step ends with `npm run check` green, `docs/api.md` updated where the API changes, and a D-entry in
`docs/decisions.md`.

1. **Prices and metrics, pure.** `src/domain/prices.ts` (first table read from the providers' pricing pages
   and cited in `docs/provider-contracts.md`), `setup-metrics.ts` and unit tests. No UI, API or migration.
   *Done when* every route is priced or listed as unpriced, with tests.
2. **Decision table on the record.** `getResults` adds `setupMetrics` and `priceTable`, and `Deps.priceTables`
   is added. New `src/components/record/SetupSection.tsx` (with `SetupTable`, shared with `/sample`),
   the SheetIndex entry, and the Reliability column cleanup. Export JSON fields. Render, integration and
   Playwright tests. *Done when* an unsealed record shows the table and footnote at 1280 and 390 px.
3. **Usage details.** Migration `0008_attempt_usage_details`, adapter parsing, the commit write, and the
   cached-input pricing path. *Done when* a fake-fetch success stores both fields and the estimate uses the
   cached rate.
4. **Repeats: data and server.** Migration `0009_generation_samples` (the rebuild), draft and snapshot
   field, admission and retry limits, `samplesFor`/`primarySample`, eligibility and primary,
   auto-open, owner run view `sampleNo`, catalog limit and `MAX_SAMPLES_PER_ANSWER`. No UI. *Done when*
   the migration and blinding integration tests pass on both stores.
5. **Repeats: UI and consistency.** The draft Repeats control with call count and cap message, hearing-page
   sample grouping, `consistency.ts`, the Consistency column and the "Read every sample" fold. *Done
   when* a seeded 3-sample hearing reads correctly and jurors' screens are unchanged (Playwright).
6. **Optional extras** (each small, only if Avery wants them): the pre-hearing rough cost ceiling on the
   draft (calls × (input chars ÷ 4 + output cap) × price, labeled "rough ceiling"), the table on the
   printable judgment (D-37), the special master's estimated cost line, and the judge's per-question
   consistency mark (same / minor differences / contradicts; owner-only table
   `sample_consistency_marks`, after unsealing).

Steps 1–3 are useful without repeats and avoid the risky migration, so they can ship first.

## 13. Open questions for Avery

1. **Who sees the table after unsealing?** Proposed: every participant (it is built only from tokens jurors
   already see after unsealing). The alternative is the judge only.
2. **What do jurors score with repeats?** Proposed: only the primary (lowest-numbered successful) sample,
   with no extra workload. The alternatives are every sample (2–3× the work, and same-party samples
   cluster) or a random sample per juror (mixes juror and sample variance).
3. **Prices:** is reading list prices from the providers' pages acceptable, kept as an append-only dated
   table? Should hearings that predate the first table use it, with a label (proposed)? Is "per 1,000
   answers" worth showing?
4. **Caps:** should `MAX_SAMPLES_PER_ANSWER` default to 3 (proposed) or 1 (off until you enable it)?
   Should the default 20-calls-a-day cap stay? At 20, 3 parties × 5 questions cannot use repeats.
5. **Stagger samples a minute apart** (proposed, to avoid provider rate limits on reasoning routes), or send
   them all at once (faster, more 429 risk)?
6. **Migration `0009` rebuilds four generation tables in place** on the live store, after a V9 backup. Is
   that OK, or would you rather ship steps 1–3 and stop?
7. **Step 6 extras:** which, if any, of the pre-hearing ceiling, the table on the printable judgment, the
   grader cost line, and the judge's consistency marks?
8. **Sample page:** is it fine to show illustrative cost and speed numbers on `/sample` (proposed),
   labeled as illustrative like the rest of the fixture?
