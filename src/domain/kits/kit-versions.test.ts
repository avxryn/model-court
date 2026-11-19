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
  'classification-v1': {
    "version": "classification-v1",
    "family": "classification",
    "name": "Classification",
    "listed": true,
    "inputKinds": [
      "text"
    ],
    "outputContract": {
      "kind": "label",
      "format": "first-line-v1"
    },
    "template": "classify-v1",
    "defaultRubricVersion": "classification-v1",
    "defaultJuryInstructions": "Judge whether the reasoning supports the label and rests on what the item actually says. The expected label, if given, is the judge's answer key.",
    "checks": [
      {
        "id": "label-format",
        "label": "Names one allowed label"
      },
      {
        "id": "label-correct",
        "label": "Matches the expected label"
      },
      {
        "id": "reasoning-given",
        "label": "Gives reasoning"
      }
    ],
    "settingsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "labels": {
          "minItems": 2,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "minReasoningWords": {
          "type": "integer",
          "minimum": 0,
          "maximum": 50
        }
      },
      "required": [
        "labels",
        "minReasoningWords"
      ],
      "additionalProperties": false
    },
    "caseFieldsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "classification"
        },
        "expectedLabel": {
          "type": "string"
        },
        "alsoAccept": {
          "maxItems": 5,
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    }
  },
  'extraction-v1': {
    "version": "extraction-v1",
    "family": "extraction",
    "name": "Pull fields from documents",
    "listed": false,
    "inputKinds": [
      "document"
    ],
    "outputContract": {
      "kind": "json",
      "schemaSource": "kit-settings"
    },
    "template": "extract-v1",
    "defaultRubricVersion": "extraction-v1",
    "defaultJuryInstructions": "Check each value against the document. Mark a value Invented if the document doesn't support it, Ambiguous if the document could fairly be read another way.",
    "checks": [
      {
        "id": "json-parse",
        "label": "Valid JSON"
      },
      {
        "id": "json-schema",
        "label": "Fits the field list"
      },
      {
        "id": "required-filled",
        "label": "Must-fill fields filled"
      },
      {
        "id": "answer-key",
        "label": "Matches the answer key"
      }
    ],
    "settingsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "schema": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "compare": {
          "type": "object",
          "propertyNames": {
            "type": "string",
            "pattern": "^(\\/([A-Za-z_][A-Za-z0-9_]{0,63}|\\*))+$"
          },
          "additionalProperties": {
            "anyOf": [
              {
                "type": "string",
                "enum": [
                  "exact",
                  "alnum",
                  "date-only",
                  "ordered",
                  "set"
                ]
              },
              {
                "type": "object",
                "properties": {
                  "tolerance": {
                    "type": "number",
                    "minimum": 0
                  }
                },
                "required": [
                  "tolerance"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "matchBy": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 64
                  }
                },
                "required": [
                  "matchBy"
                ],
                "additionalProperties": false
              }
            ]
          }
        }
      },
      "required": [
        "schema",
        "compare"
      ],
      "additionalProperties": false
    },
    "caseFieldsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "extraction"
        },
        "answerKey": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "document": {
          "type": "object",
          "properties": {
            "sha256": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "byteLength": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            "delivery": {
              "type": "string",
              "enum": [
                "text",
                "pdf_native"
              ]
            },
            "pageCount": {
              "anyOf": [
                {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "required": [
            "sha256",
            "byteLength",
            "delivery",
            "pageCount"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "kind"
      ],
      "additionalProperties": false
    }
  },
}

const extractionSettings = {"schema":{"type":"object","properties":{"vendor":{"type":"string","title":"Vendor"},"total":{"type":"number"},"po":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}}},"required":["vendor","total","tags"]},"compare":{"/total":{"tolerance":0.01}}}
const extractionCase: CaseInput = {"key":"00000000-0000-4000-8000-000000000004","title":"Invoice","input":"Extract the fields from the document.","reference":"","expectedBehavior":"Check each value.","kitFields":{"kind":"extraction","answerKey":{"vendor":"Acme Ltd","total":10,"po":null,"tags":["office"]}}} as CaseInput

