import { describe, expect, it } from 'vitest'
import { parseCasesCsv, parseSourceNumbers } from './case-import'
import { parseSourcesCsv, questionList, SOURCES_CSV_TEMPLATE } from './source-import'

const ids = () => {
  let n = 0
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
}

describe('parseSourcesCsv', () => {
  it('reads the template: Q1 with two sources, Q2 with one, origin and title optional', () => {
    const result = parseSourcesCsv(SOURCES_CSV_TEMPLATE, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.questions.map((question) => [question.position, question.sources.length])).toEqual([[1, 2], [2, 1]])
    expect(result.questions[0].sources[0]).toEqual({ number: 1, title: 'Refund policy', origin: 'kb-1432, retrieved Nov 12', text: 'Customers can request a refund within 30 days of purchase. Refunds go back to the original payment method.' })
    expect(result.questions[1].sources[0]).not.toHaveProperty('origin')
  })

  it('accepts Q2 and 2, S3 and 3, and sorts by the source column', () => {
    const result = parseSourcesCsv('Question,Source,Text\nQ2,S2,second\n2,1,first\n', 3)
    expect(result.ok && result.questions).toEqual([{ position: 2, sources: [{ number: 1, text: 'first' }, { number: 2, text: 'second' }] }])
  })

  it('without a source column, numbers follow the rows per question; text is kept as written', () => {
    const result = parseSourcesCsv('question,text\n1,"  a  "\n2,b\n1,c\n', 2)
    expect(result.ok && result.questions).toEqual([
      { position: 1, sources: [{ number: 1, text: '  a  ' }, { number: 2, text: 'c' }] },
      { position: 2, sources: [{ number: 1, text: 'b' }] },
    ])
  })

  it('refuses gaps, duplicates, unknown questions and columns, and blank text', () => {
    const issues = (text: string, count = 2) => {
      const result = parseSourcesCsv(text, count)
      return result.ok ? [] : result.issues.map((issue) => issue.message)
    }
    expect(issues('question,source,text\n1,1,a\n1,3,b\n')).toEqual(["Q1's sources must be numbered 1, 2, 3… with no gaps; S2 is missing."])
    expect(issues('question,source,text\n1,1,a\n1,1,b\n')[0]).toBe('Q1 has S1 twice (rows 1 and 2).')
    expect(issues('question,text\n4,a\n')).toEqual(['Q4 is not in this case (it has 2 questions).'])
    expect(issues('question,text\nfirst,a\n')).toEqual(['Write the question as 1–5 or Q1–Q5.'])
    expect(issues('question,source,text\n1,S11,a\n')).toEqual(['Write the source as 1–10 or S1–S10.'])
    expect(issues('question,text,url\n1,a,b\n')).toEqual(['Unknown column "url". Allowed: question, source, title, text, origin.'])
    expect(issues('question,title\n1,a\n')).toEqual(['Missing required column "text".'])
    expect(issues('question,text\n1,   \n')).toEqual(['Q1: Source text cannot be blank'])
    expect(issues('question,text\n')).toEqual(['The file has no sources below the header row.'])
  })

  it('applies the per-source, per-question and per-case limits', () => {
    const big = 'x'.repeat(6000)
    expect(parseSourcesCsv(`question,text\n1,${'x'.repeat(6001)}\n`, 1).ok).toBe(false)
    expect(parseSourcesCsv(`question,text\n${Array.from({ length: 5 }, () => `1,${big}`).join('\n')}\n`, 1).ok).toBe(false)
    expect(parseSourcesCsv(`question,text\n${Array.from({ length: 11 }, () => '1,a').join('\n')}\n`, 1).ok).toBe(false)
    // 3 × 4 × 6,000 = 72,000 characters across three questions: over the 60,000 case total.
    const three = [1, 2, 3].flatMap((q) => Array.from({ length: 4 }, () => `${q},${big}`)).join('\n')
    const result = parseSourcesCsv(`question,text\n${three}\n`, 3)
    expect(!result.ok && result.issues[0].message).toBe("The case's sources would be 72,000 characters; the limit is 60,000 for all questions together.")
    // Questions the file doesn't name count with what they already have.
    expect(parseSourcesCsv(`question,text\n1,${big}\n`, 2, [0, 55_000]).ok).toBe(false)
    expect(parseSourcesCsv(`question,text\n1,${big}\n`, 2, [59_000, 50_000]).ok).toBe(true)
  })

  it('refuses a file over 256 KiB', () => {
    const result = parseSourcesCsv(`question,text\n1,${'x'.repeat(256 * 1024)}\n`, 1)
    expect(!result.ok && result.issues[0].message).toBe('The file is larger than 256 KiB.')
  })

  it('names the questions for the confirmation', () => {
    expect(questionList([1, 2, 4])).toBe('Q1, Q2 and Q4')
    expect(questionList([3])).toBe('Q3')
  })
})

describe('questions CSV on an answers-from-sources case', () => {
  const header = 'title,input,expected_behavior,answerable,required_sources'

  it('reads answerable and required sources in every accepted format', () => {
    expect(parseSourceNumbers('1;3')).toEqual([1, 3])
    expect(parseSourceNumbers('S1 S3')).toEqual([1, 3])
    expect(parseSourceNumbers('S1, s3')).toEqual([1, 3])
    expect(parseSourceNumbers('')).toEqual([])
    expect(parseSourceNumbers('one')).toBeNull()
    expect(parseSourceNumbers('S0')).toBeNull()
    const result = parseCasesCsv(`${header}\nT,Q,E,partly,S1 S3\nT2,Q2,E2,,\n`, ids(), { kitVersion: 'grounded-v1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cases.map((testCase) => testCase.kitFields)).toEqual([
      { kind: 'grounded', answerable: 'partly', requiredSources: [1, 3] },
      { kind: 'grounded', answerable: 'yes', requiredSources: [] },
    ])
  })

  it('a grounded case always gets its key, even without the columns', () => {
    const result = parseCasesCsv('title,input,expected_behavior\nT,Q,E\n', ids(), { kitVersion: 'grounded-v1' })
    expect(result.ok && result.cases[0].kitFields).toEqual({ kind: 'grounded', answerable: 'yes', requiredSources: [] })
  })

  it('refuses bad values and the columns on another kit', () => {
    const bad = parseCasesCsv(`${header}\nT,Q,E,maybe,S1;x\n`, ids(), { kitVersion: 'grounded-v1' })
    expect(!bad.ok && bad.issues.map((issue) => issue.field)).toEqual(['required_sources', 'answerable'])
    const other = parseCasesCsv(`${header}\nT,Q,E,yes,1\n`, ids())
    expect(!other.ok && other.issues[0].message).toBe('Column "answerable" needs the Answers from sources task kit. Choose it first, or remove the column.')
  })
})
