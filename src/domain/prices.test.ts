import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from './canonical'
import { callCostMicroUsd, PRICE_TABLE_VERSION, PRICE_TABLES, priceFor, priceTableFor, type PriceTable } from './prices'
import { MODEL_ROUTES } from './registry'

/** Published tables are immutable (D-62). A new price is a new table; never update a hash here. */
const PUBLISHED_HASHES: Record<string, string> = {
  '2026-11-18.1': '81f0dbd9dc6c125753e760a935151e6970a62724346868e2afe09bc1c386f16c',
  '2026-11-19.1': '980e46a17f4487fab4df716d0b8d7ce684047a38b1d17584c2509f08bdd0ddf2',
  '2026-11-19.2': '183109d350e6693429f056bcc391e2e5fed5d622fe22fc0491d6134bb98ebf32',
  '2026-11-19.3': '89b03c8cfdac2d96ff63b8a7529cfaa3ee3ade1075c378d171c4665cf893d1c8',
}

const T = (version: string, effectiveFrom: string): PriceTable => ({ ...PRICE_TABLES[0], version, effectiveFrom })

describe('price tables', () => {
  it('prices or lists as unpriced every route of the providers it covers, never both', () => {
    for (const table of PRICE_TABLES) {
      // A table covers the providers it cites; 2026-11-18.1 predates Google (spec 07).
      for (const route of MODEL_ROUTES.filter((r) => Object.hasOwn(table.sources, r.provider))) {
        const priced = Object.hasOwn(table.prices, route.key)
        const unpriced = Object.hasOwn(table.unpriced, route.key)
        expect(priced !== unpriced, `${table.version}: ${route.key}`).toBe(true)
      }
      for (const key of [...Object.keys(table.prices), ...Object.keys(table.unpriced)]) {
        expect(MODEL_ROUTES.some((route) => route.key === key), `${table.version}: unknown route ${key}`).toBe(true)
      }
    }
  })

  it('records positive prices with cached input no dearer than input', () => {
    for (const table of PRICE_TABLES) {
      for (const [key, price] of Object.entries(table.prices)) {
        expect(price.inputUsdPerMTok, key).toBeGreaterThan(0)
        expect(price.outputUsdPerMTok, key).toBeGreaterThan(0)
        if (price.cachedInputUsdPerMTok !== null) expect(price.cachedInputUsdPerMTok, key).toBeLessThanOrEqual(price.inputUsdPerMTok)
      }
    }
  })

  it('keeps published tables frozen and ordered', async () => {
    for (const table of PRICE_TABLES) {
      expect(await sha256Hex(canonicalJson(table)), table.version).toBe(PUBLISHED_HASHES[table.version])
    }
    const dates = PRICE_TABLES.map((table) => table.effectiveFrom)
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(PRICE_TABLES.map((table) => table.version)).size).toBe(PRICE_TABLES.length)
    expect(PRICE_TABLE_VERSION).toBe(PRICE_TABLES.at(-1)!.version)
  })
})

describe('priceTableFor', () => {
  const tables = [T('a', '2026-11-18'), T('b', '2026-12-01')]
  it('picks the latest table effective on or before the hearing day', () => {
    expect(priceTableFor(Date.parse('2026-11-18T00:00:00Z'), tables)).toMatchObject({ table: { version: 'a' }, predates: false })
    expect(priceTableFor(Date.parse('2026-11-30T23:59:59Z'), tables)).toMatchObject({ table: { version: 'a' }, predates: false })
    expect(priceTableFor(Date.parse('2026-12-01T00:00:00Z'), tables)).toMatchObject({ table: { version: 'b' }, predates: false })
  })
  it('uses the first table for older hearings and says so', () => {
    expect(priceTableFor(Date.parse('2026-11-17T23:59:59Z'), tables)).toMatchObject({ table: { version: 'a' }, predates: true })
    expect(priceTableFor(Date.parse('2026-11-17T12:00:00Z'))).toMatchObject({ table: { version: '2026-11-18.1' }, predates: true })
  })
})

