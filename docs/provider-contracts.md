# Provider contracts (BYOK)

Status: **documented from the providers' official docs on 2026-11-16; one real call per original route recorded on 2026-11-17 (below). 26 more routes documented 2026-11-17 (D-48), unverified.**
The original two routes have `verifiedAt: '2026-11-17'` in the registry (version `2026-11-17.1`). The deployed check (V12) is still pending.

| Registry key | Endpoint | Model | Request specifics | Auth |
|---|---|---|---|---|
| `openai-gpt-6-luna` | `POST https://api.openai.com/v1/responses` | `gpt-6-luna` | `instructions`, one user `input_text`, `max_output_tokens: 512`, `reasoning: {effort: "none"}`, `store: false` | `Authorization: Bearer <owner key>` |
| `anthropic-claude-haiku-5-5` | `POST https://api.anthropic.com/v1/messages` | `claude-haiku-5-5` | `system`, one user message, `max_tokens: 512`, `thinking: {type: "disabled"}` | `x-api-key: <owner key>`, `anthropic-version: 2026-10-21` |

Why reasoning/thinking is off: both providers count reasoning tokens against the output cap; with
512 tokens a reasoning model can return no visible text (`EMPTY_OUTPUT`).

## Full lineup (D-48, registry `2026-11-17.3`): documented, live checks pending

Read from the providers' own model pages on 2026-11-17; no paid call was made. Every route below has
`verifiedAt: null` except the two above, so the catalog lists it, a draft may choose it, and run admission
refuses it until its smoke row is recorded here. `npm run smoke:providers` now asks for route keys and sends
each through the adapter version that route records.

Adapter versions (the body never changes once a hearing records it):

| Version | Body difference from v2 | Used by |
|---|---|---|
| `openai-responses-v2` | — (`reasoning: {effort: "none"}`, `max_output_tokens: 512`) | models that accept effort `none` |
| `openai-responses-reasoning-low-v1` | `reasoning: {effort: "low"}`, `max_output_tokens: 512 + 8192` | models that reject `none` (HTTP 400) |
| `anthropic-messages-v2` | — (`thinking: {type: "disabled"}`, `max_tokens: 512`) | models that accept `disabled` at their default effort |
| `anthropic-messages-between-tools-v1` | `thinking: {type: "between_tools"}` | Claude Sonnet 5.5 (rejects `disabled`; with no tools the reply is text only) |
| `anthropic-messages-adaptive-low-v1` | `thinking: {type: "adaptive", display: "omitted"}`, `output_config: {effort: "low"}`, `max_tokens: 512 + 8192` | models that cannot turn thinking off |

Reasoning and thinking tokens count toward the output cap and are billed as output on both providers; OpenAI
notes a reasoning model can hit the cap before writing any text and suggests reserving far more (25,000) while
experimenting. 8,192 at low effort is this app's guess for short answers and is what the live check must confirm.
The visible answer of these routes is not held to 512 tokens; the 16 KiB stored-text cap still applies.

