/**
 * Published kit versions are immutable (spec 03 §3.2, D-75). This test pins each version's
 * metadata and a table of check outputs on fixed inputs. If it fails, do not update the pins:
 * ship a new kit version and mark the old one `listed: false`.
 */

import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { KIT_VERSIONS, KITS } from './registry'
import { runChecks } from './runner'
import type { TaskKit } from './types'

function metadata(kit: TaskKit<unknown, unknown>) {
  return {
    version: kit.version,
    family: kit.family,
    name: kit.name,
    listed: kit.listed,
    inputKinds: kit.inputKinds,
    outputContract: kit.outputContract,
    template: kit.selectTemplate([{}]),
    defaultRubricVersion: kit.defaultRubricVersion,
    defaultJuryInstructions: kit.defaultJuryInstructions,
    checks: kit.checks.map((check) => ({ id: check.id, label: check.label })),
    settingsSchema: kit.settingsSchema ? z.toJSONSchema(kit.settingsSchema) : null,
    caseFieldsSchema: kit.caseFieldsSchema ? z.toJSONSchema(kit.caseFieldsSchema) : null,
  }
}

const PINNED: Record<string, unknown> = {
  'general-v1': {
    version: 'general-v1',
    family: 'general',
    name: 'General answers',
    listed: true,
    inputKinds: ['text', 'conversation'],
    outputContract: { kind: 'text' },
    template: 'qa-v1',
    defaultRubricVersion: 'reference-qa-v1',
    defaultJuryInstructions: null,
    checks: [],
    settingsSchema: null,
    caseFieldsSchema: null,
  },
}

/** Fixed inputs → expected check results, per kit version. */
const OUTPUTS: Record<string, Array<{ case: CaseInput; settings: unknown; text: string; expected: unknown }>> = {
  'general-v1': [
    {
      case: { key: '00000000-0000-4000-8000-000000000001', title: 'T', input: 'Q', reference: '', expectedBehavior: 'E' },
      settings: undefined,
      text: 'Any answer.',
      expected: [],
    },
  ],
}

describe('published kit versions', () => {
  it('every registered version is pinned, and only those', () => {
    expect([...KIT_VERSIONS].sort()).toEqual(Object.keys(PINNED).sort())
  })

  for (const version of KIT_VERSIONS) {
    it(`${version}: metadata is unchanged`, () => {
      expect(metadata(KITS[version] as TaskKit<unknown, unknown>)).toEqual(PINNED[version])
    })

    it(`${version}: check outputs on fixed inputs are unchanged`, () => {
      for (const row of OUTPUTS[version] ?? []) {
        expect(runChecks(KITS[version] as TaskKit<unknown, unknown>, row.settings, row.case, { kind: 'text', text: row.text }).results).toEqual(row.expected)
      }
    })
  }
})
