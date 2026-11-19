# Security review: structured extraction (spec 04 step B3, D-91)

Date: 2026-11-18. Branch `claude/extraction-fa41c6`, reviewed at `4c579aa` against the base `ad2dc21`.
Method: three independent reviewer agents, each read-only and given only the code and the spec (not the
author's conclusions), as in D-43. Fixes were made by the authoring session and are tested; this page says
which. Nothing here was checked by Avery.

| Reviewer | Scope |
|---|---|
| 1 | Upload and storage: `documents.ts`, migration 0012, document routes, sweep, quotas, backup and restore, admission, draft references |
| 2 | Access and blinding: the guest route addition, the document routes, the juror projection, field flags, results, export, the special master, the generation job |
| 3 | Browser: pdf.js 6.5.438 configuration, the PDF viewer and upload, rendering of model output, document text and schemas, the CSP |

No critical or high findings. Every reviewer reported these areas clean: cross-owner access and dedupe,
client-forged document references, hearing documents staying immutable after Start, SQL injection, download-only
response headers, audit and log contents, backups never carrying PDF bytes, the guest cookie's scope, blinding
before unsealing (no answer key, check, rule, schema hash, wire schema or provider bytes of a parsed answer in
any juror payload), field-flag validation, no document in a job payload, no send on an adapter version without
the feature, no eval or `new Function` in pdf.js 6, no script, links, forms, XFA, external fetches or
iframe/blob/data URLs for uploaded content, and no markup injection from model output or documents.

## Findings and what was done

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | Medium | A hostile PDF can exhaust a juror's tab: unlimited decoded image size, no canvas size cap, overlapping renders | Fixed: `maxImageSize` 2^25 and `canvasMaxAreaInBytes`; the canvas is held under 2^24 pixels (resolution drops, layout doesn't); pages beyond 20,000 px are refused; a page or zoom change cancels the render in progress (this also fixes the viewer locking into its error state) |
| 2 | Medium | The backup export read every PDF chunk into the Worker before dropping it; past ~100 MB of PDFs every backup would fail | Fixed: PDF chunks are filtered in SQL and only counted |
| 3 | Low | A juror (or guest) could fetch the document of a question excluded from their worksheet | Fixed: non-owners get 404 unless the question is in their session's assignment (integration-tested with an excluded question) |
| 4 | Low | A PDF body without `Content-Length` was buffered whole before the 4 MiB check | Fixed: the PDF route requires `Content-Length` (411 otherwise), refuses a declared size over the cap, and counts the stream, cutting it at the declared size |
| 5 | Low | The sweep decided before its batch whether a blob had counted toward quota; a repair upload in between could leave counters inflated | Fixed: the decrement's condition (all chunks present) is evaluated inside the batch |
| 6 | Low | One caller could download up to ~480 MiB a minute of PDFs within the general read limit | Fixed: at most 30 document reads a minute per caller, besides the 120 reads |
| 7 | Low | The page count comes from the client; a PDF can claim 1 page and hold thousands | Partly fixed: the judge's browser counts pages before reading any text, and the viewer shows at most 20 page buttons and says when a file has more. **Open:** the server still trusts `X-Page-Count` (spec 04 §8.3 by design: no server-side parsing). Only the judge's own key is spent |
| 8 | Info | The document was read after the claim but before the send-time fence check | Fixed: it is now read inside the credential callback, right after the fence check, so a canceled attempt never loads it |
| 9 | Info | No `Cross-Origin-Resource-Policy` on document bytes | Fixed: `same-origin` |
| 10 | Info | Tests did not pin a revoked juror, a guest of another hearing, or the excluded question | Fixed: integration tests on both stores |
| 11 | Info | `isEvalSupported: false` not passed | Not applicable: pdf.js 6 removed the option along with the eval path; the reviewer of the build confirmed no `eval`/`new Function` remains |
| 12 | Low | The prerendered `/` is served by the asset layer with a weaker CSP than worker-served pages (predates this branch) | **Open, for Avery:** add the app's `script-src`/`connect-src` to `public/_headers` or serve `/` through the worker; matters only as a backstop if a pdf.js bug ever yields script |
| 13 | Info | Without pdf.js's wasm, cMaps and standard fonts, jurors may see JPX/JBIG2 scans blank, some CJK text garbled, or base-14 fonts approximated, while the providers got the full file | **Open, for Avery:** serving them same-origin needs `'wasm-unsafe-eval'` in the CSP for the image decoders; until then the record already says each provider read a native PDF its own way |
| 14 | Info | Eight accounts at 32 MiB can fill the 256 MiB global cap | **Open:** acceptable while sign-up is small; lower `MAX_DOCUMENT_BYTES_PER_USER` or watch the global bucket if that changes |
| 15 | Info | A non-JSON answer still shows the provider's raw text (spec 04 §8.1 accepts this, with the identity-clue checkbox) | Left as specified |
