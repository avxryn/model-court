import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExtractionSettingsFields, FIELD_LIST_PRIVACY, MUST_FILL_WARNING } from '@/components/evaluations/ExtractionSettings'
import { answerKeySkeleton } from '@/components/evaluations/ExtractionQuestion'
import { ExtractionSection } from '@/components/record/ExtractionSection'
import { canonicalExtractionJson, renderFields } from '@/domain/extraction/render'
import { EXTRACTION_STARTERS } from '@/domain/extraction/starters'
import type { ResultsView } from '@/lib/dto'
import { ExtractionTestimony, LEFT_EMPTY, UNPARSED_TEXT } from './ExtractionTestimony'
import { SOURCE_NOT_RESTORED, SourcePane } from './SourcePane'

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const contact = EXTRACTION_STARTERS[1].schema
const value = { fullName: 'Dana Whitfield', organization: null, email: 'dana@fabrikam.example', phone: '', city: 'Portland' }

describe('ExtractionTestimony', () => {
  it('shows fields in schema order with empty values and pressed flags, never JSON by default', () => {
    const html = renderToStaticMarkup(
      <ExtractionTestimony label="A" text={canonicalExtractionJson(contact, value)} extraction={{ status: 'parsed', fields: renderFields(contact, value) }} flags={[{ path: '/city', flag: 'invented' }]} onFlagsChange={() => {}} />,
    )
    const plain = text(html)
    expect(plain.indexOf('Name')).toBeLessThan(plain.indexOf('Organization'))
    expect(plain).toContain(`Organization ${LEFT_EMPTY}`)
    expect(plain).toContain(`Phone ${LEFT_EMPTY}`)
    expect(html).toContain('aria-pressed="true" aria-label="Mark City as invented in testimony A"')
    expect(html).toContain('aria-pressed="false" aria-label="Mark Name as invented in testimony A"')
    expect(plain).toContain('Show as JSON')
    expect(html).not.toContain('"fullName"')
    expect(plain).toContain('A flagged value is worth a note')
  })

  it('an unparsed answer shows the neutral line and its text, with no flags', () => {
    const html = renderToStaticMarkup(<ExtractionTestimony label="B" text="Sorry, I can't." extraction={{ status: 'unparsed' }} flags={[]} onFlagsChange={() => {}} />)
    expect(text(html)).toContain(UNPARSED_TEXT)
    expect(text(html)).toContain("Sorry, I can't.")
    expect(html).not.toContain('Invented')
    expect(html).not.toContain('Show as JSON')
  })
})

describe('SourcePane', () => {
  it('numbers text lines and says when a PDF was not restored', () => {
    const plain = text(renderToStaticMarkup(<SourcePane document={{ kind: 'text', text: 'Line one\nLine two' }} />))
    expect(plain).toContain('1 Line one 2 Line two')
    expect(text(renderToStaticMarkup(<SourcePane document={{ kind: 'pdf', pageCount: 2, byteLength: 10, available: false }} />))).toContain(SOURCE_NOT_RESTORED)
  })
})

describe('ExtractionSettingsFields', () => {
  it('shows the starters, the must-fill warning, each field with its toggle, and the privacy line', () => {
    const plain = text(renderToStaticMarkup(<ExtractionSettingsFields settings={{ schema: contact, compare: {} }} errors={{}} onChange={() => {}} />))
    for (const starter of EXTRACTION_STARTERS) expect(plain).toContain(starter.name)
    expect(plain).toContain(MUST_FILL_WARNING)
    expect(plain).toContain(FIELD_LIST_PRIVACY)
    expect(plain).toContain('Name fullName text Must be filled')
    expect(plain).toContain('Email email text (email) May be empty')
    expect(plain).toContain('5 of 60 fields · 4 of 16 may be empty')
  })

  it('names a refused keyword with its fix', () => {
    const schema = { type: 'object', properties: { total: { type: 'number', minimum: 0 } } } as never
    const plain = text(renderToStaticMarkup(<ExtractionSettingsFields settings={{ schema, compare: {} }} errors={{}} onChange={() => {}} />))
    expect(plain).toContain("`minimum` isn't supported by Anthropic's structured outputs. Say the range in the field's description instead.")
  })
})

describe('answerKeySkeleton', () => {
  it('fills must-fill fields with blanks and May-be-empty ones with null', () => {
    expect(answerKeySkeleton(contact)).toEqual({ fullName: '', organization: null, email: null, phone: null, city: null })
    expect(answerKeySkeleton(EXTRACTION_STARTERS[3].schema)).toMatchObject({ productArea: 'Billing', urgency: 'Low', orderNumber: null, refundRequested: false })
  })
})

describe('ExtractionSection', () => {
  it('renders the per-party counts and the per-field table, nothing without a section', () => {
    const data = {
      configurations: [{ key: 'a', label: 'Luna' }, { key: 'b', label: 'Haiku' }],
      cases: [{ key: 'q1', title: 'Intake', eligible: true }],
      extraction: {
        schemaSha256: 'f'.repeat(64),
        authoringSchema: contact,
        wireSchema: {},
        compare: {},
        fieldOrder: [],
        parties: [
          { configurationKey: 'a', answers: 1, validJson: 1, requiredFilled: 1, compared: 5, matched: 5, invented: 0, missed: 0, flaggedInvented: 0, flaggedAmbiguous: 0 },
          { configurationKey: 'b', answers: 1, validJson: 1, requiredFilled: 1, compared: 5, matched: 3, invented: 1, missed: 1, flaggedInvented: 1, flaggedAmbiguous: 0 },
        ],
        cases: [{ caseKey: 'q1', answerKey: {}, fields: [{ path: '/city', answerKey: 'Portland', byParty: { a: { value: 'Portland', outcome: 'match', flags: { invented: 0, ambiguous: 0 } }, b: { value: 'Seattle', outcome: 'mismatch', flags: { invented: 1, ambiguous: 0 } } } }] }],
        documents: [{ caseKey: 'q1', kind: 'text', delivery: 'text', sha256: 'a', byteLength: 1, pageCount: null, available: true }],
      },
    } as unknown as ResultsView
    const plain = text(renderToStaticMarkup(<ExtractionSection data={data} />))
    expect(plain).toContain('Fields matching the answer key 5 of 5 3 of 5')
    expect(plain).toContain('Jurors flagged Invented 0 1')
    expect(plain).toContain('Q1 · Intake')
    expect(plain).toContain('City Portland Portland Match Seattle Wrong flagged invented × 1')
    expect(plain).toContain('every party read the same text')
    expect(renderToStaticMarkup(<ExtractionSection data={{ ...data, extraction: undefined } as unknown as ResultsView} />)).toBe('')
  })
})
