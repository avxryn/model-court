# Model Court v2 — plan

Status: planning, Nov 17, 2026. Work happens on the `next` branch. The submission build is tagged
`submission-candidate-1`, and `master` and the live app stay on it until you have tested and submitted.
Nothing from `next` deploys before then.

Goal: make the app easier to follow and give it a courtroom "case file" look, then build every deferred
spec feature (P1) and every stretch goal in `docs/implementation-plan.md`.

## Ground rules (all phases)

- BYOK, blinding before reveal, and evidence immutability never weaken. Jurors never need keys.
- Anything that changes recorded data is versioned (rubric version, message template version, snapshot
  hash), and old hearings keep reading their original versions.
- Tests come before or with each feature: unit for pure rules, integration on both stores (D1 and the
  Durable Object), and Playwright for flows.
- Court language is the friendly layer only. **Keys, cost, consent, and deletion always stay in plain words.**
- No API field, enum, or error-code renames. Court terms are display strings only (see D-24).

## Design direction: full paper and stamps (chosen Nov 17, 2026)

Mockup: https://claude.ai/code/artifact/aa50d43b-8bb2-493b-95bb-9ec66d19a406 (private canvas; left board).

### Terminology

| Today (code/API) | Court term | Plain subtitle (first use and glossary) | Paper treatment |
|---|---|---|---|
| Evaluation | Case, docket `MC-YYYY-NNNN` | evaluation | Manila folder with step tabs; caption block |
| Test case | Question presented (Q1–Q5) | test case | Numbered section on the sheet |
| Reference | Exhibit 1, 2… | reference evidence, sent to the models | Stapled page with a yellow exhibit sticker |
| Expected behavior | Jury instructions | scoring guide, never sent to the models | Dashed instruction slip |
| Configurations | Parties | the configurations being compared | Caption *Sealed party v. Sealed party*, named after unsealing |
| Run | Hearing | run | Hearing number and date in the caption |
| Generate | Hear testimony | generate responses | — |
| Response | Testimony A / B / C | response, shuffled per question | Transcript block with red line numbers |
| Invite | Jury summons | invitation link | Summons card with a perforated edge |
| Review | Juror’s worksheet | your ratings | Ruled worksheet with round 0/1/2 marks |
| Submit review | File findings | submit (final) | Red FILED stamp with date |
| Reveal | Unseal the record | reveal the models | SEALED stamp turns to UNSEALED |
| Results | The record | results | Findings tables, disagreements |
| Verdict | Judgment | your decision | Signed judgment with signature line |
| JSON export | Certified record | download | Printable record with a certification line |
| Audit events | Docket entries | activity log | Dated list |
| LLM judge (S4) | Special master | AI grader, advisory | Separate, clearly labeled section |

Docket numbers are display-only, derived from the evaluation's creation year and a per-owner sequence.
Labels: court terms with the plain subtitle on first appearance on each screen, plus a glossary page.
A "court terms only" preference can come later if people want it.

### Visual system

- Surfaces: desk `#E9E2D3`, paper `#FFFDF6`, manila `#DCCFAE`, margin rule `#D9A79F`, exhibit sticker
  `#F2CF5B` on `#3D2E00`, stamp red `#A8261C`, ink `#1E2433`, navy action `#2E3D66` (the current palette).
- Type: Libre Caslon Text for documents, Courier Prime for docket numbers and stamps, the current system
  sans for controls and dense UI. Fonts are self-hosted (`@fontsource/*`), because the CSP allows fonts
  only from `'self'`.
- Stamps animate once (a short press) and do not animate when reduced motion is on.
- Checks: 4.5:1 text contrast, keyboard-only use, 200% zoom, 390px width. Stamps carry text alternatives.
- No dark mode today; a "night court" dark palette is optional, later.

### Easier to follow

- A progress strip on every case: File → Hear → Deliberate → Unseal → Judgment, with one main button for
  the current step.
- "Start from a template": the S1 use cases become starter cases (model selection, prompt regression,
  policy assistant, provider-update check, expert sign-off, teaching).
- Show the number of paid calls before a hearing starts ("This hearing makes 10 calls, billed to your keys").
- Empty states that say what to do next; a three-step "how this works" on first visit; a glossary page.

## Phases

Each phase ends with `npm run check` green on both stores, Playwright updated, and a decisions/verification entry.

### Phase 1 — Case-file redesign (UI only)
Paper tokens and fonts; case caption, progress strip, exhibit, jury instructions, testimony transcript,
worksheet, summons, FILED/SEALED stamps, judgment page, glossary; templates; paid-call preview.
No API or data changes beyond display strings. Size: about 2–3 sessions.

### Phase 2 — Deferred spec features (P1)
- **F24 third configuration** (T24): limit 3, labels A/B/C (already allowed in the schema and review DTO),
  scoring on common cases, budget caps per call.
- **CSV import** in the browser, validated by the same Zod contracts.
- **Certified record export** (JSON, owner-only, after unsealing); CSV export with formula-injection
  protection (spec §16.3).
- **Compact result charts** for the jury's findings and the judge's review.
Size: about 2 sessions.

### Phase 3 — Small additions (S2)
- **Versioned rubric templates**: safety/red-team and writing quality next to `reference-qa-v1`; old
  hearings keep their rubric version.
- **Printable judgment** for procurement or vendor decisions (builds on the certified record).
- **Per-language breakdown**: tag questions by language; results per language.
- ~~Email-link sign-in for jurors~~: not supported by DeepSpace 0.44.2 (D-33); dropped.

Status: phases 1–3 done on `next` (D-26, D-34 to D-37); not deployed.
Size: about 2 sessions.

### Phase 4 — Imported evidence (S3c, S4 baseline)
One import path for evidence that was not generated here, labeled with its source everywhere:
blind review of existing transcripts, and a human-written baseline as a party. Needs a short design
note first (provenance fields, snapshot hashing, blinding of imported text). Size: about 2 sessions.

### Phase 5 — Conversations (S3a, then S3b)
- **Next-turn evaluation**: a question holds a fixed transcript; each party writes the next turn.
  New message-template version, multi-message adapters, transcript display.
- **Whole-conversation evaluation**: scripted or simulated user, per-turn budget accounting and failure
  states, larger output caps, a conversation rubric. Design note first. Size: about 3–4 sessions.

### Phase 6 — Special master (S4 LLM-judge calibration)
An AI grader paid with the judge's own key, shown as a separate class, never mixed into the jury's
findings. Agreement and disagreement with the jury are shown before anyone relies on it. Design note
first. Size: about 2 sessions.

### Phase 7 — Accountless jurors (optional, last)
Design note first, covering a review-scoped, HttpOnly, owner-revocable, rate-limited juror cookie;
live notices without sign-in; resuming on another device; per-link abuse limits; and re-proving every
pre-reveal blinding guarantee. Size: about 2–3 sessions after the design.

### Also open from v1 (any phase)
Read-request rate limiting (D-13), root-key re-encryption tool, a store backup/restore procedure (V9).

## Out of scope
Large-scale statistical benchmarking, public leaderboards, fully automated scoring without human review,
and any shared or platform-paid generation.
