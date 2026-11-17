import { describe, expect, it } from 'vitest'
import { parseConfig } from './config'

const base = { DEEPSPACE_APP_ID: 'app_test' }

describe('MAX_CONFIGURATIONS_PER_RUN (F24)', () => {
  it('defaults to three and accepts two or three', () => {
    expect(parseConfig(base).maxConfigurationsPerRun).toBe(3)
    expect(parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: '2' }).maxConfigurationsPerRun).toBe(2)
    expect(parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: '3' }).maxConfigurationsPerRun).toBe(3)
  })

  it('fails closed to two on any other value', () => {
    for (const value of ['1', '4', '2.5', 'three', '-3']) {
      const config = parseConfig({ ...base, MAX_CONFIGURATIONS_PER_RUN: value })
      expect(config.maxConfigurationsPerRun).toBe(2)
      expect(config.problems.some((p) => p.includes('MAX_CONFIGURATIONS_PER_RUN'))).toBe(true)
    }
  })
})
