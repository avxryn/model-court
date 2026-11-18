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
  'summarization-v1': {
    "version": "summarization-v1",
    "family": "summarization",
    "name": "Summaries",
    "listed": true,
    "inputKinds": [
      "text"
    ],
    "outputContract": {
      "kind": "text"
    },
    "template": "summarize-v1",
    "defaultRubricVersion": "summary-v1",
    "defaultJuryInstructions": "A good summary is faithful to the document, covers the points listed below, and suits the reader named in the request.",
    "checks": [
      {
        "id": "length",
        "label": "Length within limit"
      },
      {
        "id": "format",
        "label": "Follows the format"
      },
      {
        "id": "required-points",
        "label": "Covers required points (by phrase)"
      },
      {
        "id": "must-not-mention",
        "label": "Avoids listed phrases"
      },
      {
        "id": "numbers-from-document",
        "label": "Numbers appear in the document"
      }
    ],
    "settingsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "lengthUnit": {
          "type": "string",
          "enum": [
            "words",
            "characters"
          ]
        },
        "maxLength": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "minLength": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "format": {
          "type": "string",
          "enum": [
            "any",
            "paragraph",
            "bullets"
          ]
        },
        "checkNumbers": {
          "type": "boolean"
        }
      },
      "required": [
        "lengthUnit",
        "maxLength",
        "format",
        "checkNumbers"
      ],
      "additionalProperties": false
    },
    "caseFieldsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "summarization"
        },
        "requiredPoints": {
          "maxItems": 6,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "text": {
                "type": "string"
              },
              "anyOf": {
                "minItems": 1,
                "maxItems": 4,
                "type": "array",
                "items": {
                  "type": "string"
                }
              }
            },
            "required": [
              "text",
              "anyOf"
            ],
            "additionalProperties": false
          }
        },
        "mustNotMention": {
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind",
        "requiredPoints",
        "mustNotMention"
      ],
      "additionalProperties": false
    }
  },
}

const summaryCase: CaseInput = {
  key: '00000000-0000-4000-8000-000000000002',
  title: 'Thread',
  input: 'Summarize for an agent taking over ticket 4512.',
  reference: 'Dana ordered a lamp on 2 March for 1,200 dollars. It arrived broken. Refunds are issued within 30 days of a report, with a photo.',
  expectedBehavior: 'Faithful.',
  kitFields: { kind: 'summarization', requiredPoints: [{ text: 'Refund window', anyOf: ['30 days'] }, { text: 'Photo needed', anyOf: ['photo', 'picture'] }], mustNotMention: ['Dana'] },
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
  'summarization-v1': [
    { case: summaryCase, settings: { lengthUnit: 'words', maxLength: 20, format: 'bullets', checkNumbers: true }, text: 'Ticket 4512:\n- Lamp arrived broken.\n- Refund within 30 days with a photo.', expected: [{"checkId":"length","status":"pass","reason":"12 words; the limit is 20.","detail":{"count":12,"unit":"words"}},{"checkId":"format","status":"pass","reason":"2 bullet points.","detail":{"line":null}},{"checkId":"required-points","status":"pass","reason":"Covers all 2 required points.","detail":{"matched":2,"total":2,"missing":[]}},{"checkId":"must-not-mention","status":"pass","reason":"None of the 1 listed phrase appears.","detail":{"found":[]}},{"checkId":"numbers-from-document","status":"pass","reason":"All 2 numbers appear in the document or the request.","detail":{"unsupported":[]}}] },
    { case: summaryCase, settings: { lengthUnit: 'words', maxLength: 8, minLength: 2, format: 'paragraph', checkNumbers: true }, text: '- Dana wants 45 dollars back by 2027.\nShe has a receipt.', expected: [{"checkId":"length","status":"fail","reason":"11 words; the limit is 8.","detail":{"count":11,"unit":"words"}},{"checkId":"format","status":"fail","reason":"Line 1 starts with a bullet marker; a paragraph was asked for.","detail":{"line":1}},{"checkId":"required-points","status":"fail","reason":"Missing 2 of 2: (1) Refund window; (2) Photo needed.","detail":{"matched":0,"total":2,"missing":[1,2]}},{"checkId":"must-not-mention","status":"fail","reason":"Mentions 'Dana'.","detail":{"found":["Dana"]}},{"checkId":"numbers-from-document","status":"fail","reason":"Not in the document: 45, 2027 (may be computed or reworded).","detail":{"unsupported":["45","2027"]}}] },
    { case: summaryCase, settings: { lengthUnit: 'characters', maxLength: 2000, format: 'any', checkNumbers: false }, text: '退款 within thirty days.', expected: [{"checkId":"length","status":"pass","reason":"19 characters; the limit is 2,000.","detail":{"count":19,"unit":"characters"}},{"checkId":"format","status":"na","reason":"Any format is allowed.","detail":{"line":null}},{"checkId":"required-points","status":"fail","reason":"Missing 2 of 2: (1) Refund window; (2) Photo needed.","detail":{"matched":0,"total":2,"missing":[1,2]}},{"checkId":"must-not-mention","status":"pass","reason":"None of the 1 listed phrase appears.","detail":{"found":[]}},{"checkId":"numbers-from-document","status":"na","reason":"The numbers check is off for this case.","detail":{"unsupported":[]}}] },
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