describe('callCostMicroUsd', () => {
  const price = { inputUsdPerMTok: 2, cachedInputUsdPerMTok: 0.5, outputUsdPerMTok: 10 }
  const table = { cachedInputIncludedInInput: { openai: true, anthropic: false } }

  it('is tokens × USD per 1M tokens, in µUSD, rounded once', () => {
    expect(callCostMicroUsd('openai', { inputTokens: 1000, outputTokens: 100, cachedInputTokens: null }, price, table)).toEqual({ microUsd: 3000, cachedAssumedFull: true })
    expect(callCostMicroUsd('anthropic', { inputTokens: 3, outputTokens: 1, cachedInputTokens: null }, { inputUsdPerMTok: 0.1, cachedInputUsdPerMTok: 0.01, outputUsdPerMTok: 0.5 }, table)).toEqual({ microUsd: 1, cachedAssumedFull: false })
  })

  it('subtracts cached input on OpenAI and adds it on Anthropic', () => {
    expect(callCostMicroUsd('openai', { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 400 }, price, table)?.microUsd).toBe(600 * 2 + 400 * 0.5)
    expect(callCostMicroUsd('anthropic', { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 400 }, price, table)?.microUsd).toBe(1000 * 2 + 400 * 0.5)
  })

  it('prices cached input at the full rate when no cached rate is published', () => {
    expect(callCostMicroUsd('openai', { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 400 }, { ...price, cachedInputUsdPerMTok: null }, table)).toEqual({ microUsd: 2000, cachedAssumedFull: true })
  })

  it('is unknown, never 0, without input or output usage', () => {
    expect(callCostMicroUsd('openai', { inputTokens: null, outputTokens: 10, cachedInputTokens: null }, price, table)).toBeNull()
    expect(callCostMicroUsd('openai', { inputTokens: 10, outputTokens: null, cachedInputTokens: null }, price, table)).toBeNull()
  })

  it('prices Gemini with cached input inside the prompt count, and dates its announced rises (spec 07 §10.3)', () => {
    const now = priceTableFor(Date.parse('2026-11-19T12:00:00Z')).table
    expect(now.version).toBe('2026-11-19.1')
    expect(now.cachedInputIncludedInInput.google).toBe(true)
    expect(now.sources.google).toBe('https://aistudio.google.com/docs/pricing')
    const flash = priceFor('google-gemini-3-6-flash', now)!
    expect(callCostMicroUsd('google', { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400 }, flash, now)).toEqual({ microUsd: 600 * 0.75 + 400 * 0.075 + 100 * 3.75, cachedAssumedFull: false })
    // OpenAI and Anthropic rows carry over unchanged.
    for (const [key, price] of Object.entries(PRICE_TABLES[0].prices)) expect(now.prices[key], key).toEqual(price)
    const december = priceTableFor(Date.parse('2026-12-01T00:00:00Z')).table
    expect(december.version).toBe('2026-11-19.2')
    expect(priceFor('google-gemini-4-carbon', december)).toEqual({ inputUsdPerMTok: 4, cachedInputUsdPerMTok: 0.2, outputUsdPerMTok: 20 })
    expect(priceFor('google-gemini-3-6-flash', december)).toEqual(flash)
    const january = priceTableFor(Date.parse('2027-01-01T00:00:00Z')).table
    expect(january.version).toBe('2026-11-19.3')
    expect(priceFor('google-gemini-3-8-flash', january)).toEqual({ inputUsdPerMTok: 1.5, cachedInputUsdPerMTok: 0.15, outputUsdPerMTok: 7.5 })
    // A hearing from before Google was priced has no Gemini price (unknown, never 0).
    expect(priceFor('google-gemini-3-6-flash', PRICE_TABLES[0])).toBeNull()
  })

  it('looks prices up by route key', () => {
    expect(priceFor('openai-gpt-6-luna', PRICE_TABLES[0])).toEqual({ inputUsdPerMTok: 0.1, cachedInputUsdPerMTok: 0.01, outputUsdPerMTok: 0.5 })
    expect(priceFor('nope', PRICE_TABLES[0])).toBeNull()
  })
})
