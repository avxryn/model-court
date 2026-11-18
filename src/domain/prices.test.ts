import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex } from './canonical'
import { callCostMicroUsd, PRICE_TABLE_VERSION, PRICE_TABLES, priceFor, priceTableFor, type PriceTable } from './prices'
import { MODEL_ROUTES } from './registry'

/** Published tables are immutable (D-62). A new price is a new table; never update a hash here. */
const PUBLISHED_HASHES: Record<string, string> = {
  '2026-11-18.1': '81f0dbd9dc6c125753e760a935151e6970a62724346868e2afe09bc1c386f16c',
}

const T = (version: string, effectiveFrom: string): PriceTable => ({ ...PRICE_TABLES[0], version, effectiveFrom })

describe('price tables', () => {
  it('prices or lists as unpriced every route, never both', () => {
    for (const table of PRICE_TABLES) {
      for (const route of MODEL_ROUTES) {
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

  it('looks prices up by route key', () => {
    expect(priceFor('openai-gpt-6-luna', PRICE_TABLES[0])).toEqual({ inputUsdPerMTok: 0.1, cachedInputUsdPerMTok: 0.01, outputUsdPerMTok: 0.5 })
    expect(priceFor('nope', PRICE_TABLES[0])).toBeNull()
  })
})
