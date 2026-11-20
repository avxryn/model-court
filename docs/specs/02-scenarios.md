# Spec 02: Reusable scenarios and re-hearing

**Delivered** Nov 19, 2026: built on `claude/roadmap-1-3` and deployed to the live app (build `fbe5c5c`); decisions D-67–D-72 in `docs/decisions.md`. Open questions were answered with this spec's proposed defaults, for Avery to confirm. The status line below is the spec as first written.

Status: draft for review, Nov 18, 2026. Roadmap item 2 (`docs/roadmap.md`). Research only: nothing here is
built. Lands on a branch after the submission (Nov 20, 11:59 p.m. Eastern) and deploys only when Avery says so.

## 1. Problem and who it is for

A team that has set up a case (five questions, exhibits, jury instructions, a rubric) wants to ask the
same questions again later: "we changed the system prompt", "the provider shipped a new model", "does
the cheaper model hold up?". They want a new blind hearing with a different set of parties, without
retyping anything, and then to see how the hearings compare without being misled.

**What exists today is closer than it looks.** A case (`evaluations` row) already holds one mutable
draft (`draft_json`) and any number of hearings (`runs`). Each hearing freezes a `RunSnapshot`
(`src/domain/snapshot.ts`, `buildSnapshot`) with its own `snapshot_hash`, pinned keys (`run_credentials`),
reservations and generations. So a judge *can* re-hear today: unseal hearing 1, edit the Parties tab,
start hearing 2. What is missing:

| Gap | Today |
|---|---|
| G1. No notion of "the same questions" | Nothing tells the judge that hearing 2 asked exactly what hearing 1 asked. A stray edit to an exhibit between hearings silently makes them incomparable. |
| G2. No way back to an earlier hearing's setup | The draft is overwritten in place. To re-run hearing 1's parties after trying others, the judge retypes prompts from the record. |
| G3. No comparison across hearings | Each record stands alone. Jurors differ between hearings, so naive side-by-side scores mislead. |
| G4. No copy | A judge who wants a variant (add a question, try another rubric) without disturbing the original has to start from scratch, and cannot hand the scenario to a colleague. |

Who it is for: the judge (case owner). Jurors see nothing new; their view of a case stays "title and the
hearings I was summoned to" (`getEvaluation`, reviewer branch).

## 2. Scope and non-goals

In scope:

1. **Scenario fingerprint.** A pure, versioned hash of what is asked and how it is judged (questions,
   exhibits, jury instructions, conversation history, rubric version, message template, and later the
   task kit version). Hearings of one case are grouped by it: "Questions v1: hearings 1, 2; v2: hearing 3".
2. **Re-hear.** From any hearing, restore its frozen questions and/or parties into the draft, change the
   parties, and start a new hearing that is guaranteed (server-checked) to ask the same questions.
3. **Compare hearings** of the same case: side by side, never pooled, with an *anchor party* (a setup
   present in both hearings) as the only bridge for cross-hearing statements.
4. **Duplicate a case** (a copy that is a new case), from the current draft or from a hearing's snapshot.
5. **Scenario file**: export a case's questions (optionally parties) as JSON; import a scenario file or a
   certified record as a new case.
6. Limits: a hearings-per-case cap, the existing `ownEvaluationsPerUser` and call caps.

Non-goals:

- A separate "scenario" table or library. The case *is* the scenario; versions are fingerprints of
  frozen snapshots (no new mutable entity to keep in sync).
- In-app sharing between accounts, shared scenario libraries, cross-user or cross-case aggregation
  (roadmap "Deferred": no cross-customer aggregation). Sharing is a file the judge chooses to send.
- Pooling scores across hearings, statistical tests, or a ranking of setups across hearings.
- Reusing earlier testimony in a new hearing (open question Q4); every re-hearing regenerates.
- Repeat samples of the same setup within one hearing (item 1, `docs/specs/01-setup-metrics.md`).
- More than three parties in one hearing (item 7). Chaining hearings through an anchor is the
  interim way to look at more setups.

## 3. User flow

### 3.1 Case page (judge)

`HearingList` (`src/components/evaluations/HearingList.tsx`) groups hearings by scenario version, newest
first. Each row adds the parties in plain words once that hearing is unsealed (before that: party count
only, so a judge sharing a screen during deliberation does not show names), and a short "what changed"
line computed from the previous hearing in the same group: "Party B: model GPT-6.1 Terra → GPT-6.2 Sol",
"Party C added", "System instructions changed for Party A".

