# Design note: conversations (phase 5)

Status: **S3a built on `next`, Nov 17, 2026 (D-39); S3b not started.** S3a differs from this proposal in two ways: the 96 KiB caps stay (history is limited to 10 messages and 8,000 characters per question), and v2 adapters produce byte-identical v1 bodies for one message, with a separate `multiTurnVerifiedAt` gate for history.

## Where it fits in today's code

- `buildMessages` (`src/domain/messages.ts`, template `qa-v1`) returns one `{ system, user }` pair. The user
  string is a fixed prefix plus `JSON.stringify({ reference, input })`. The scoring guide is never included.
- `ProviderRequest` (`src/server/providers/common.ts`) carries one `user: string`. Both bodies send one user
  message: `openAiRequestBody` (`input: [{ role: 'user', … }]`) and `anthropicRequestBody` (`messages: [{ role: 'user', … }]`).
- `ADAPTERS` is keyed by **provider**, but the snapshot records `adapterVersion` per configuration. If a deploy
  changed the adapter mid-hearing, a retry would use the new code while the record names the old version.
- The `RunSnapshot` type pins `messageTemplateVersion: typeof MESSAGE_TEMPLATE_VERSION` and `rubricVersion: typeof RUBRIC_VERSION`.
- One generation per (case, party): `UNIQUE (run_id, case_key, configuration_key)` on `generations`,
  `attempt_no BETWEEN 1 AND 2` and `UNIQUE (generation_id, attempt_no)` on attempts and outbox.
- `maxOutputTokens` is `z.literal(512)`. `LIMITS.providerOutputBytes` is 16 KiB. Draft and snapshot are each capped at 96 KiB.

## S3a: next-turn evaluation

**Data model.** `caseInputSchema` gains an optional `messages: TranscriptMessage[]` (default `[]`), where
`TranscriptMessage = { role: 'user' | 'assistant', content }`. It holds the **prior** turns: it alternates,
starts with `user`, and ends with `assistant`. `input` remains the final user turn, so existing cases stay
valid with no rename. Phase 4 imports reuse the same type. New limits: at most 20 prior messages, 4,000 code
points each, and 24,000 for the case total. Cases with messages need the snapshot cap raised (open question 1).

**Template versioning.** New template `chat-v1`. The first user turn is wrapped in the `qa-v1` envelope
(`{ reference, input: <first user turn> }`), and later turns are verbatim. With empty history, `chat-v1`
produces **byte-identical** content to `qa-v1`, which makes a cheap regression test. The snapshot records the
template per hearing: widen the type to `'qa-v1' | 'chat-v1' | …`, choose `chat-v1` only when some case has
messages, and leave old hearings on `qa-v1` forever.

**Multi-message adapters.** `ProviderRequest.user` becomes `messages: TranscriptMessage[]`. The new adapter
versions are `openai-responses-v2` (an `input` array of role items) and `anthropic-messages-v2` (alternating
`messages`). **Key `ADAPTERS` by `adapterVersion`, not provider**, and keep the v1 builders, so a retry always
uses the version its snapshot recorded. Per the registry rule, a route's `verifiedAt` for v2 is set only after
a live multi-message smoke call is recorded in `docs/provider-contracts.md`. `PROVIDER_REGISTRY_VERSION` changes.

**Display.** Review and results show the shared history once per question, as a transcript with speaker labels,
followed by Testimony A/B/(C) as the next turn. Budget, blinding, and scoring are unchanged: one call per
(case, party), and the same `reference-qa-v1` rubric.

## S3b: whole-conversation evaluation

**User side.** Start with a **scripted user**: the case holds `userTurns: string[]` (2–6), and each party answers
turn *k* with its own previous answers in context. The input is controlled, but the script cannot react, which
the record states. A **simulated user** (an LLM persona billed to the judge's key, one identical simulator
configuration for all parties) comes later and only behind its own consent. Its turns are stored as
evidence and shown to jurors uniformly as "User (simulated)". Because the simulator reacts differently to each
party, inputs diverge, and results must say so.

**Data model (additive; no table rebuild).** Rebuilding `generations` to add a turn column would be
dangerous: with `foreign_keys` on, `DROP TABLE generations` cascades into `generation_attempts`. Instead:
- The `generations` row stays the per-(case, party) unit for eligibility and status.
- New `conversation_turns`: `id`, `generation_id` FK cascade, `attempt_no`, `turn_no`, `user_text`, `user_source ('script'|'simulated')`,
  `status`, `output_text`, `finish_reason`, tokens, `duration_ms`, `error_code`, `provider_request_id`, `fence_token`,
  `deadline_at`, `UNIQUE (generation_id, attempt_no, turn_no)`, and an immutability trigger like the one on attempts.