const classificationCase: CaseInput = {
  key: '00000000-0000-4000-8000-000000000003',
  title: 'Ticket',
  input: 'I was charged twice for my plan this month.',
  reference: '',
  expectedBehavior: 'Route it.',
  kitFields: { kind: 'classification' as const, expectedLabel: 'Billing', alsoAccept: ['Other'] },
}
const classificationSettings = { labels: ['Billing', 'Bug', 'Account access', 'Other'], minReasoningWords: 5 }

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
  'extraction-v1': [
    { case: extractionCase, settings: extractionSettings, text: "{\"vendor\":\"ACME  ltd\",\"total\":10.004,\"po\":null,\"tags\":[\"Office\"]}", expected: [{"checkId":"json-parse","status":"pass","reason":"The answer is valid JSON.","detail":{}},{"checkId":"json-schema","status":"pass","reason":"Fits the field list.","detail":{"errors":0}},{"checkId":"required-filled","status":"pass","reason":"Every must-fill field is filled.","detail":{"blank":0}},{"checkId":"answer-key","status":"pass","reason":"4 of 4 match.","detail":{"compared":4,"matched":4,"mismatched":0,"missed":0,"invented":0}}] },
    { case: extractionCase, settings: extractionSettings, text: "{\"vendor\":\"\",\"total\":\"10\",\"po\":\"PO-1\",\"tags\":[]}", expected: [{"checkId":"json-parse","status":"pass","reason":"The answer is valid JSON.","detail":{}},{"checkId":"json-schema","status":"fail","reason":"/total: expected number, got string.","detail":{"errors":1,"paths":["/total"]}},{"checkId":"required-filled","status":"fail","reason":"/vendor, /tags are empty.","detail":{"blank":2,"paths":["/vendor","/tags"]}},{"checkId":"answer-key","status":"fail","reason":"0 of 4 match; 1 wrong, 1 invented, 2 missed.","detail":{"compared":4,"matched":0,"mismatched":1,"missed":2,"invented":1}}] },
    { case: extractionCase, settings: extractionSettings, text: "Sure! {\"vendor\":\"Acme\"}", expected: [{"checkId":"json-parse","status":"fail","reason":"Not JSON: the answer starts with text.","detail":{}},{"checkId":"json-schema","status":"na","reason":"No JSON to check.","detail":{}},{"checkId":"required-filled","status":"na","reason":"No JSON to check.","detail":{}},{"checkId":"answer-key","status":"na","reason":"No JSON to check.","detail":{}}] },
  ],
  'classification-v1': [
    { case: classificationCase, settings: classificationSettings, text: 'Label: Billing\nThe customer reports a duplicate charge on the plan.', expected: [{"checkId":"label-format","status":"pass","reason":"Names Billing.","detail":{"predicted":"Billing"}},{"checkId":"label-correct","status":"pass","reason":"Said Billing, the expected label.","detail":{"expected":"Billing","predicted":"Billing"}},{"checkId":"reasoning-given","status":"pass","reason":"9 words of reasoning.","detail":{"words":9}}] },
    { case: classificationCase, settings: classificationSettings, text: '**Label:** bug.\nCrash.', expected: [{"checkId":"label-format","status":"pass","reason":"Names Bug.","detail":{"predicted":"Bug"}},{"checkId":"label-correct","status":"fail","reason":"Said Bug; the expected label is Billing.","detail":{"expected":"Billing","predicted":"Bug"}},{"checkId":"reasoning-given","status":"fail","reason":"1 word of reasoning; at least 5 expected.","detail":{"words":1}}] },
    { case: classificationCase, settings: classificationSettings, text: 'Probably a billing issue.', expected: [{"checkId":"label-format","status":"fail","reason":"The first line, 'Probably a billing issue.', names no allowed label.","detail":{"predicted":null}},{"checkId":"label-correct","status":"fail","reason":"No allowed label, so it cannot match Billing.","detail":{"expected":"Billing","predicted":null}},{"checkId":"reasoning-given","status":"fail","reason":"0 words of reasoning; at least 5 expected.","detail":{"words":0}}] },
    { case: { ...classificationCase, kitFields: { kind: 'classification' as const } }, settings: { ...classificationSettings, minReasoningWords: 0 }, text: 'Other', expected: [{"checkId":"label-format","status":"pass","reason":"Names Other.","detail":{"predicted":"Other"}},{"checkId":"label-correct","status":"na","reason":"No expected label for this question.","detail":{"expected":null,"predicted":null}},{"checkId":"reasoning-given","status":"na","reason":"The reasoning check is off for this case.","detail":{"words":0}}] },
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
