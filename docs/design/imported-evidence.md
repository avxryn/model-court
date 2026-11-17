# Design note: imported evidence (phase 4)

Status: **built on `next`, Nov 17, 2026 (D-38).** Covers S3c (blind review of existing transcripts) and the S4 human baseline.
Differences from this proposal: provenance is edited with the draft (the imports endpoint takes only answers and a sharing confirmation), the run-start consent flags stay required, and the open questions were settled as D-38 records.

## Goal

The judge can add a **party whose responses were not generated here**: a human-written baseline next to a
model, or two sets of transcripts exported from production. Jurors review imported and generated
testimony the same way. After the record is unsealed, every surface labels imported evidence with its
source.

## Where it fits in today's code

- A party is a `Configuration` in `draft_json` (`src/domain/contracts.ts`) and becomes a
  `SnapshotConfiguration` with `provider`, `modelId`, and `adapterVersion` (`src/domain/snapshot.ts`).
- A response is reviewable only through `generations` → `accepted_attempt_id` → `generation_attempts.output_text`.
  `computeEligibility` and `buildAssignment` (`src/server/services/runs.ts`) both read that chain, and
  `getReview` (`reviews.ts`) loads texts by attempt ID.
- `generations.provider` has `CHECK (provider IN ('openai','anthropic'))`. SQLite cannot relax a CHECK
  without rebuilding the table, and the FKs plus immutability triggers make a rebuild risky
  (see [conversations.md](conversations.md)). **Imported text therefore must not pretend to be a generation.**
- `draft_json` and `snapshot_json` are each capped at 96 KiB (`LIMITS`). Five cases × two imported parties ×
  16 KiB would exceed the cap, so imported text cannot live inline in either one.

## Data model (migration `000N_imported_evidence`, additive only)

1. **Draft party kind.** `configurationSchema` becomes a discriminated union on a new optional `kind`.
   A missing `kind` means `'model'`, so stored drafts stay valid. The new member is
   `{ kind: 'imported', key, label, provenance }`, where `provenance` =
   `{ sourceType: 'human_baseline' | 'transcript_export' | 'other', description (1–500), collectedOn?: ISO date, redacted: boolean }`.
   No field is renamed.
2. **`evaluation_imports`** (draft side, mutable): `evaluation_id` FK, `configuration_key`, `case_key`, `text`,
   `text_sha256`, `byte_length`, `created_at`, `updated_at`, `PRIMARY KEY (evaluation_id, configuration_key, case_key)`.
   Every write bumps `evaluations.revision`, so the existing `draftRevision` guard in `startRun` covers imports.
3. **`run_imported_outputs`** (evidence side, immutable): `id`, `run_id` FK `ON DELETE CASCADE`, `configuration_key`,
   `case_key`, `text`, `text_sha256`, `byte_length`, `created_at`, `UNIQUE (run_id, configuration_key, case_key)`,
   and a trigger that refuses every `UPDATE` (the same pattern as `verdict_revisions_append_only`). `startRun` copies the rows in
   the same guarded batch that inserts the run.
4. **Snapshot.** An imported `SnapshotConfiguration` gets `source: 'imported'`, `provenance`, and
   `imports: [{ caseKey, sha256, byteLength }]`, and has no provider, model, or adapter. The texts stay out of
   the snapshot; their hashes are inside it, so `snapshot_hash` commits to the exact imported bytes.
   `schemaVersion` stays 1, and readers treat a missing `source` as `'generated'`.
5. **Eligibility and assignment.** Add `outputRef: { kind: 'attempt' | 'import', id }` to `EligibleManifest.entries`
   and `AssignmentCase.responses`. Keep `acceptedAttemptId` for old manifests, which are immutable once
   set. A case is eligible only when every generated party succeeded and every imported party has a row.

Hashing: `sha256Hex` of the exact UTF-8 text, with no normalization (the same rule as `sorted-json-v1`).
Text is validated like case input (a code-point limit) plus `hasDisallowedControlChars` (today used only
for API keys), and capped at `LIMITS.providerOutputBytes` (16 KiB), the ceiling for a generated output.

