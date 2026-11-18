# Model Court roadmap: use-case kits

Status: planning, Nov 18, 2026. Each item gets a spec in `docs/specs/` before any code.
Ordered by usefulness for the effort, given what the app already has.

## Goal

Let a team take one real scenario (their prompts, inputs, scoring guide), run it across the setups they
are considering, and decide which setup is best for **that** use case, from blind human review plus
automatic checks, cost and speed. Model Court stays a decision aid on your own cases: no public
leaderboard, no platform-paid calls, no fully automatic verdicts (see "Out of scope" in
`docs/v2-plan.md`).

## Ground rules for every item

- BYOK only, keys never leave the server, jurors never need keys. Paid calls keep the existing shape:
  outbox → job → guarded claim → send outside a transaction → fenced commit, no automatic paid retry,
  budget reservations.
- Blinding before unsealing never weakens. Anything that could identify a party (cost, latency, model
  names, provider-specific formatting, check results that differ by party) stays hidden from jurors
  until the record is unsealed.
- Recorded data is versioned and immutable: new message templates, rubric versions and kit versions
  are added, never edited; old hearings keep reading their own versions.
- Keys, cost, consent and deletion are always in plain words. Court terms are display strings only.
- Tests with each feature: unit for pure rules, integration on both stores, Playwright for flows.
- The submission build stays untouched until it is submitted (Nov 20, 11:59 p.m. Eastern). Roadmap
  work lands on branches and deploys only when Avery says so.

## What already exists (build on it)

| Capability | Where |
|---|---|
| Two or three parties (configurations), up to 5 questions, 0–2 rubric on three lines | `src/domain/limits.ts`, `src/domain/rubric.ts` |
| Versioned rubric templates (`reference-qa-v1`, safety, writing quality) | `RUBRICS` in `src/domain/rubric.ts` |
| Model registry for OpenAI and Anthropic, routes enabled by date | `src/domain/registry.ts`, `docs/provider-contracts.md` |
| Duration and input/output tokens per testimony (shown after unsealing) | `src/server/providers/common.ts`, `TestimonySection.tsx` |
| Imported evidence (human baseline, existing transcripts) | Phase 4 in `docs/v2-plan.md` |
| Next-turn conversations (fixed transcript, parties write the next turn) | Phase 5a, `src/domain/conversation.ts` |
| Special master: advisory AI grader on the judge's key, agreement with the jury shown first | `src/server/services/special-master.ts`, `src/domain/calibration.ts` (D-40) |
| CSV case import, certified record export | `src/domain/case-import.ts`, `src/server/services/export.ts` |

## The shared contract: task kits

Items 3–6 share one concept, specified in full by item 3. Other specs must build on this shape and
list anything they need from it under "Asks of the kit framework" rather than redefining it.

A **task kit** is a versioned, immutable definition (like a rubric version) that fixes:

- `inputKind`: what a question holds (`text`, `document` (text or PDF), `sources` (numbered passages),
  `conversation`, `tools` (tool definitions plus mock responses)).
- `outputContract`: what a party must return (`text`, `json` with a JSON Schema, `label` from a set,
  `toolTrace`).
- `checks`: deterministic, free checks run on the server after generation (no paid calls), each
  returning pass, fail or n/a with a short reason. Results are hidden from jurors and shown on the
  record after unsealing, next to the jury's findings and never mixed into them.
- `rubricVersion` and default juror instructions.
- `messageTemplateVersion`: how the kit turns a question into provider messages.

The hearing, blind review, unsealing and judgment flow stays the same for every kit.

## Roadmap

### 1. Setup comparison: cost, speed and consistency
Turn the tokens and timing already recorded into a decision table on the record: per-party cost
estimate (dated price table in the registry, labeled as an estimate), median and slowest latency,
tokens, failures and retries. Optional repeat runs (same question, same setup, 2–3 samples) to show
how consistent a setup is, with a plain explanation of what repeats cost. Main use: "should we upgrade
the model or change the prompt?". Smallest item, and every later kit reports through it.
Spec: `docs/specs/01-setup-metrics.md`.

### 2. Reusable scenarios and re-hearing
Make a case reusable: save it as a scenario, start a new hearing on the same questions with a different
set of parties (a new model, a new prompt), and compare hearings of the same scenario over time without
rewriting anything. Covers "standardize prompts, inputs and criteria, then run across models".
Spec: `docs/specs/02-scenarios.md`.

### 3. Task kits and automatic checks (framework), with summarization and classification
Build the kit contract above, the check runner, kit selection in the new-case flow, check results on
the record, and the first two kits: summarization (length and required-point checks, a faithfulness
rubric) and classification (label from a fixed set, accuracy against expected labels, a reasoning
rubric). Spec: `docs/specs/03-task-kits.md`.

### 4. Structured extraction (text, then PDF)
Parties return JSON that must match a schema the judge provides (provider structured-output modes).
Checks: schema valid, required fields present, field-by-field match against an answer key where given.
Jurors see the extraction rendered as fields next to the source and judge ambiguous or invented values.
Text input first, PDF input second (provider-native file input, size limits, what the providers
receive stated plainly). Spec: `docs/specs/04-structured-extraction.md`.

### 5. Answers from supplied sources (grounded retrieval)
A question holds several numbered sources, as a retrieval step would return them. Parties answer with
citations. Checks: every cited source exists, quoted text appears in the cited source, required sources
cited. Rubric on faithfulness, coverage and correct refusal when the sources do not contain the answer.
Retrieval itself is out of scope: the sources are fixed, so every party sees the same evidence.
Spec: `docs/specs/05-grounded-sources.md`.

### 6. Tool calling with mock tools
The judge defines tools (name, JSON Schema arguments) and canned responses; parties run a short tool
loop against those mocks with a step cap. The tool trace is the testimony. Checks: required tools
called, forbidden tools not called, arguments valid, steps used, task finished. Jurors judge whether
the path was sensible and the final answer correct. Covers tool selection, efficiency and multi-step
completion without live environments. Spec: `docs/specs/06-mock-tools.md`.

### 7. More providers and more parties
Google Gemini as a third BYOK provider, possibly an OpenAI-compatible route (OpenRouter or a
self-hosted endpoint) only if the key and outbound-host risks are acceptable, and more than three
parties with a plan for juror workload. Spec: `docs/specs/07-providers-and-parties.md`.

## Deferred

- Running generated code against tests (needs a sandbox Workers does not offer).
- Autonomous agents in live environments (unbounded cost, large safety surface).
- Retrieval pipelines run by Model Court (indexing, embeddings).
- Text-to-SQL against a fixture database: a good later kit once item 3 exists.
- Public leaderboards or cross-customer aggregation.