- New `turn_outbox` (`attempt_id`, `turn_no`, status, dispatch fields), because `outbox` is unique per
  (generation, attempt). Each turn is one job. The commit of turn *k* enqueues turn *k+1* in the same batch, so
  every provider call keeps today's claim → fence → send → commit shape and its 120 s lease.
- The attempt's `output_text` holds the canonical transcript JSON once all turns succeed. Reviewers read it through
  the same allowlisted path. The attempt stays `running` across turns, so each turn claim must push its
  `deadline_at` forward. Otherwise `reconcileLeases` marks a healthy conversation `uncertain` after 120 s.
  Leases then apply per turn (`conversation_turns.deadline_at`).

**Per-turn budget.** Admission reserves `cases × parties × turns` units in `budget_buckets`, and the paid-call
preview shows that number. A finished conversation consumes its units. On failure, the reservations for turns
that were never sent are released (the same "provably unsent" rule as pre-send credential failures).

**Failure states.** A turn has the same outcomes as an attempt. A definite failure at turn *k* makes the
conversation `failed`. An uncertain turn *k* (it may have been billed, but there is no text) makes the conversation
`uncertain`, because the next turn has no history to build on. Either way, later turns are never sent. Partial
conversations are **not eligible**, matching `computeEligibility`'s rule that every party must succeed for
the case. A retry is attempt 2 and **restarts from turn 1** (one clean transcript per attempt). Before the judge
confirms, the retry dialog shows the full call count and the existing `acknowledgePossiblePriorCharge`.
Cancel fences the current turn and releases the rest.

**Larger caps.** `maxOutputTokens` becomes an enum allowed per template (`qa-v1`/`chat-v1`: 512;
`conversation-v1`: 512 or 1,024 per turn). It stays a literal per hearing in the snapshot. A transcript is capped at
64 KiB of output.

**Conversation rubric.** `conversation-v1` has four dimensions, coherence, memory (consistency with earlier
turns), tone, and task completion, each scored 0/1/2 with anchors and a required note on a 0. Jurors rate the
whole conversation, not each turn. This **depends on phase 3's versioned rubrics**: `DIMENSIONS`,
`draftRatingSchema`, and `scoreCohort` are hard-wired to three fields today. Phase 3 should add a
rubric-keyed `scores` map alongside the existing fields (kept for `reference-qa-v1`; no rename).

## Security and blinding risks

- History and scripted turns are shared evidence and identical for every party, so the system leaks nothing new.
  Content risk: history written by a recognizable model is a style cue (owner-side warning only).
- Prompt injection inside history goes only to the party models, as today. The judge wrote or imported it.
- Turn counts and lengths could differ between parties, but only partial conversations differ, and those are ineligible.
  A test asserts that eligible conversations have equal turn counts.
- The simulated user is a second paid party. It uses the judge's key (BYOK), never a platform payer, and gets its own consent line.

## Tests needed

- Unit: `chat-v1` with empty history equals `qa-v1` bytes; role-alternation validation; adapter request bodies
  for v2 (extend `adapters.test.ts`); adapter dispatch by `adapterVersion` (a v1 hearing retried after v2 ships still
  sends a v1 body); the budget formula; eligibility with partial conversations.
- Integration, on both stores: the turn chain commits in order; a duplicate turn job is not claimed; cancel
  mid-conversation sends nothing more and releases the remaining reservations; uncertain turn → uncertain
  conversation; retry restarts at turn 1 and reserves the full count; the transcript is immutable after success.
- Playwright: a next-turn hearing with a two-message history; a scripted three-turn hearing reviewed with `conversation-v1`.

## Open questions

1. What should the snapshot and draft caps become? Today both are 96 KiB, and the request body is 128 KiB. Long histories need
   more. Check the D1 and Durable Object row limits before choosing (for example, 256 KiB).
2. Should a retry resume from the failed turn instead (cheaper, but it mixes attempts in one transcript)?
3. Is the simulated user in scope for v2 at all, or is scripted-only enough?
4. Should jurors also flag individual turns (a non-scoring note), or rate the conversation only?