## API changes (no renames)

- `PUT /api/v1/evaluations/:id/imports/:configurationKey`: `If-Match` on the evaluation revision. Body:
  `{ provenance, items: [{ caseKey, text }] }`. Owner only. Replaces that party's imports and returns the new
  revision. `DELETE` on the same path removes them.
- `GET /evaluations/:id` (owner view) adds import metadata and texts for the editor. The reviewer view is unchanged.
- `startRun`: when every party is imported, the run makes no provider calls. Credentials must then be an empty
  record, the consent and charge flags may be omitted (refinement: required only when a generated party
  exists), the run is inserted as `ready`, no budget is reserved, and `plannedCalls` = 0. A mixed run
  reserves only for generated parties.
- Readiness: a new `ReadinessIssue` `imported_requires_configuration_mode`. Model-comparison checks (same
  system prompt, different models) make no sense for an imported party.
- `retryGenerations` never selects imported parties. Results add `source` and `provenance` per
  configuration, and coverage shows "imported" instead of a success rate or latency.
- Phase 2 CSV import and the certified record reuse these: the record includes provenance and each `sha256`.

## Security and blinding risks

- **The system must not leak the source.** Reviewer projections (`getReview`, `reviewerRunView`) are allowlists, and
  `outputRef.kind` never leaves the server. The response shape stays `{ responseId, label, text }`.
- **The content can leak the source.** Generated text is capped at 512 output tokens, while imported text
  can be up to 16 KiB. Human writing has its own tells: signatures, timestamps, ticket numbers, "Hi team",
  plain-text formatting next to markdown. That is content, not a system leak, but jurors would see it. The editor
  runs owner-side **blinding lint** before a hearing can start (warnings, never edits): a length ratio against
  the generated cap, emails, URLs, names, dates, and greeting or sign-off lines. The owner may redact. That sets
  `provenance.redacted = true`, and the record says so. The juror's existing `suspectedIdentityClue` flag covers the rest.
- **Untrusted text.** Imported text is rendered as plain text (React-escaped, with no HTML or markdown execution). It is
  never sent to a provider, except to the phase 6 special master, whose consent copy must say "including
  imported responses".
- **Personal data.** Imported transcripts may contain customer data. The import dialog requires a plain-words
  confirmation that the judge may share the text with jurors. Deletion purges it with the evaluation (FK cascade).
- **Immutability.** Draft imports may change; `run_imported_outputs` may not. A test proves that editing a draft
  import after a hearing starts changes neither that hearing's texts nor its hash.

## Tests needed

- Unit: snapshot hash changes when any imported byte changes; readiness issue; `computeEligibility` with
  mixed parties; shuffle puts imported entries in each position at the expected rate (seeded statistical check).
- Integration, on both stores (D1 and `ModelCourtStore`): copy-on-start; the trigger refuses `UPDATE`; an all-imported
  hearing needs no key, never calls `providerFetch` (spy), and reserves no budget; a mixed hearing reserves only
  generated calls; extend **T10 blinding** so the reviewer's `/review` and `/runs/:id` bodies have identical
  key sets for imported and generated responses and contain no provenance strings, `source`, or `outputRef`;
  results label provenance; purge removes both tables' rows.
- Playwright: judge imports a human baseline, a juror reviews it, and the unsealed record shows "Imported (human baseline)".

## Open questions

1. Should the editor enforce length parity (for example, truncating or refusing imported text longer than about 4× the
   generated cap), or only warn?
2. How should multi-turn transcripts be handled before phase 5? Proposal: phase 4 imports one response per case, and phase 5's `messages[]`
   type (defined once in `src/domain`) also carries imported history.
3. May the owner edit imported text after import, beyond redaction? If yes, should the original hash be recorded too?
4. Should jurors get a dedicated clue option ("looks human-written"), or does the generic flag suffice?
