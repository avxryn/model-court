# v2 phase 2 — server and domain half (F24, certified record, CSV import parser)

Branch: `claude/mystifying-edison-fd61b9`, based on `next` at `9f3fac5`. No UI files changed
(`src/pages`, `src/components`, `src/styles.css` untouched). Not deployed, not pushed.

These entries are written for `docs/decisions.md` and `docs/verification.md`; renumber at merge.

## Proposed decisions

| # | Date | Decision | Why | Consequences |
|---|---|---|---|---|
| D-26 | 2026-11-17 | **F24 third configuration.** `LIMITS.configurationsPerRun` (2) became `minConfigurationsPerRun: 2` / `maxConfigurationsPerRun: 3`; the draft schema accepts 2–3 configurations. A new operator setting `MAX_CONFIGURATIONS_PER_RUN` (2 or 3, default 3) caps a deployment; any other value fails closed to 2 and is listed in `config.problems`. The cap is enforced on draft save (422 `VALIDATION_FAILED`, field `configurations`) and again at run admission, so a draft saved under 3 cannot start after the operator lowers it. The catalog's `limits.configurations` now reports the deployment cap and a new `limits.minConfigurations` reports 2. | Spec §1 (P1): "the schema may allow three configurations from the start". An operator switch keeps a deployment on the P0 behavior without a code change. | No field, enum, or error-code renames. `retrySchema` and `saveRatingsSchema` bounds grew to 5 × 3 = 15. Model comparison with 3 configurations needs 3 distinct models; with today's two verified routes that means three-way comparisons are configuration-mode only (readiness message reworded to "a different model for each configuration"). The default example draft still has 2 configurations. Scoring, shuffling, blinding, budget, retry, and cancel code needed no change — they were already generic over the count; T24 now proves it. |
| D-27 | 2026-11-17 | **Certified record export:** `GET /api/v1/runs/:id/export?format=json|csv`, owner-only (reviewers 403, strangers 404), only in `revealed`/`decided` (else 409). JSON uses the normal `{data, requestId}` envelope; CSV is `text/csv; charset=utf-8` with a UTF-8 BOM. Both send `Content-Disposition: attachment` and `Cache-Control: private, no-store`. Built from the same projection as `/results`. | Spec §16.3 and the plan's "Certified record". Reusing the results projection means the export can never show more than the revealed results already do. | Carries cases (with expected behavior), responses, ratings by juror label (`Juror N`, `Judge (context-aware)`), cohort findings, disagreements, coverage, verdict revisions, and the snapshot hash plus rubric, message-template, registry, canonicalization, and app-commit versions. Never carries keys, ciphertext, credential IDs, invite tokens or hashes, user IDs, session IDs, response IDs, generation or attempt IDs (tested by sentinel scan). |
| D-28 | 2026-11-17 | The record carries `certification.contentSha256`: SHA-256 over the canonical JSON (`sorted-json-v1`) of every field except `exportedAt` and `certification`. | Two exports of the same run state hash the same, so a reader can check that two copies agree; a new verdict changes it. | It is an integrity fingerprint, not a signature — the app has no signing key and the text says "Exported from Model Court", not "signed". A printable judgment (phase 3) can show it. |
| D-29 | 2026-11-17 | Each export writes an audit event `run.export` (metadata: format, contentSha256). | Exports move evidence out of the app; the docket should show when. | The only GET that writes. Audit rows follow the existing retention. |
| D-30 | 2026-11-17 | **CSV formula-injection protection:** any cell whose first character is `=`, `+`, `-`, `@`, tab, or CR gets a leading `'`. Applied to every cell, numbers included (none are negative today). Cells are RFC 4180 quoted when they contain `"`, `,`, CR, LF, or edge whitespace. CSV is one row per rating; an unrated response (excluded case) is one row with empty juror columns. Verdicts and cohort findings are JSON-only. | Spec §16.3; OWASP CSV-injection guidance. | The `'` is visible in the cell; JSON keeps text exact. |
| D-31 | 2026-11-17 | **CSV case import parser** (`src/domain/case-import.ts`, pure; UI wiring later): header row with `title`, `input`, `expected_behavior` required and `reference` optional (case-insensitive; spaces, hyphens, camelCase accepted); unknown or duplicate columns are rejected; 1–5 rows; 128 KiB file cap (`LIMITS.caseImportCsvBytes`). Each row is validated with `caseInputSchema`, the set with the new exported `casesSchema` (same rules `draftInputSchema` uses), and `applyImportedCases` validates the whole draft (96 KiB cap). Values are kept exactly (no trim, no normalization, no stripping of a leading `'`). | The plan's "CSV import in the browser, validated by the same Zod contracts". | Errors come back as `{row, field, message}` for the editor to show. The server still re-validates on the draft PUT. |

