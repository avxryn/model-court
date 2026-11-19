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
- Usage details (D-64, read 2026-11-18; request bodies unchanged, so no adapter version changes): OpenAI `usage.input_tokens_details.cached_tokens` (already inside `input_tokens`) and `usage.output_tokens_details.reasoning_tokens` (inside `output_tokens`), from <https://developers.openai.com/api/docs/guides/prompt-caching> and the reasoning guide; Anthropic `usage.cache_read_input_tokens` (separate from `input_tokens`) and `usage.output_tokens_details.thinking_tokens` (inside `output_tokens`, "always less than or equal to"), from <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> and <https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost#pricing>. Each goes through `nonNegativeInt`; anything missing or malformed is `null`. Cache-write counts (`input_tokens_details.cache_write_tokens`, `cache_creation_input_tokens`) are not stored: hearings send no cache controls, and OpenAI counts writes inside `input_tokens`, so the estimate prices them at the full input rate.
- Network failure or timeout after send → `uncertain` (possibly billed); no automatic retry.

## Prices (D-62, price table `2026-11-18.1`)

Read by hand on **2026-11-18** from the providers' official pricing pages. No paid call was needed. The numbers live in `src/domain/prices.ts`, which is append-only: a price change is a new dated table, never an edit (a unit test pins each published table's hash). The record labels every amount an estimate at list prices; the provider bill is the authority.

- OpenAI: <https://developers.openai.com/api/docs/pricing>, Standard tier, short context ("≤272K input tokens"). GPT-5.4 mini and GPT-5.2 are listed without a context split.
- Anthropic: <https://platform.claude.com/docs/en/about-claude/pricing>, "Model pricing" table (base input, cache hits and refreshes, output). The page lists model names; the API IDs were matched by name (for example Opus 4.5 → `claude-opus-4-5-20251101`). Claude 4.6 and later, except Haiku 5.5, are priced flat across the 1M window. Haiku 5.5 costs more for prompts over 100,000 tokens; hearing prompts are at most about 24K characters, so the table records the lower tier.

USD per 1M tokens:

| Route key | Input | Cached input | Output |
|---|---|---|---|
| `openai-gpt-6-2-astra` | 8.00 | 0.40 | 40.00 |
| `openai-gpt-6-2-sol` | 2.00 | 0.10 | 10.00 |
| `openai-gpt-6-1-terra` | 1.00 | 0.05 | 5.00 |
| `openai-gpt-6-1-sol` | 2.00 | 0.10 | 10.00 |
| `openai-gpt-6-astra` | 10.00 | 1.00 | 50.00 |
| `openai-gpt-6-sol` | 2.00 | 0.20 | 10.00 |
| `openai-gpt-6-luna` | 0.10 | 0.01 | 0.50 |
| `openai-gpt-5-6-sol` | 4.00 | 0.40 | 20.00 |
| `openai-gpt-5-6-terra` | 2.00 | 0.20 | 12.00 |
| `openai-gpt-5-6-luna` | 0.20 | 0.02 | 1.20 |
| `openai-gpt-5-5` | 5.00 | 0.50 | 30.00 |
| `openai-gpt-5-4` | 2.50 | 0.25 | 15.00 |
| `openai-gpt-5-4-mini` | 0.75 | 0.075 | 4.50 |
| `openai-gpt-5-2` | 1.75 | 0.175 | 14.00 |
| `anthropic-claude-fable-5-2` | 8 | 0.20 | 40 |
| `anthropic-claude-fable-5-1` | 10 | 0.25 | 50 |
| `anthropic-claude-fable-5` | 10 | 1 | 50 |
| `anthropic-claude-opus-5-5` | 4 | 0.20 | 20 |
| `anthropic-claude-opus-5`, `-4-8`, `-4-7`, `-4-6`, `-4-5-20251101` | 5 | 0.50 | 25 |
| `anthropic-claude-sonnet-5-5` | 2 | 0.10 | 10 |
| `anthropic-claude-sonnet-5` | 2 | 0.20 | 10 |
| `anthropic-claude-sonnet-4-6` | 3 | 0.30 | 15 |
| `anthropic-claude-haiku-5-5` | 0.10 | 0.01 | 0.50 |
| `anthropic-claude-haiku-4-5-20251001` | 1 | 0.10 | 5 |

Not recorded, because hearings never use them: batch and flex/priority tiers, long-context tiers, cache-write prices (both providers now charge for cache writes: OpenAI 1.25× input for 30 minutes and 2.5× for 12 hours on GPT-5.6 and later; Anthropic 1.25× for 5 minutes and 2× for 1 hour), and Anthropic's 1.1× US-only routing (`inference_geo`). Hearings send no cache controls and no `inference_geo`. Reasoning and thinking tokens are billed as output on both providers.

How cached input is counted (from the prompt-caching guides, read the same day): OpenAI's `usage.input_tokens` **includes** `input_tokens_details.cached_tokens` (<https://developers.openai.com/api/docs/guides/prompt-caching>); Anthropic's `usage.input_tokens` **excludes** `cache_read_input_tokens` and `cache_creation_input_tokens` (<https://platform.claude.com/docs/en/build-with-claude/prompt-caching>). The estimate subtracts or adds accordingly (`callCostMicroUsd`).

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

## Structured and PDF checks (spec 04 §6.5, D-86): pending

Extraction hearings record each route's feature successor (`openai-responses-v3`, `openai-responses-reasoning-low-v2`, `anthropic-messages-v3`, `anthropic-messages-between-tools-v2`, `anthropic-messages-adaptive-low-v2`). Without a schema or a PDF each successor's body is byte-identical to its predecessor's (unit-tested), and plain hearings keep recording the plain versions. With features:

- OpenAI Responses: `text: {format: {type: "json_schema", name: "extraction", strict: true, schema}}`; a PDF as `{type: "input_file", filename: "document.pdf", file_data: "data:application/pdf;base64,…"}` before the first `input_text`; `detail` unset (decision 5).
- Anthropic Messages: `output_config: {format: {type: "json_schema", schema}}` (merged with `effort: "low"` on adaptive-low into one object; no beta header, never `output_format`); a PDF as `{type: "document", source: {type: "base64", media_type: "application/pdf", data}}` before the first text block. Citations stay off.
- A 400 whose message names the schema is `PROVIDER_SCHEMA_REJECTED`, one that names the PDF `PROVIDER_DOCUMENT_REJECTED` (both definite); hints pinned in `adapters-v3.test.ts` from the documented messages, to revise after the live check.

`structuredVerifiedAt` and `pdfVerifiedAt` stay null until `npm run smoke:providers` succeeds in mode `json` (a fixed six-field schema on a short text) or `pdf` (the same schema on `tests/fixtures/extraction/invoice-1p.pdf`) and the output parses and fits the schema (the script prints `structured.parsed` and `structured.fitsSchema`). Record input tokens for `pdf`: the per-page estimate (4,500 tokens) is corrected from it. Until then an extraction hearing is refused at Start (`structured_unverified`).

| Date | Provider | Model | Mode | Outcome | Parsed / fits | Tokens in/out | Recorded by |
|---|---|---|---|---|---|---|---|
| | openai | gpt-6-luna | json | | | | |
| | anthropic | claude-haiku-5-5 | json | | | | |
| | openai | gpt-6-luna | pdf | | | | |
| | anthropic | claude-haiku-5-5 | pdf | | | | |

## Deployed check (V12): pending

A real run in the deployed app, using keys saved through Settings, with the browser closed during generation.
