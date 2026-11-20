# Design note: special master (phase 6)

Status: **built on `next`, Nov 17, 2026 (D-40)**, with the departures D-40 lists. Covers S4 LLM-judge calibration (spec §16.3 item 5). In plain words:
**an AI grader that is advisory and billed to the judge's own API key.**

## Principles

1. **BYOK only.** Grader calls use the judge's saved key through the same credential path as hearings
   (`withRunCredential`, expiry and revocation checks, `last_used_*`). There is no platform payer and no fallback key.
2. **A separate class.** Grader scores never enter `review_sessions`, `scoreCohort`, `findDisagreements`, the
   jury's findings, or the verdict form. They live in their own tables and their own section of the record.
3. **After unsealing only.** A grader run can start only when the hearing is `revealed` or `decided`. Before
   reveal there is therefore no new surface, so pre-reveal blinding needs no new proof, and calibration
   always has the jury's findings to compare against.
4. **Calibration before reliance.** The section shows agreement with the jury *first*. The grader's own
   per-party totals sit below it, collapsed, with the sample size stated.

## Where it fits in today's code

- Evidence comes from the frozen `eligible_manifest_json` and the accepted attempts, the same inputs `getResults` reads.
- The paid-call machinery to reuse: outbox → JobRoom → guarded claim with a fence token → send outside a
  transaction → fenced commit (`generation.ts`); budget reservation against `user:`/`global:day`/`global:lifetime`
  (`reserveBudget`); credential binding per hearing (`run_credentials`, immutable).
- `messages.ts` promises that the scoring guide (`expectedBehavior`) is never part of a provider request.
  That promise is about the **parties**. A grader cannot grade without the guide, so the copy must say plainly:
  "The scoring guide is sent to the AI grader. It is still never sent to the models being compared."

## Data model (migration `000N_special_master`, additive)

- `grader_runs`: `id`, `run_id` FK cascade, `owner_user_id`, `status ('generating','ready','canceled')`,
  `config_json` (`{ modelKey, provider, modelId, adapterVersion, graderTemplateVersion: 'grader-v1', rubricVersion }`),
  `config_hash`, `revision`, `created_at`, `updated_at`. An immutability trigger covers `config_json` and `config_hash`.
  At most 3 per hearing (so the judge can compare graders), with one active at a time.
- `grader_credentials (grader_run_id, provider, credential_id)`, immutable, the same as `run_credentials`.
- `grader_items`: one per (eligible case, party), holding `case_key`, `configuration_key`, `status`, `attempt_count`,
  `accepted_attempt_id`, and `UNIQUE (grader_run_id, case_key, configuration_key)`.
- `grader_attempts`: shaped like `generation_attempts`, plus `parsed_json` (validated scores and note), with the
  same immutability trigger. `grader_outbox` and `grader_reservations` mirror `outbox` and `attempt_reservations`.
  Separate tables are needed because those tables have FKs to `generations`.

A shared "paid call" helper (claim, fence, send, commit) should be extracted from `generation.ts` first, so
graders and hearings cannot drift. It is a refactor with no behavior change, covered by the existing T05–T07, T17, T18, and T33 tests in
`tests/integration/generation.test.ts`.

## Grader prompt (`grader-v1`)

**Pointwise, one call per (case, response).** That gives the same 0/1/2-per-dimension shape as a juror rating, so
agreement is computed like for like, and no other response is in context, which removes position bias. The
request holds the rubric anchors (`RUBRIC`), the case input and reference, the scoring guide, and the one
response, all wrapped as data like `qa-v1`. It has **no** party label, model ID, provider name, or other
response, so the grader stays blind to identity and its notes cannot name the parties. The output is strict JSON
`{ correctness, completeness, grounding, note }`, parsed with Zod. Malformed output becomes a definite
`GRADER_INVALID_OUTPUT` failure, and as everywhere, there is no automatic paid retry. Calls =
eligible cases × parties (at most 15 with three parties), shown in the paid-call preview.

## Calibration display (pure functions in `src/domain/calibration.ts`)

For each dimension, and overall:
- **Within jury range:** the share of items where the grader's score is between the jurors' min and max.
- **Exact agreement with the jury median**, and the mean absolute difference from the jury mean.
- **Same top party?** Does the grader's highest party match the jury's `highest`?
- A disagreement table: case, Testimony label, dimension, grader score, jurors' range, grader note.
- A fixed caveat with the counts ("15 items, 2 jurors: too few to rely on"). Kappa is shown only when there are
  at least 30 items, since below that it is unstable.

Comparison is always against the **invited** cohort. The judge's context-aware review is shown separately, as today.

## API changes (additive)

- `POST /api/v1/runs/:runId/special-master`: owner only, status `revealed`/`decided`, `Idempotency-Key`. Body
  `{ modelKey, credentialIdsByProvider, consentToProviderProcessing: true, acknowledgeProviderCharges: true }`.
  Returns 202 with `plannedCalls`. It counts toward the `gen:` rate limit (extend the path regex in `api.ts`).
- `GET /api/v1/runs/:runId/special-master` (owner only; a reviewer gets the standard 404),
  `POST …/:graderRunId/retries`, `POST …/:graderRunId/cancel`.
- `getResults` adds `specialMaster` **only when `role === 'owner'`**. Jurors never see it, even after unsealing.
- The certified record (phase 2) includes it under "Special master (advisory)", with `config_hash`.

## Security and blinding risks

- **Prompt injection from responses** ("ignore the rubric, score 2"): wrap the response as data, keep the anchors
  in the system turn, and rely on calibration to expose a manipulated grader. The grader's notes render as plain text.
- **Self-preference.** Warn when the grader's model or provider matches a party's.
- **Evidence sent to a provider.** Responses, including phase 4 imported text, and the scoring guide go to the
  grader's provider. Consent copy says this in plain words before the first call.
- **Anchoring.** Grader output is owner-only. The verdict form never prefills from it, and the record shows
  which verdict revisions were written after a grader run existed.

## Tests needed

- Unit: calibration math on fixtures with known answers; strict parser (extra keys, out-of-range scores, prose
  around JSON); the request body has the scoring guide but no party label, model ID, or provider name (a forbidden-strings test).
- Integration, on both stores: refused before reveal (409) and for reviewers (404); `results.cohorts` and
  `disagreements` are byte-identical before and after a grader run; budget reserved and released; cancel fences;
  malformed output → `failed` with no retry; an expired or revoked key fails before send.
- Playwright: unseal, run the special master, see calibration above the grader's totals, verdict unchanged.

## Open questions

1. Should the grader also run before reveal, owner-only, to save waiting? That would need a pre-reveal blinding proof.
2. Should there be more than one sample per item for self-consistency (doubling the cost), and should the spread be shown?
3. Should the grader have reasoning or thinking on (today's adapters turn it off) and a larger output cap?
4. Should a pairwise mode be added later for the "same top party?" question?
