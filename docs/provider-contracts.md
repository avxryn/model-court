# Provider contracts (BYOK)

Status: **documented from the providers' official docs on 2026-11-16; one real call per route recorded on 2026-11-17 (below).**
Both routes have `verifiedAt: '2026-11-17'` in the registry (version `2026-11-17.1`). The deployed check (V12) is still pending.

| Registry key | Endpoint | Model | Request specifics | Auth |
|---|---|---|---|---|
| `openai-gpt-6-luna` | `POST https://api.openai.com/v1/responses` | `gpt-6-luna` | `instructions`, one user `input_text`, `max_output_tokens: 512`, `reasoning: {effort: "none"}`, `store: false` | `Authorization: Bearer <owner key>` |
| `anthropic-claude-haiku-5-5` | `POST https://api.anthropic.com/v1/messages` | `claude-haiku-5-5` | `system`, one user message, `max_tokens: 512`, `thinking: {type: "disabled"}` | `x-api-key: <owner key>`, `anthropic-version: 2026-10-21` |

Why reasoning/thinking is off: both providers count reasoning tokens against the output cap; with
512 tokens a reasoning model can return no visible text (`EMPTY_OUTPUT`).

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

## Deployed check (V12): pending

A real run in the deployed app, using keys saved through Settings, with the browser closed during generation.
