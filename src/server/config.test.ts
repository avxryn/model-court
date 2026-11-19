import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'

const base = { DEEPSPACE_APP_ID: 'app_test' }

describe('MAX_CONFIGURATIONS_PER_RUN (F24)', () => {
  it('defaults to three (spec 07 Q5) and accepts two to five', () => {
    expect(parseConfig(base).maxConfigurationsPerRun).toBe(3)
    expect(parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: '' }).maxConfigurationsPerRun).toBe(3)
    for (const n of [2, 3, 4, 5]) expect(parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: String(n) }).maxConfigurationsPerRun).toBe(n)
    expect(parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: '5' }).problems).toEqual(parseConfig(base).problems)
  })

  it('fails closed to two on any other value', () => {
    for (const value of ['1', '6', '2.5', 'three', '-3']) {
      const config = parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: value })
      expect(config.maxConfigurationsPerRun).toBe(2)
      expect(config.problems.some((p) => p.includes('MAX_CONFIGURATIONS_PER_RUN'))).toBe(true)
    }
  })
})