Above the list: "Draft questions match **v1** (hearings 1, 2)" or "Draft questions differ from every
hearing: the next hearing starts **v3**" with a "What changed" disclosure (questions added, removed,
edited; rubric changed).

### 3.2 Re-hear

On an unsealed (`revealed`/`decided`) or `canceled` hearing, the hearing page and the case's hearing row
offer **Re-hear with different parties**. The dialog (`RehearDialog`):

1. "Start from hearing 2's questions" (default on) and "Start from hearing 2's parties" (default on).
   If the draft already matches, the dialog says so and skips the restore.
2. Plain words: "This replaces your draft's questions and parties with hearing 2's. Hearing 2 itself never
   changes."
3. On confirm it calls `POST /evaluations/:id/draft/restore`, then opens the Parties tab with a banner:
   "Re-hearing v1. Questions are locked to hearing 2's; change only the parties." Editing questions is
   still possible (they are the judge's), but the banner turns into a warning: "These questions no longer
   match v1. Hearings on them cannot be compared with hearings 1–2."
4. **Start hearing** (`StartHearingDialog`) shows "Same questions as hearings 1–2 (v1)" and the paid-call
   preview, now split: "15 calls billed to your keys: 5 for Party C (new), 10 for parties already heard
   in hearing 2 (asked again, answers may differ)". It sends `expectedScenarioHash`, so a draft edited in
   another tab is refused instead of silently starting a different scenario.

A re-hearing is an ordinary hearing: new snapshot and hash, keys pinned at admission from the judge's
current keys, fresh reservations, every answer generated anew, new jury summons.

### 3.3 Compare

Case page: **Compare hearings** (enabled with two or more unsealed hearings) opens
`/evaluations/:id/compare`. The judge picks 2–5 unsealed hearings (default: the latest two of the newest
scenario version with at least two). The page shows, in this order:

1. **Can these be compared?** A checklist: same questions (or "4 of 5 questions in common; only those are
   used"), same rubric version, same message template, same kind of raters (jury vs the judge's own
   review), juror overlap ("1 of 3 jurors also sat on hearing 1"; "unknown for guest jurors").
2. **Each hearing on its own**: that hearing's headline (wins, ties, mean points per question from
   `src/components/record/headline.ts`), unchanged, one column per hearing. No cross-hearing totals.
3. **Through the anchor** (only when a party with the same fingerprint is in both hearings): for every
   other party, its mean difference from the anchor *within its own hearing*, on the common questions,
   with counts: "Hearing 1: Party B scored +0.8 points per question over the anchor (5 questions, 3
   jurors). Hearing 2: Party C scored +0.3 over the anchor (5 questions, 2 jurors)." The anchor's own
   score in each hearing is shown as **panel drift**: "The anchor scored 4.4 in hearing 1 and 3.9 in
   hearing 2. The juries differed, or the model changed behind the same name."
4. **Speed and cost** per party per hearing, from item 1's decision table when it exists.
5. The limits, in plain words: different people judged each hearing; the anchor comparison is indirect;
   small numbers; this is not a benchmark.

With no anchor, section 3 says "No setup was heard in both hearings, so scores across them are not on a
common footing" and shows nothing else.

### 3.4 Duplicate, export, import