| Key | Model | Context / provider max output | Version | Source |
|---|---|---|---|---|
| `openai-gpt-6-2-astra` | `gpt-6.2-astra` | 1.05M / 128K | reasoning-low | developers.openai.com/api/docs/models/gpt-6.2-astra ("rejects … `none`") |
| `openai-gpt-6-2-sol` | `gpt-6.2-sol` | 1.05M / 128K | reasoning-low | …/models/gpt-6.2-sol ("rejects … `none`") |
| `openai-gpt-6-1-terra` | `gpt-6.1-terra` | 1.05M / 128K | v2 | …/models/gpt-6.1-terra (none … max) |
| `openai-gpt-6-1-sol` | `gpt-6.1-sol` | 1.05M / 128K | reasoning-low | …/models/gpt-6.1-sol (low … max) |
| `openai-gpt-6-astra` | `gpt-6-astra` | 1.05M / 128K | reasoning-low | …/models/gpt-6-astra (low … max) |
| `openai-gpt-6-sol` | `gpt-6-sol` | 1.05M / 128K | v2 | …/models/gpt-6-sol (none … max) |
| `openai-gpt-6-luna` | `gpt-6-luna` | 1.05M / 128K | v2 | …/models (verified 2026-11-17) |
| `openai-gpt-5-6-sol` | `gpt-5.6-sol` | 1.05M / 128K | v2 | …/models/gpt-5.6-sol |
| `openai-gpt-5-6-terra` | `gpt-5.6-terra` | 1.05M / 128K | v2 | …/models/gpt-5.6-terra |
| `openai-gpt-5-6-luna` | `gpt-5.6-luna` | 1.05M / 128K | v2 | …/models/gpt-5.6-luna |
| `openai-gpt-5-5` | `gpt-5.5` | 1.05M / 128K | v2 | …/models/gpt-5.5 |
| `openai-gpt-5-4` | `gpt-5.4` | 1.05M / 128K | v2 | …/models/gpt-5.4 |
| `openai-gpt-5-4-mini` | `gpt-5.4-mini` | 400K / 128K | v2 | …/models/gpt-5.4-mini |
| `openai-gpt-5-2` | `gpt-5.2` | 400K / 128K | v2 | …/models/gpt-5.2 |
| `anthropic-claude-fable-5-2` | `claude-fable-5-2` | 1M / 128K | adaptive-low | platform.claude.com models overview; thinking page (rejects `disabled`) |
| `anthropic-claude-fable-5-1` | `claude-fable-5-1` | 1M / 128K | adaptive-low | same |
| `anthropic-claude-fable-5` | `claude-fable-5` | 1M / 128K | adaptive-low | same |
| `anthropic-claude-opus-5-5` | `claude-opus-5-5` | 1M / 128K | adaptive-low | same |
| `anthropic-claude-opus-5` | `claude-opus-5` | 1M / 128K | v2 | same (`disabled` at `high` or below; default `high`) |
| `anthropic-claude-opus-4-8` | `claude-opus-4-8` | 1M / 128K | v2 | same |
| `anthropic-claude-opus-4-7` | `claude-opus-4-7` | 1M / 128K | v2 | same |
| `anthropic-claude-opus-4-6` | `claude-opus-4-6` | 1M / 128K | v2 | same |
| `anthropic-claude-opus-4-5-20251101` | `claude-opus-4-5-20251101` | 200K / 64K | v2 | same; deprecations page: retirement not sooner than 2026-11-24 |
| `anthropic-claude-sonnet-5-5` | `claude-sonnet-5-5` | 1M / 128K | between-tools | same (rejects `disabled`; `between_tools` at `high` or below) |
| `anthropic-claude-sonnet-5` | `claude-sonnet-5` | 1M / 128K | v2 | same |
| `anthropic-claude-sonnet-4-6` | `claude-sonnet-4-6` | 1M / 128K | v2 | same |
| `anthropic-claude-haiku-5-5` | `claude-haiku-5-5` | 1M / 128K | v2 | verified 2026-11-17 |
| `anthropic-claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | 200K / 64K | v2 | same; retirement not sooner than 2026-10-15 (still listed Active) |

Left out: deprecated models (OpenAI's deprecated list, `claude-sonnet-4-5-20250929` retiring 2026-11-30),
limited-access models (Claude Mythos 5.x, GPT-Rosalind), Pro models (`gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.2-pro`:
minutes per request and background mode, beyond the 90-second deadline), `gpt-oss-120b`/`-20b` (0 RPM at default
tiers, no listed price; only the 120b page was read), and `chat-latest` ("not recommended for API use").
Temperature is never sent: Anthropic API version `2026-10-21` rejects it, and OpenAI's pages do not document it.

## Normalization (`src/server/providers`)

- No redirects followed (`redirect: 'manual'` → `PROVIDER_REDIRECT_REFUSED`). Response body capped at 256 KiB before parsing; stored text capped at 16 KiB (`OUTPUT_TOO_LARGE`).
- OpenAI: text = `output[].content[type=output_text]`; a refusal-only reply is kept as text. `status: incomplete` + `max_output_tokens` → kept, `truncated: true`. 429 with `insufficient_quota` → `PROVIDER_QUOTA_EXHAUSTED`, any other 429 → `PROVIDER_RATE_LIMITED`.
- Anthropic: text = joined `content[type=text]`. `stop_reason: max_tokens` → truncated. `refusal` with no text → `PROVIDER_BLOCKED`. 529 → `PROVIDER_UNAVAILABLE`. A "credit balance" message or `billing_error` → `PROVIDER_QUOTA_EXHAUSTED`.
- Usage is `null` when unknown (never 0). The request ID comes from the `x-request-id` / `request-id` header.
- Network failure or timeout after send → `uncertain` (possibly billed); no automatic retry.

## Live smoke record (fill from `npm run smoke:providers`; paid; run by you)

| Date | Provider | Model | Outcome kind | finishReason | tokens in/out | Observed model | Recorded by |
|---|---|---|---|---|---|---|---|
| 2026-11-17 | openai | gpt-6-luna | success | `completed` | 153 / 24 | `gpt-6-luna` | Run by you from your terminal; output read by the agent. Request `req_b8ce2d2cf26f4e918d30f6d084a5cf48`, 2655 ms, not truncated. |
| 2026-11-17 | anthropic | claude-haiku-5-5 | success | `end_turn` | 228 / 151 | `claude-haiku-5-5` | Run by you from your terminal; output read by the agent. Request `req_011Ch8kvC1Mwg93murTW4rHJ`, 1457 ms, not truncated. An earlier attempt with a different key returned `PROVIDER_AUTH_FAILED` (definite, `req_011Ch8kkRREaXWyzX1znA7hr`), which is normalized as designed. |

After a successful row, set `verifiedAt: 'YYYY-MM-DD'` on that route in `src/domain/registry.ts`. If the
mapping differs (for example, a field name), fix the adapter and add a regression to
`src/server/providers/adapters.test.ts` first.

## Multi-message requests (D-39): pending

Routes now use `openai-responses-v2` and `anthropic-messages-v2`. With one user message their bodies are byte-identical to v1 (unit-tested), so the single-message smoke results above still apply. A conversation sends alternating turns: OpenAI assistant turns as `{role: "assistant", content: [{type: "output_text", text}]}`, Anthropic as `{role: "assistant", content}`. Each route's `multiTurnVerifiedAt` stays null until `npm run smoke:providers` in `multi` mode succeeds for it and the result is recorded here.

| Date | Provider | Model | Mode | Outcome | Recorded by |
|---|---|---|---|---|---|
| | openai | gpt-6-luna | multi | | |
| | anthropic | claude-haiku-5-5 | multi | | |

## Deployed check (V12): pending

A real run in the deployed app, using keys saved through Settings, with the browser closed during generation.
