/**
 * Dated list-price tables for cost estimates (spec 01 §5.1, D-62). Browser-safe.
 *
 * Every number is read by hand from the providers' official pricing pages and cited,
 * with the date read, in docs/provider-contracts.md ("Prices"). Tables are
 * append-only: once published, a table is never edited (a unit test pins each one's
 * canonical hash), so a record's estimate never changes after the fact. A price change
 * is a new table with a later `effectiveFrom`. Prices are never fetched at runtime.
 *
 * Only standard prices are recorded (non-batch, default service tier, below any
 * long-context threshold), because that is what hearings send.
 */

import type { ProviderId } from './registry'

export interface RoutePrice {
  /** As published, USD per 1M input tokens. */
  inputUsdPerMTok: number
  /** USD per 1M cached input tokens (OpenAI "cached input", Anthropic cache reads); null = not published. */
  cachedInputUsdPerMTok: number | null
  /** USD per 1M output tokens. Reasoning and thinking tokens are billed as output on both providers. */
  outputUsdPerMTok: number
}

export interface PriceTable {
  /** `YYYY-MM-DD.N`; append-only, never edited once published. */
  version: string
  /** ISO date the pricing pages were read. */
  readOn: string
  /** ISO date; hearings created on or after it use this table. */
  effectiveFrom: string
  /** The pricing pages the numbers were read from. */
  sources: Record<ProviderId, string>
  /** How the provider counts cached input: OpenAI includes it in `input_tokens`; Anthropic reports it separately. */
  cachedInputIncludedInInput: Record<ProviderId, boolean>
  /** By route key (`MODEL_ROUTES[].key`). */
  prices: Record<string, RoutePrice>
  /** Route key → why no price is on file. */
  unpriced: Record<string, string>
}

const p = (inputUsdPerMTok: number, cachedInputUsdPerMTok: number | null, outputUsdPerMTok: number): RoutePrice => ({ inputUsdPerMTok, cachedInputUsdPerMTok, outputUsdPerMTok })

/**
 * Read 2026-11-18 from https://developers.openai.com/api/docs/pricing (Standard tier, short
 * context: 272K input tokens or fewer) and https://platform.claude.com/docs/en/about-claude/pricing
 * (base input, cache hits and refreshes, output; Haiku 5.5 at prompts up to 100,000 tokens).
 * Cache-write prices are not recorded: hearings never ask for prompt caching.
 */
const TABLE_2026_11_18_1: PriceTable = {
  version: '2026-11-18.1',
  readOn: '2026-11-18',
  effectiveFrom: '2026-11-18',
  sources: {
    openai: 'https://developers.openai.com/api/docs/pricing',
    anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  },
  cachedInputIncludedInInput: { openai: true, anthropic: false },
  prices: {
    'openai-gpt-6-2-astra': p(8, 0.4, 40),
    'openai-gpt-6-2-sol': p(2, 0.1, 10),
    'openai-gpt-6-1-terra': p(1, 0.05, 5),
    'openai-gpt-6-1-sol': p(2, 0.1, 10),
    'openai-gpt-6-astra': p(10, 1, 50),
    'openai-gpt-6-sol': p(2, 0.2, 10),
    'openai-gpt-6-luna': p(0.1, 0.01, 0.5),
    'openai-gpt-5-6-sol': p(4, 0.4, 20),
    'openai-gpt-5-6-terra': p(2, 0.2, 12),
    'openai-gpt-5-6-luna': p(0.2, 0.02, 1.2),
    'openai-gpt-5-5': p(5, 0.5, 30),
    'openai-gpt-5-4': p(2.5, 0.25, 15),
    'openai-gpt-5-4-mini': p(0.75, 0.075, 4.5),
    'openai-gpt-5-2': p(1.75, 0.175, 14),
    'anthropic-claude-fable-5-2': p(8, 0.2, 40),
    'anthropic-claude-fable-5-1': p(10, 0.25, 50),
    'anthropic-claude-fable-5': p(10, 1, 50),
    'anthropic-claude-opus-5-5': p(4, 0.2, 20),
    'anthropic-claude-opus-5': p(5, 0.5, 25),
    'anthropic-claude-opus-4-8': p(5, 0.5, 25),
    'anthropic-claude-opus-4-7': p(5, 0.5, 25),
    'anthropic-claude-opus-4-6': p(5, 0.5, 25),
    'anthropic-claude-opus-4-5-20251101': p(5, 0.5, 25),
    'anthropic-claude-sonnet-5-5': p(2, 0.1, 10),
    'anthropic-claude-sonnet-5': p(2, 0.2, 10),
    'anthropic-claude-sonnet-4-6': p(3, 0.3, 15),
    'anthropic-claude-haiku-5-5': p(0.1, 0.01, 0.5),
    'anthropic-claude-haiku-4-5-20251001': p(1, 0.1, 5),
  },
  unpriced: {},
}

/** Oldest first. Append a new table for a price change; never edit a published one. */
export const PRICE_TABLES: readonly PriceTable[] = [TABLE_2026_11_18_1]

export const PRICE_TABLE_VERSION = PRICE_TABLES[PRICE_TABLES.length - 1].version

function dayStart(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`)
}

/**
 * The table for a hearing created at `createdAt` (ms): the latest table effective on or
 * before that day. Hearings older than the first table use the first table, marked `predates`
 * ("prices read after this hearing"). The hearing snapshot is never touched.
 */
export function priceTableFor(createdAt: number, tables: readonly PriceTable[] = PRICE_TABLES): { table: PriceTable; predates: boolean } {
  const ordered = [...tables].sort((a, b) => dayStart(a.effectiveFrom) - dayStart(b.effectiveFrom))
  let chosen: PriceTable | null = null
  for (const table of ordered) if (dayStart(table.effectiveFrom) <= createdAt) chosen = table
  return chosen ? { table: chosen, predates: false } : { table: ordered[0], predates: true }
}

export function priceFor(routeKey: string, table: PriceTable): RoutePrice | null {
  return Object.hasOwn(table.prices, routeKey) ? table.prices[routeKey] : null
}

export interface CallUsage {
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
}

/**
 * Estimated cost of one call in integer µUSD (tokens × USD per 1M tokens = µUSD), rounded once.
 *
 *   openai:    (input − cached) × input + cached × cached rate + output × output
 *   anthropic: input × input + cached × cached rate + output × output   (cached reported separately)
 *
 * Unknown input or output usage → null (unknown, never 0). Unknown cached tokens, or no
 * published cached rate, price cached input at the full input rate (an upper bound on OpenAI).
 */
export function callCostMicroUsd(provider: ProviderId, usage: CallUsage, price: RoutePrice, table: Pick<PriceTable, 'cachedInputIncludedInInput'>): { microUsd: number; cachedAssumedFull: boolean } | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null
  const cachedRate = price.cachedInputUsdPerMTok ?? price.inputUsdPerMTok
  const included = table.cachedInputIncludedInInput[provider]
  const cached = usage.cachedInputTokens
  let input: number
  if (cached === null) {
    input = usage.inputTokens * price.inputUsdPerMTok
  } else if (included) {
    const cachedPart = Math.min(cached, usage.inputTokens)
    input = (usage.inputTokens - cachedPart) * price.inputUsdPerMTok + cachedPart * cachedRate
  } else {
    input = usage.inputTokens * price.inputUsdPerMTok + cached * cachedRate
  }
  return {
    microUsd: Math.round(input + usage.outputTokens * price.outputUsdPerMTok),
    cachedAssumedFull: included && (cached === null || price.cachedInputUsdPerMTok === null),
  }
}