Case actions (`CaseActions.tsx`) add **Duplicate case** ("Copy the questions [and parties] into a new case.
Hearings, testimony, worksheets and judgments are not copied.") and **Export scenario file** (warning:
"The file contains your questions, exhibits and jury instructions[, and your system instructions]. Anyone
you send it to can read them.").

`NewCaseDialog` adds **Import a scenario file**: accepts a scenario file or a certified record (JSON).
The browser parses it (`parseScenarioFile`), shows what will be created ("5 questions, rubric
reference-qa-v1, 2 parties; 1 party skipped: model not in this catalog"), the system instructions in
full if parties are included, and a note for records: "Only the questions are taken from this record;
testimony, worksheets and judgments are left out." Creation is one request.

## 4. Fingerprints (pure, `src/domain/scenario.ts`)

New browser-safe module, lint-clean under the `src/domain` rules (no I/O). All hashes use
`canonicalJson` + `sha256Hex` from `src/domain/canonical.ts`.

```ts
export const SCENARIO_HASH_VERSION = 'scenario-v1' as const

/** What a model is sent or a juror judges by. Excludes key, title and language (labels and grouping only). */
export function questionContent(c: CaseInput) {
  return { input: c.input, reference: c.reference, expectedBehavior: c.expectedBehavior, messages: c.messages ?? [] }
}
export async function questionHash(c: CaseInput): Promise<string>

export interface ScenarioSource { cases: CaseInput[]; rubricVersion: RubricVersion; messageTemplateVersion: MessageTemplateVersion; kitVersion?: string }
/** Order-independent: sha256(canonical({v, rubricVersion, messageTemplateVersion, kitVersion?, questions: sorted questionHashes})). */
export async function scenarioHash(source: ScenarioSource): Promise<string>
export function scenarioSourceOfSnapshot(s: RunSnapshot): ScenarioSource
export function scenarioSourceOfDraft(d: Draft): ScenarioSource // rubricVersion default, templateFor(d.cases)

/** A setup's identity, independent of its key and label. */
export async function partyFingerprint(c: SnapshotConfiguration, questionHashByCaseKey: Map<string, string>): Promise<string>
//  model:    {source:'model', provider, modelId, systemPrompt, maxOutputTokens}
//  imported: {source:'imported', provenance, answers: sorted [questionHash, sha256]}

export function diffScenarios(a: ScenarioSource, b: ScenarioSource): { added: string[]; removed: string[]; edited: Array<{ fromKey: string; toKey: string }>; rubricChanged: boolean; templateChanged: boolean }
export function diffParties(a: SnapshotConfiguration[], b: SnapshotConfiguration[]): PartyChange[] // added / removed / model / prompt / provenance
```

Choices and reasons:

- **Questions match by content, not by key.** CSV import and duplication mint new case keys
  (`parseCasesCsv(text, newId)`), so keys cannot carry identity across hearings or copies. Two questions
  with identical content are the same question.
- **Title and language tag are excluded**: fixing a typo in a question's title must not break
  comparability. `expectedBehavior` is included because it changes how jurors score. (Q7.)
- **`adapterVersion` is excluded from the party fingerprint** so an app upgrade (D-48) does not dissolve
  every anchor; the comparison lists "request format changed between hearings" as a caveat instead.
  `modelId` (what was sent) is used rather than `modelKey`.
- **No stored hash column.** The scenario hash is derived from `snapshot_json`, which is immutable
  (trigger `runs_snapshot_json_..._immutable`), so it can always be recomputed with the versioned function
  for old and new hearings alike, with no backfill. A future `scenario-v2` keeps `scenario-v1` code for
  reading. (Five questions per hearing and a capped hearing count make this cheap; see §8.)
- **Kits (item 3).** `kitVersion` and any kit-specific question fields enter `questionContent` (see §11).

## 5. Data model and migrations

One additive migration, appended to `MIGRATIONS` in `src/server/db/migrations.ts`:

```ts
{
  // Spec 02: where a case came from (duplicate, scenario file, certified record). Set once at creation.
  id: '0007_case_origin',
  statements: [
    `ALTER TABLE evaluations ADD COLUMN origin_kind TEXT CHECK (origin_kind IS NULL OR origin_kind IN ('duplicate','scenario_file','certified_record'))`,
    // Only for duplicates of the same owner's case; never an id taken from a file.
    `ALTER TABLE evaluations ADD COLUMN origin_evaluation_id TEXT`,
    `ALTER TABLE evaluations ADD COLUMN origin_run_id TEXT`,
    // Computed by the server from the copied questions, never taken from the file.
    `ALTER TABLE evaluations ADD COLUMN origin_scenario_hash TEXT`,
    immutable('evaluations', 'origin_kind, origin_evaluation_id, origin_run_id, origin_scenario_hash',
      'NEW.origin_kind IS NOT OLD.origin_kind OR NEW.origin_evaluation_id IS NOT OLD.origin_evaluation_id OR NEW.origin_run_id IS NOT OLD.origin_run_id OR NEW.origin_scenario_hash IS NOT OLD.origin_scenario_hash'),
  ],
}
```

- No FK on `origin_*_id`: the source case may be deleted and purged; the UI then says "copied from a case
  that was deleted". The purge in `src/server/services/maintenance.ts` needs no change (the columns live
  on the copy's own row and point at nothing sensitive).
- `BACKUP_TABLES` (`src/server/services/backup.ts`) needs no change: backup is `SELECT *` and restore
  inserts by column name. A backup/restore integration test covers the new columns.
- **No new tables.** Scenario versions, party changes, anchors and juror overlap are computed on read
  from `runs.snapshot_json`, `run_imported_outputs`, `review_sessions` and `reveal_cohort_json`.
- `evaluation_imports` is reused by restore and duplicate (rows copied from `run_imported_outputs` or
  from the source case's `evaluation_imports`, with recomputed `text_sha256` checked equal).
- `LIMITS` (`src/domain/limits.ts`) gains `hearingsPerEvaluation: 20`, `compareHearingsMax: 5`,
  `scenarioFileBytes: 128 * 1024`.

## 6. API changes (`/api/v1`, additive only; no renames, per D-24)

### 6.1 `GET /evaluations/:id` (owner branch only)

Adds, computed in `getEvaluation` (`src/server/services/evaluations.ts`):

- `draftScenarioHash`, `draftScenarioVersion` (the matching version number, or `null` = "next version").
- `runs[]` gain `scenarioHash`, `scenarioVersion` (1-based, display-only, by order of first appearance
  in the case), `partyCount`, and, **only when that hearing is `revealed`/`decided`**, `parties: [{key,
  label, fingerprint, source, provider, modelId}]` and `changes: PartyChange[]` versus the previous
  hearing of the same version.
- `origin: {kind, fromEvaluationId, fromRunId, scenarioHash, sourceDeleted}` or `null`.

The reviewer branch is unchanged (title and joined runs only).

### 6.2 `POST /evaluations/:id/draft/restore` (new; owner; If-Match; mutation rate limit)

Body `{fromRunId: uuid, questions: boolean, parties: boolean}` (at least one true; strict schema
`restoreDraftSchema` in `src/domain/contracts.ts`). The run must belong to this case (else the same 404 as
any invisible resource). Any status is allowed: the snapshot is frozen at admission.

- `questions`: draft `cases` and `rubricVersion` become the snapshot's (keys kept from the snapshot).
- `parties`: draft `configurations` and `comparisonMode` become the snapshot's, stripped back to
  `Configuration` (drop `provider`, `modelId`, `adapterVersion`, `source`, `imports`). For imported
  parties, `evaluation_imports` rows for those configuration keys are replaced from
  `run_imported_outputs`.
- When only one part is restored, imported answers whose case key no longer exists are dropped, as today.
- One guarded batch (`runGuarded`, guard: owner, revision = If-Match, not deleted), bumps `revision`,
  audit `evaluation.restore` with `{fromRunId, questions, parties}` (IDs and flags only).
- Validates the result with `draftInputSchema` and `configurationCapError` first; a snapshot whose
  parties exceed today's `MAX_CONFIGURATIONS_PER_RUN` returns 422 rather than saving an unrunnable draft.
- Response `{revision, draft, imports}`. Makes no provider call; spends no budget.

### 6.3 `POST /evaluations/:id/runs` (start a hearing)

- `startRunSchema` gains optional `expectedScenarioHash` (64 lowercase hex). When present and different
  from `scenarioHash(scenarioSourceOfDraft(draft))`, admission throws 409 `STATE_CONFLICT` with
  `details: {scenarioChanged: true, scenarioHash}` before any statement runs (no reservation, outbox,
  or pin is written). The draft revision check already covers concurrent edits; this covers "the
  draft I am starting is not the scenario I meant".
- New guard in the `run.start` batch: `(SELECT COUNT(*) FROM runs WHERE evaluation_id = ?) <
  LIMITS.hearingsPerEvaluation`, explained by `explainAdmissionFailure` as 429 `QUOTA_EXHAUSTED`
  "This case has 20 hearings, the most it can hold. Duplicate the case to keep going."
- Response `data` adds `scenarioHash`. Note: `requestHash` covers the new field, so a replay with a
  different expectation is an `IDEMPOTENCY_CONFLICT`, as intended.
- Everything else (consent flags, `credentialIdsByProvider`, capacity, budget, outbox) is untouched.

### 6.4 `GET /evaluations/:id/comparison?runIds=a,b[,c…]` (new; owner only)

- 2–`compareHearingsMax` distinct run IDs of this case, each `revealed` or `decided`; otherwise 409
  `STATE_CONFLICT` naming the sealed hearing. Jurors and guest cookies get 404 (the guest allowlist in
  `api.ts` never matches `/evaluations/*`).
- Service `src/server/services/comparison.ts` loads each run through the same code as `getResults`
  (extract a shared `loadScoredRun(db, runId)` from `src/server/services/results.ts` so scoring is never
  reimplemented), then calls the pure `compareHearings` in `src/domain/scenario.ts`.
- Response:

```ts
{
  hearings: Array<{ runId; createdAt; revealedAt; scenarioHash; scenarioVersion; rubricVersion; messageTemplateVersion;
                    raterSource: 'jury' | 'judge'; raterCount; guestRaterCount;
                    parties: Array<{ key; label; fingerprint; source; provider; modelId; meanPoints: number | null; questions: number }> }>
  questions: Array<{ questionHash; title; presentIn: string[] }>   // title from the newest hearing
  commonQuestionCount: number
  comparable: { sameQuestions: boolean; sameRubric: boolean; sameTemplate: boolean; sameRaterSource: boolean; adapterChanged: boolean }
  jurorOverlap: Array<{ runIds: [string, string]; shared: number; knowable: number }>  // counts only, signed-in jurors only
  anchors: Array<{ fingerprint; label; byHearing: Record<runId, { meanPoints; questions; raters }> }>
  relative: Array<{ runId; configurationKey; anchorFingerprint; meanDiff; better; worse; tied; questions; raters }>
  caveats: Array<'different_juries' | 'few_raters' | 'questions_partial' | 'rubric_differs' | 'template_differs' | 'rater_source_differs' | 'adapter_changed' | 'no_anchor'>
}
```

Math (in `compareHearings`, mirroring D-60's headline so the numbers match the record):

- A party's points on a question = its three rubric lines summed (0–6), averaged over the raters of the
  hearing's rater source. Rater source per hearing: the jury if any juror filed, else the judge's own
  review; the two are never combined.
- Only questions whose `questionHash` is in **every** selected hearing are used; only eligible questions
  of each hearing (`eligible_manifest_json`).
- `relative`: within one hearing, per common question, party points minus anchor points, then the mean
  over those questions, plus counts of questions where the party was better, worse or tied.
- Nothing is computed across hearings except putting the anchor's own `meanPoints` side by side.
- When `sameRubric` is false, `meanPoints` and `relative` are still returned per hearing, but the page
  shows them in separate tables and says the scales differ.

### 6.5 `GET /evaluations/:id/scenario?fromRunId=&includeParties=true|false` (new; owner)

Returns a scenario file as JSON (`Content-Disposition: attachment; filename="<docket>-scenario.json"`):

```json
{
  "format": "model-court-scenario", "formatVersion": 1, "exportedAt": "2026-…Z",
  "scenarioHashVersion": "scenario-v1", "scenarioHash": "…",
  "title": "…", "taskDescription": "…",
  "rubricVersion": "reference-qa-v1", "messageTemplateVersion": "qa-v1",
  "questions": [{ "title", "input", "reference", "expectedBehavior", "messages"?, "language"? }],
  "parties": [{ "label", "modelKey", "provider", "modelId", "systemPrompt" }] // only with includeParties
}
```

From the draft, or from a hearing's snapshot when `fromRunId` is given. Never included: case/run/party/
credential/session/user IDs, keys, imported answers, testimony, ratings, judgments, provenance of imported
parties (imported parties are left out; the file says how many). Audit `scenario.export` (IDs, flags).

### 6.6 `POST /evaluations` (create) and `POST /evaluations/:id/duplicate`

- `createEvaluationSchema` gains optional `draft` (`draftInputSchema`) and optional `origin: {kind:
  'scenario_file' | 'certified_record'}`. With `draft`, the case starts with it instead of the seeded
  example, after `configurationCapError`. `origin_scenario_hash` is computed by the server from that
  draft. Same quota guard as today (`ownEvaluationsPerUser`), so an import is atomic: no half-made case.
- `POST /evaluations/:id/duplicate` (owner; Idempotency-Key; mutation rate limit), body `{title,
  fromRunId?: uuid, includeParties: boolean, includeImportedAnswers?: true}`. Copies the draft (or that
  hearing's snapshot, stripped as in §6.2) into a new case with fresh case and party keys (a key map
  carries imported answers). Without `includeParties`, the new case gets the default parties from
  `defaultModelKeys`. Sets `origin_kind='duplicate'`, `origin_evaluation_id`, `origin_run_id`,
  `origin_scenario_hash`. Never copies runs, sessions, invites, verdicts, grader runs, or `run_credentials`.
  `includeImportedAnswers` requires `includeParties` and carries the same `confirmMayShareWithJurors`
  meaning; the UI repeats that confirmation. 201 `{id, revision}`.

### 6.7 Scenario file parser (`src/domain/scenario-file.ts`, pure, browser-side like D-30)

`parseScenarioFile(text, newId, routes) → {ok: true, draft, title, taskDescription, origin, notices} |
{ok: false, issues}`:

- Byte cap `LIMITS.scenarioFileBytes`; `JSON.parse` in a try; strict Zod schemas for both formats
  (unknown top-level fields rejected).
- `model-court-scenario` v1: questions → `CaseInput` with fresh keys; each validated with
  `caseInputSchema`, the whole draft with `draftInputSchema`.
- `model-court-certified-record` v1: takes `cases[].{title,input,reference,expectedBehavior,messages,
  language}` and `versions.rubricVersion` only; ignores `responses`, `ratings`, `findings`, `verdicts`.
  Optionally takes `configurations` as parties (record parties carry `provider`, `modelId`,
  `systemPrompt`), mapped to a catalog `modelKey` by `(provider, modelId)`; unmatched ones are skipped with
  a notice. The `certification.contentSha256` is recomputed and shown as "matches its certification" or
  "edited since export"; informational only, never a reason to trust the content.
- Parties beyond the deployment cap, imported parties, and unknown models become notices, not errors.
  Fewer than two parties → the default pair fills in, with a notice.
- The server re-validates everything (`createEvaluation`), as with CSV import.

## 7. Blinding, BYOK and security analysis

**Blinding before unsealing never weakens.**

- Jurors' projections (`getReview`, `reviewerRunView`, reviewer `getEvaluation`) are unchanged. Scenario
  versions, party lists, changes, comparisons, and origins are owner-only fields or owner-only routes.
- The owner view lists a hearing's parties only once it is unsealed (§6.1); before that, a count.
- Every re-hearing reshuffles: new generations, new `buildAssignment` per session, new response IDs.
- **Repeat jurors (new risk).** A juror who sat on unsealed hearing 1 and is summoned to hearing 2 has
  seen the anchor's testimony with its name. Same model and prompt give similar answers; an imported anchor
  gives *identical* text. Mitigation (default, Q1): at reveal time nothing changes, but the owner-only
  results and comparison mark such seats: "Juror 2 also sat on hearing 1 (unsealed), which shares a party
  with this hearing. Their findings may not be blind." Computed in `loadScoredRun` from
  `review_sessions.reviewer_user_id` across earlier revealed runs of the same case with a shared party
  fingerprint; guest jurors (`mcj_` principals are per hearing) are reported as "unknown". The flag counts
  like `identityClueFlag` toward `potentiallyUnblindedCount` in the comparison caveats, never in the
  hearing's own scored cohort (that would change recorded results). The summons card (`JuryPanel`) adds
  a line for the judge: "If you summon someone who saw hearing 1's unsealed record, their findings on a
  party shared with it may not be blind."
- Restoring an imported party into a re-hearing re-uses its exact text; the Parties tab warns "Jurors of
  earlier hearings have seen these exact answers".
- Hearing rows never show party names to anyone but the judge; the case title and task description are
  judge-written and unchanged in scope.

**BYOK.** No new paid path. Restore, duplicate, import, export and compare make no provider call and
touch no budget. A re-hearing goes through the existing `startRun`: consent flags, keys owned by the
judge and active at commit time, pins written at admission, outbox → guarded claim → send outside a
transaction → fenced commit, no automatic paid retry. Retries and re-pinning (D-57, migration `0006`)
stay inside one unfinished hearing; a re-hearing never inherits pins, attempts or reservations from the
hearing it came from. Scenario files and duplicates never contain credential IDs or key material, and
`run_credentials` is never copied.

**Untrusted files.** A scenario file or record from someone else is data: parsed in the browser with
strict schemas, re-validated on the server, rendered by React only (no `dangerouslySetInnerHTML`), capped
in bytes. Its system instructions and exhibits will be sent to providers at the next hearing; the
import screen shows them in full, and the existing hearing consent covers sending. No field from a file
becomes an ID, a hash the server trusts, a URL, or a model route outside the catalog. Formula injection
does not apply (JSON, no CSV export added).

**Privacy and deletion.** Duplicates are independent cases: deleting the source does not delete the copy,
and vice versa (stated in the delete dialog of a case that has copies: "1 copy of this case is not
deleted"). Exported files leave the app; the export dialog says so in plain words. Audit rows carry IDs,
flags and counts only.

**Access.** Every new route resolves `loadEvaluationAccess` + `requireOwner` first (owner check before
any state check, per security-review finding 9). `fromRunId` and `runIds` must belong to the path's case;
otherwise the same 404. Comparison reads count against the 120/min read limit (D-42); restore, duplicate
and create count against the mutation limit (D-13).

## 8. Limits and cost

| Limit | Value | Where | Why |
|---|---|---|---|
| Cases per judge | 10 (`ownEvaluationsPerUser`) | unchanged guard in `createEvaluation`, reused by duplicate and import | Re-hearing inside one case does not count; copies and imports do. The UI suggests re-hearing over duplicating for "same questions, new parties". |
| Hearings per case | 20 (`hearingsPerEvaluation`, new) | `run.start` guard | Re-hearing makes unbounded runs per case likely. Worst case per hearing: 96 KiB snapshot + 15 outputs × 16 KiB ≈ 340 KiB, so ≈ 7 MB per case, 70 MB per judge. Canceled hearings count (they hold a snapshot). (Q2) |
| Unfinished hearings per case | 1 (`one_active_run_per_evaluation`, includes `reviewing`) | unchanged | Re-hear starts after unsealing or canceling. (Q3) |
| Hearings per comparison | 5 (`compareHearingsMax`) | comparison route | Keeps one read to ≤ 5 results loads. |
| Scenario file | 128 KiB | parser and body cap | Same as CSV import and request body caps. |
| Provider calls | unchanged per-user daily (default 20), global daily (100), lifetime (500) | `reserveBudget` | A three-party, five-question re-hearing is 15 calls, most of a day's default allowance; the anchor alone is 5 of them. |

Cost in plain words on Start: "This hearing makes 15 calls billed to your keys. 10 of them ask parties you
already heard again; that is what lets you compare hearings fairly." The quota standing (`/quota`, D-59)
already explains when Start is blocked.

## 9. Test plan

**Unit (vitest, `src/domain/scenario.test.ts`, `src/domain/scenario-file.test.ts`):**

- `questionHash` is unchanged by key, title or language edits; changes with input, reference,
  expected behavior, or any message.
- `scenarioHash` ignores question order; changes with a question added/removed/edited, rubric version,
  template version, `kitVersion`; `scenario-v1` golden value pinned for a fixed draft (guards silent drift).
- `scenarioSourceOfDraft(draft)` and `scenarioSourceOfSnapshot(buildSnapshot(draft…))` hash equal
  (start-time check and read-time grouping agree), including drafts without `rubricVersion`.
- `partyFingerprint` ignores key/label/adapterVersion; changes with systemPrompt or modelId; imported
  parties keyed by question content, not case key.
- `diffScenarios`/`diffParties`: added, removed, edited, model and prompt changes.
- `compareHearings`: anchor difference on a hand-computed fixture; only common questions; ineligible
  questions excluded; jury vs judge source chosen per hearing and never mixed; no anchor → no `relative`;
  differing rubric → `rubric_differs`; repeat-juror caveat; numbers equal `headline.ts` for one hearing.
- `parseScenarioFile`: both formats, fresh keys, strict unknown-field rejection, byte cap, malformed JSON,
  record responses/ratings ignored, unmatched model notices, party cap notices, certification recompute.
- `restoreDraftSchema`, extended `startRunSchema` and `createEvaluationSchema` accept/reject cases.

**Integration (`tests/integration/scenarios.test.ts`, run on D1 and on the Durable Object store):**

- Restore questions only / parties only / both; imported answers restored byte-for-byte; revision bump;
  If-Match conflict; run of another case → 404; juror → 404; earlier hearing's `snapshot_json`/hash
  unchanged afterwards.
- Re-hearing: new pins from current keys (old hearing's pin to a removed key does not matter), fresh
  reservations, all generations planned, old hearing rows untouched.
- `expectedScenarioHash` mismatch → 409 and zero new rows in `runs`, `run_credentials`, `outbox`,
  `attempt_reservations`, `budget_buckets` unchanged; match → 202.
- Hearing cap: 21st start → 429, nothing written.
- Owner `getEvaluation`: versions and changes; parties hidden while a hearing is `reviewing`.
- Comparison: sealed hearing → 409; juror and guest cookie → 404; anchors and relative values on a seeded
  fixture (imported parties make seeding call-free); repeat juror flagged for the owner only.
- Duplicate: quota guard at 10; idempotent replay; fresh keys; no runs/sessions/verdicts/credentials
  copied; imported answers only with the flag; origin columns set; trigger refuses an update to them.
- Create with `draft`: validated (unknown field 422, cap 422), atomic with the quota guard.
- Scenario export: contains no credential, run, session, user IDs or invite tokens (scan the body for
  every ID in the fixture and for `sk-`); `fromRunId` variant matches the snapshot.
- Backup/restore round trip keeps `origin_*`; delete + purge of a source case leaves its copy intact.

**Playwright:** paid calls are off in tests, so flows use all-imported hearings (no provider calls,
`startRun` skips the generation switch for them, D-38).

- `tests/api.spec.ts`: new routes' status codes, error codes and owner-only behavior with two accounts.
- New `tests/scenarios.spec.ts`: case with two imported parties → hearing 1 → judge files and unseals →
  Re-hear → replace Party B's answers → start → "Same questions as hearing 1" shown → unseal → Compare
  shows the anchor sentence and the caveats; Export scenario → Import as a new case → same version badge.
- Smoke/axe (D-55) covers only public pages; the compare page gets an axe check inside the signed-in spec.

## 10. Delivery (session-sized steps)

Each step ends with `npm run check` green on both stores and a decisions entry (next free D-number).

1. **Fingerprints.** `src/domain/scenario.ts` (`questionHash`, `scenarioHash`, sources, `partyFingerprint`,
   diffs) with unit tests and the golden hash. No API change. *(half a session)*
2. **Versions on the case page.** Owner `getEvaluation` additions (§6.1), `HearingList` grouping and
   "what changed" lines, draft-vs-versions banner. Integration tests. *(1 session; needs 1)*
3. **Re-hear.** `restoreDraftSchema` + `POST /draft/restore`, `expectedScenarioHash` and the hearing cap
   in `startRun`, `RehearDialog`, split paid-call preview, imported-anchor warning, Playwright flow.
   *(1 session; needs 1)*
4. **Compare.** Extract `loadScoredRun` from `results.ts`, `compareHearings`, `GET /comparison`, repeat-
   juror detection, the compare page (route move: `evaluations/[id].tsx` → `evaluations/[id]/index.tsx`
   plus `compare.tsx`, matching `runs/[id]/`). *(1–2 sessions; needs 1; independent of 3)*
5. **Copy and share.** Migration `0007_case_origin`, `POST /duplicate`, `GET /scenario`, `draft`/`origin`
   on create, `src/domain/scenario-file.ts`, Duplicate/Export/Import UI. *(1–2 sessions; needs 1;
   independent of 3 and 4)*
6. **Docs.** `docs/api.md` rows, `docs/architecture.md` note, verification entry, glossary entries
   ("scenario version", "anchor party"). *(with the last step)*

## 11. Asks of the kit framework (item 3)

- Kit-specific question data (answer keys, JSON Schemas, numbered sources, tool definitions and mock
  responses) must live in `CaseInput` (or a field the snapshot freezes), so `questionContent` can hash it.
  Spec 03 should name those fields; `questionContent` will include every kit field that is sent to a
  party or shown to jurors or used by a check.
- The snapshot must record `kitVersion` (and `messageTemplateVersion` as today), so `scenarioHash`
  includes it and two hearings under different kit versions are different scenario versions.
- Check results (pass/fail per party) should be exposed per hearing in the same shape `compareHearings`
  can show next to the anchor (counts per party), never mixed into the jury's points.
- Item 1's per-party cost/latency table should be a pure function of one hearing's results so the
  comparison page can lay several side by side.

## 12. Open questions for Avery

1. **Repeat jurors.** A juror who saw hearing 1 unsealed is summoned to hearing 2, which keeps a party:
   label their findings as "may not be blind" (proposed), or refuse the seat?
2. **Hearings per case.** Cap at 20 (proposed), another number, or no cap?
3. **Overlapping hearings.** Keep one unfinished hearing per case including deliberation (proposed), or
   allow starting hearing 2 while hearing 1 is still with the jury?
4. **Reusing the anchor's answers.** Regenerate every party on re-hearing (proposed: honest, costs more),
   or offer "carry hearing 1's answers for the anchor" as an imported party (saves calls; repeat jurors
   would see identical text)?
5. **Sharing.** File export/import only (proposed), or also an in-app "send to another account" later?
6. **Parties in exported files.** Off by default (proposed: system instructions are often the
   confidential part), or on?
7. **Fingerprint content.** Exclude question titles and language tags (proposed), or treat any change as a
   new version?
8. **Hearing notes.** Add an owner-only note per hearing ("after prompt v3") shown in the list and the
   comparison, or rely on the automatic "what changed" lines (proposed for now)?
9. **Comparison export.** Is a certified comparison (like the certified record) wanted, or is the page
   enough for now?
