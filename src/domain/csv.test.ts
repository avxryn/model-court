import { describe, expect, it } from 'vitest'
import { escapeCsvCell, neutralizeFormula, parseCsv, toCsv } from './csv'

describe('CSV formula-injection protection (spec §16.3)', () => {
  it.each(['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', '\t=1', '\r=1', '=HYPERLINK("http://x","y")'])('prefixes %j with a quote', (value) => {
    expect(neutralizeFormula(value).startsWith("'")).toBe(true)
    expect(neutralizeFormula(value).slice(1)).toBe(value)
  })

  it('leaves ordinary text, inner triggers, and empty cells alone', () => {
    for (const value of ['Hello', 'a=b', '1+1', 'x@y.z', '', "'already"]) expect(neutralizeFormula(value)).toBe(value)
  })

  it('neutralizes numbers that render with a leading minus', () => {
    expect(escapeCsvCell(-1)).toBe("'-1")
    expect(escapeCsvCell(2)).toBe('2')
    expect(escapeCsvCell(true)).toBe('true')
    expect(escapeCsvCell(null)).toBe('')
  })

  it('quotes commas, quotes, line breaks, and edge whitespace', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvCell('two\nlines')).toBe('"two\nlines"')
    expect(escapeCsvCell(' padded ')).toBe('" padded "')
    // Neutralized and quoted: a CR-led cell.
    expect(escapeCsvCell('\r=1')).toBe('"\'\r=1"')
  })

  it('writes CRLF rows and refuses ragged rows', () => {
    expect(toCsv(['a', 'b'], [['=1', 'x,y']])).toBe('a,b\r\n\'=1,"x,y"\r\n')
    expect(() => toCsv(['a', 'b'], [['only one']])).toThrow()
  })
})

describe('parseCsv', () => {
  it('round-trips what toCsv writes (with the neutralizing quote kept)', () => {
    const rows = [
      ['plain', 'with, comma', 'with "quotes"', 'multi\r\nline', '=danger', ' lead'],
      ['', 'Café 😀', '-', '@', '\tx', 'end'],
    ]
    const csv = toCsv(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], rows)
    const parsed = parseCsv(csv)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows[0]).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    expect(parsed.rows[1]).toEqual(['plain', 'with, comma', 'with "quotes"', 'multi\r\nline', "'=danger", ' lead'])
    expect(parsed.rows[2]).toEqual(['', 'Café 😀', "'-", "'@", "'\tx", 'end'])
  })

  it('accepts LF endings, a BOM, no trailing newline, and skips blank lines', () => {
    expect(parseCsv(String.fromCharCode(0xfeff) + 'a,b\n\n1,2')).toEqual({ ok: true, rows: [['a', 'b'], ['1', '2']] })
    expect(parseCsv('a,b\r\n1,\r\n')).toEqual({ ok: true, rows: [['a', 'b'], ['1', '']] })
    expect(parseCsv('""\n')).toEqual({ ok: true, rows: [['']] })
    expect(parseCsv('')).toEqual({ ok: true, rows: [] })
  })

  it('reports malformed quoting with a line number', () => {
    expect(parseCsv('a,b\n"open,1\n2')).toMatchObject({ ok: false, line: 2 })
    expect(parseCsv('a\n"x"y')).toMatchObject({ ok: false, line: 2 })
    expect(parseCsv('a\nx"y"')).toMatchObject({ ok: false, line: 2 })
  })
})
