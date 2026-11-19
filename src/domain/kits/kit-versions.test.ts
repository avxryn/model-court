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
import { EXAMPLE_TOOL_TASK } from '../tools/task'
import type { JurorToolTrace } from '../tools/trace'
import type { CheckMaterials, TaskKit, Testimony } from './types'

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
    "listed": true,
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
  'grounded-v1': {
    "version": "grounded-v1",
    "family": "grounded",
    "name": "Answers from sources",
    "listed": true,
    "inputKinds": [
      "sources"
    ],
    "outputContract": {
      "kind": "text"
    },
    "template": "grounded-v1",
    "defaultRubricVersion": "grounded-v1",
    "defaultJuryInstructions": "Check each claim against the source it cites. A claim the cited source does not support is not grounded, even if it is true.",
    "checks": [
      {
        "id": "cites-something",
        "label": "Cites a source"
      },
      {
        "id": "citations-exist",
        "label": "Citations point to real sources"
      },
      {
        "id": "quotes-match",
        "label": "Quotes match their sources"
      },
      {
        "id": "required-cited",
        "label": "Required sources cited"
      },
      {
        "id": "refusal",
        "label": "Refuses only when it should"
      }
    ],
    "settingsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "caseFieldsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "grounded"
        },
        "answerable": {
          "type": "string",
          "enum": [
            "yes",
            "partly",
            "no"
          ]
        },
        "requiredSources": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
          }
        },
        "sources": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "number": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10
              },
              "sha256": {
                "type": "string",
                "pattern": "^[0-9a-f]{64}$"
              },
              "byteLength": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "number",
              "sha256",
              "byteLength"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "kind",
        "answerable",
        "requiredSources"
      ],
      "additionalProperties": false
    }
  },
  'tools-v1': {
    "version": "tools-v1",
    "family": "tools",
    "name": "Tool use (mock tools)",
    "listed": false,
    "inputKinds": [
      "tools"
    ],
    "outputContract": {
      "kind": "toolTrace"
    },
    "template": "tools-v1",
    "defaultRubricVersion": "tools-trajectory-v1",
    "defaultJuryInstructions": "Judge the whole path: did it call the right tools with sensible arguments, use what the tools returned, handle errors, stop when it was done, and give a correct final answer?",
    "checks": [
      {
        "id": "required-calls",
        "label": "Required calls made"
      },
      {
        "id": "forbidden-not-called",
        "label": "Forbidden tools not called"
      },
      {
        "id": "arguments-valid",
        "label": "Arguments valid"
      },
      {
        "id": "steps-used",
        "label": "Within the target number of calls"
      },
      {
        "id": "finished",
        "label": "Finished the task"
      },
      {
        "id": "final-answer",
        "label": "Final answer as expected"
      }
    ],
    "settingsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {},
      "additionalProperties": false
    },
    "caseFieldsSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "const": "tools"
        },
        "tools": {
          "minItems": 1,
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"
              },
              "description": {
                "type": "string"
              },
              "parameters": {
                "type": "object",
                "propertyNames": {
                  "type": "string"
                },
                "additionalProperties": {}
              },
              "responses": {
                "maxItems": 10,
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "when": {
                      "type": "object",
                      "propertyNames": {
                        "type": "string"
                      },
                      "additionalProperties": {}
                    },
                    "textMatch": {
                      "type": "string",
                      "enum": [
                        "loose",
                        "exact"
                      ]
                    },
                    "output": {
                      "type": "string"
                    },
                    "isError": {
                      "type": "boolean"
                    }
                  },
                  "required": [
                    "when",
                    "textMatch",
                    "output",
                    "isError"
                  ],
                  "additionalProperties": false
                }
              },
              "defaultResponse": {
                "type": "object",
                "properties": {
                  "output": {
                    "type": "string"
                  },
                  "isError": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "output",
                  "isError"
                ],
                "additionalProperties": false
              },
              "errorResponse": {
                "type": "object",
                "properties": {
                  "output": {
                    "type": "string"
                  }
                },
                "required": [
                  "output"
                ],
                "additionalProperties": false
              }
            },
            "required": [
              "name",
              "description",
              "parameters",
              "responses",
              "defaultResponse",
              "errorResponse"
            ],
            "additionalProperties": false
          }
        },
        "maxSteps": {
          "type": "integer",
          "minimum": 1,
          "maximum": 6
        },
        "expect": {
          "type": "object",
          "properties": {
            "requiredCalls": {
              "maxItems": 8,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "tool": {
                    "type": "string",
                    "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"
                  },
                  "withArguments": {
                    "type": "object",
                    "propertyNames": {
                      "type": "string"
                    },
                    "additionalProperties": {}
                  }
                },
                "required": [
                  "tool"
                ],
                "additionalProperties": false
              }
            },
            "requireOrder": {
              "type": "boolean"
            },
            "forbiddenTools": {
              "maxItems": 8,
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$"
              }
            },
            "targetSteps": {
              "type": "integer",
              "minimum": 1,
              "maximum": 6
            },
            "finalAnswer": {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "enum": [
                    "exact",
                    "contains"
                  ]
                },
                "value": {
                  "type": "string"
                }
              },
              "required": [
                "mode",
                "value"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "requiredCalls",
            "requireOrder",
            "forbiddenTools"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "kind",
        "tools",
        "maxSteps",
        "expect"
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

const groundedCase: CaseInput = {"key":"00000000-0000-4000-8000-000000000005","title":"Refunds","input":"How long do I have?","reference":"","expectedBehavior":"Check each claim.","kitFields":{"kind":"grounded","answerable":"yes","requiredSources":[1,2],"sources":[{"number":1,"sha256":"1111111111111111111111111111111111111111111111111111111111111111","byteLength":60},{"number":2,"sha256":"2222222222222222222222222222222222222222222222222222222222222222","byteLength":40}]}} as CaseInput
const groundedMaterials: CheckMaterials = {"sources":[{"number":1,"title":"Refunds","text":"Customers can request a refund within 30 days of purchase."},{"number":2,"title":null,"text":"Refunds go back to the original card."}]}

const toolsCase: CaseInput = { key: '00000000-0000-4000-8000-000000000006', title: 'Late order', input: 'Where is order A-1042?', reference: '', expectedBehavior: 'Look it up first.', kitFields: { kind: 'tools', ...EXAMPLE_TOOL_TASK } }
const strictToolsCase: CaseInput = { ...toolsCase, kitFields: { kind: 'tools', ...EXAMPLE_TOOL_TASK, expect: { requiredCalls: [{ tool: 'lookup_order' }], requireOrder: false, forbiddenTools: ['refund_shipping'], targetSteps: 1 } } }
const lookupCall = { callNo: 1, tool: 'lookup_order', knownTool: true, arguments: '{\n  "order_id": "A-1042"\n}', result: { text: '{"status": "delayed"}', isError: false } }
const refundCall = { callNo: 2, tool: 'refund_shipping', knownTool: true, arguments: '{\n  "order_id": "a-1042"\n}', result: { text: '{"refunded": 6.5}', isError: false } }
const toolTraces: JurorToolTrace[] = [
  { steps: [{ stepNo: 1, text: 'Checking.', calls: [lookupCall] }, { stepNo: 2, text: null, calls: [refundCall] }, { stepNo: 3, text: null, calls: [] }], finalAnswer: 'Refunded $6.50. It arrives in 3 to 5 business days.', ended: 'answered' },
  { steps: [{ stepNo: 1, text: null, calls: [lookupCall] }, { stepNo: 2, text: 'Refunding.', calls: [{ ...refundCall, result: { notSent: true } }] }], finalAnswer: null, ended: 'step_cap' },
  { steps: [{ stepNo: 1, text: null, calls: [{ callNo: 1, tool: 'lookup_order', knownTool: true, arguments: '(unreadable)', result: { text: '{"error": "order_id is required."}', isError: true } }, { callNo: 2, tool: 'cancel_order', knownTool: false, arguments: '{}', result: { text: 'Unknown tool "cancel_order".', isError: true } }] }, { stepNo: 2, text: null, calls: [] }], finalAnswer: 'Your order is', ended: 'truncated' },
]
const toolTestimony = (trace: JurorToolTrace): Testimony => ({ kind: 'toolTrace', text: trace.finalAnswer ?? '', trace })

/** Fixed inputs → expected check results, per kit version. */
const OUTPUTS: Record<string, Array<{ case: CaseInput; settings: unknown; text: string; expected: unknown; materials?: CheckMaterials; testimony?: Testimony }>> = {
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
  'grounded-v1': [
    { case: groundedCase, settings: {}, materials: groundedMaterials, text: "30 days [S1: \"within 30 days\"], back to your card [S2].", expected: [{"checkId":"cites-something","status":"pass","reason":"2 citations to the sources.","detail":{"citations":2,"toRealSources":2}},{"checkId":"citations-exist","status":"pass","reason":"Every citation points to S1–S2.","detail":{"unknown":[]}},{"checkId":"quotes-match","status":"pass","reason":"The quote was found in its source.","detail":{"quotes":1,"found":1,"missing":[]}},{"checkId":"required-cited","status":"pass","reason":"Cites every required source (S1 and S2).","detail":{"required":[1,2],"missing":[]}},{"checkId":"refusal","status":"pass","reason":"Answers without saying the sources lack the answer.","detail":{"refused":false}}] },
    { case: groundedCase, settings: {}, materials: groundedMaterials, text: "Thirty days [S1: \"within thirty days\"] [S7].", expected: [{"checkId":"cites-something","status":"pass","reason":"1 citation to the sources.","detail":{"citations":2,"toRealSources":1}},{"checkId":"citations-exist","status":"fail","reason":"Cites S7; this question has 2 sources.","detail":{"unknown":[7]}},{"checkId":"quotes-match","status":"fail","reason":"0 of 1 quote found; the quote cited to S1 is not in S1.","detail":{"quotes":1,"found":0,"missing":[1]}},{"checkId":"required-cited","status":"fail","reason":"S2 is required and not cited.","detail":{"required":[1,2],"missing":[2]}},{"checkId":"refusal","status":"pass","reason":"Answers without saying the sources lack the answer.","detail":{"refused":false}}] },
    { case: groundedCase, settings: {}, materials: groundedMaterials, text: "The sources do not contain the answer.", expected: [{"checkId":"cites-something","status":"fail","reason":"No citation in the [S1] format.","detail":{"citations":0,"toRealSources":0}},{"checkId":"citations-exist","status":"na","reason":"No citations.","detail":{}},{"checkId":"quotes-match","status":"na","reason":"No quotes.","detail":{}},{"checkId":"required-cited","status":"fail","reason":"S1 and S2 are required and not cited.","detail":{"required":[1,2],"missing":[1,2]}},{"checkId":"refusal","status":"fail","reason":"Says the sources do not contain the answer, but the judge marked them as answering it.","detail":{"refused":true}}] },
    { case: { ...groundedCase, kitFields: {"kind":"grounded","answerable":"no","requiredSources":[],"sources":[{"number":1,"sha256":"1111111111111111111111111111111111111111111111111111111111111111","byteLength":60},{"number":2,"sha256":"2222222222222222222222222222222222222222222222222222222222222222","byteLength":40}]} } as CaseInput, settings: {}, materials: groundedMaterials, text: "The sources do not contain the answer.", expected: [{"checkId":"cites-something","status":"na","reason":"The judge marked this question as not answerable from the sources.","detail":{}},{"checkId":"citations-exist","status":"na","reason":"No citations.","detail":{}},{"checkId":"quotes-match","status":"na","reason":"No quotes.","detail":{}},{"checkId":"required-cited","status":"na","reason":"The judge marked this question as not answerable from the sources.","detail":{}},{"checkId":"refusal","status":"pass","reason":"Says the sources do not contain the answer.","detail":{"refused":true}}] },
  ],
  'tools-v1': [
    { case: toolsCase, settings: {}, text: '', testimony: toolTestimony(toolTraces[0]), expected: [{"checkId":"required-calls","status":"pass","reason":"All 2 required calls were made in order.","detail":{"required":2,"missing":0}},{"checkId":"forbidden-not-called","status":"na","reason":"No forbidden tools for this question.","detail":{}},{"checkId":"arguments-valid","status":"pass","reason":"All 2 calls are valid.","detail":{"calls":2,"invalid":0}},{"checkId":"steps-used","status":"pass","reason":"Used 3 of up to 4 calls (target 3).","detail":{"used":3,"max":4,"target":3}},{"checkId":"finished","status":"pass","reason":"Gave a final answer.","detail":{}},{"checkId":"final-answer","status":"pass","reason":"The final answer contains “3 to 5 business days”.","detail":{}}] },
    { case: strictToolsCase, settings: {}, text: '', testimony: toolTestimony(toolTraces[1]), expected: [{"checkId":"required-calls","status":"pass","reason":"The required call was made.","detail":{"required":1,"missing":0}},{"checkId":"forbidden-not-called","status":"fail","reason":"Called `refund_shipping` at step 2.","detail":{"stepNo":2}},{"checkId":"arguments-valid","status":"pass","reason":"All 2 calls are valid.","detail":{"calls":2,"invalid":0}},{"checkId":"steps-used","status":"fail","reason":"Used 2 of up to 4 calls (target 1).","detail":{"used":2,"max":4,"target":1}},{"checkId":"finished","status":"fail","reason":"Stopped at the step cap.","detail":{}},{"checkId":"final-answer","status":"na","reason":"No expected answer for this question.","detail":{}}] },
    { case: toolsCase, settings: {}, text: '', testimony: toolTestimony(toolTraces[2]), expected: [{"checkId":"required-calls","status":"fail","reason":"Missing or out of order: `lookup_order` with `order_id` A-1042 (and 1 other).","detail":{"required":2,"missing":2}},{"checkId":"forbidden-not-called","status":"na","reason":"No forbidden tools for this question.","detail":{}},{"checkId":"arguments-valid","status":"fail","reason":"2 of 2 calls invalid: `lookup_order` arguments aren’t a readable JSON object.","detail":{"calls":2,"invalid":2}},{"checkId":"steps-used","status":"pass","reason":"Used 2 of up to 4 calls (target 3).","detail":{"used":2,"max":4,"target":3}},{"checkId":"finished","status":"fail","reason":"Stopped: the reply was cut off at the output limit.","detail":{}},{"checkId":"final-answer","status":"fail","reason":"The final answer does not contain “3 to 5 business days”.","detail":{}}] },
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
        expect(runChecks(KITS[version] as TaskKit<unknown, unknown>, row.settings, row.case, row.testimony ?? { kind: 'text', text: row.text }, row.materials).results).toEqual(row.expected)
      }
    })
  }
})