## Files

- `src/domain/limits.ts`, `contracts.ts` (2–3 configurations, `casesSchema`), `snapshot.ts` (message), `csv.ts` (new), `case-import.ts` (new)
- `src/server/config.ts` (`MAX_CONFIGURATIONS_PER_RUN`), `api.ts` (catalog limits, export route), `services/evaluations.ts` and `services/runs.ts` (cap enforcement), `services/export.ts` (new)
- `src/lib/dto.ts`: added `minConfigurations` to the catalog limits type (types only; no UI change)
- `docs/api.md`: export route row
- Tests: `src/domain/{contracts,rubric,csv,case-import}.test.ts`, `src/server/config.test.ts`, `src/server/services/runs.test.ts`, `tests/integration/{three-configurations,export}.test.ts`; `tests/integration/harness.ts` now parses JSON only for JSON responses and exposes raw `bytes`

## Verification evidence (agent)

See the bottom of this file for the `npm run check` result.

| Test | What it shows |
|---|---|
| T24 unit (`contracts.test.ts`) | 2 and 3 configurations accepted, 1 and 4 rejected, duplicate keys rejected; retry/ratings bounds accept 15 and reject 16 |
| T24 unit (`rubric.test.ts`) | three-configuration means with one denominator, single highest, three-way and two-of-three exact ties, common-case filtering, disagreements on the third configuration |
| T24 unit (`runs.test.ts`) | `buildAssignment` labels A/B/C and covers each configuration once per case; all six orders appear with near-equal frequency over 6,000 shuffles |
| T24 unit (`config.test.ts`) | `MAX_CONFIGURATIONS_PER_RUN` default 3, accepts 2/3, fails closed to 2 otherwise |
| T24 integration (`three-configurations.test.ts`, D1 and DO) | 15 planned calls and 15 units reserved in all three buckets; the second OpenAI configuration uses its own instructions with the one OpenAI key; a daily cap of 14 refuses the run with nothing reserved, 15 admits it; operator cap 2 refuses save and admission; model mode with a repeated model is refused; retry of failed third-configuration calls reserves 2 more units, an exhausted case is excluded and review shows 4 cases × 3 responses; cancel after 2 sends releases 13 units and sends nothing more; reviewer payloads leak no model, provider, label, prompt, or configuration key; stable order across reloads; revealed scores per configuration, highest, coverage, a verdict for the third configuration; export with 15 responses and 30 ratings |
| Export integration (`export.test.ts`, D1 and DO) | 409 before reveal, 403 reviewer, 404 stranger, 401 anonymous, 400 unknown format; JSON content, labels, versions, deterministic hash across exports, hash changes after a verdict, verdicts without `created_by`; 3 audit events; CSV headers, BOM bytes, 20 rating rows, no cell starting with a formula trigger, formula title and note neutralized; unrated excluded-case rows; sentinel scan (both keys, credential IDs, ciphertext, nonces, invite token and hash, both user IDs, session/response/generation/attempt IDs) on JSON and CSV |
| CSV unit (`csv.test.ts`, `case-import.test.ts`) | every trigger prefixed, ordinary text untouched, RFC 4180 quoting, round trip, BOM/LF/blank lines, malformed quotes with line numbers; import header variants, strict columns, per-row Zod errors, count/width/byte caps, draft 96 KiB cap |

Not verified: no browser or Playwright coverage (no UI yet); no deployed check (nothing deployed).

## Hand-over for the UI session

- Catalog: `limits.configurations` is the deployment maximum (3 by default), `limits.minConfigurations` is 2. Draft PUT accepts 2–3.
- Export: fetch with the bearer token (a plain link has no auth). JSON is in `data`; CSV is the raw body — save it as a Blob with the `Content-Disposition` filename. Show `certification.contentSha256` on the printable record.
- Import: `parseCasesCsv(text, newId)` then `applyImportedCases(draft, cases)`; both return `{ok:false, issues:[{row, field, message}]}` on failure. Suggest a downloadable template with the header `title,input,reference,expected_behavior`.

## `npm run check`

Run on 2026-11-17 at the final commit of this branch: exit 0. `tsc --noEmit` and `eslint .` clean;
unit 66/66 (9 files); integration on local D1 69/69 (6 files); integration on the
`ModelCourtStore` Durable Object 69/69 (6 files). Before this work the integration suites had 57 tests;
the 12 new ones are 8 in `three-configurations.test.ts` and 4 in `export.test.ts`.
