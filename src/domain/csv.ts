/**
 * RFC 4180 CSV writing and reading (spec §16.3). Pure, browser-safe.
 *
 * Writing defends against spreadsheet formula injection: a cell whose first
 * character is `=`, `+`, `-`, `@`, tab, or carriage return is prefixed with a
 * single quote so spreadsheet apps show it as text instead of evaluating it.
 * The quote is visible in the cell; that is the intended trade-off (OWASP).
 */

export const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const

export type CsvCell = string | number | boolean | null

/** Neutralize a leading formula trigger. Numbers are written as text too, so `-1` becomes `'-1`. */
export function neutralizeFormula(value: string): string {
  return value.length > 0 && (CSV_FORMULA_PREFIXES as readonly string[]).includes(value[0]) ? `'${value}` : value
}

export function escapeCsvCell(cell: CsvCell): string {
  const text = neutralizeFormula(cell === null ? '' : String(cell))
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text
}

/** CRLF-separated rows; no BOM (callers that target Excel add one). */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly CsvCell[]>): string {
  for (const row of rows) if (row.length !== header.length) throw new Error('CSV row width does not match header')
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n'
}

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; error: string; line: number }

/**
 * Parse RFC 4180 CSV: quoted fields may contain commas, quotes ("") and line
 * breaks; CRLF or LF row endings; an optional UTF-8 BOM. Values are returned
 * exactly as written (no trimming, no formula un-escaping). Completely empty
 * lines are skipped.
 */
export function parseCsv(input: string): CsvParseResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let fieldStarted = false
  let line = 1
  let quoteLine = 1

  const endRow = () => {
    row.push(field)
    if (!(row.length === 1 && row[0] === '' && !fieldStarted)) rows.push(row)
    row = []
    field = ''
    fieldStarted = false
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          const next = text[i + 1]
          if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
            return { ok: false, error: 'Unexpected character after a closing quote', line }
          }
        }
      } else {
        if (char === '\n') line++
        field += char
      }
      continue
    }
    if (char === '"') {
      if (field !== '') return { ok: false, error: 'A quote may only start a field', line }
      quoted = true
      fieldStarted = true
      quoteLine = line
    } else if (char === ',') {
      row.push(field)
      field = ''
      fieldStarted = true
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++
      endRow()
      line++
    } else {
      field += char
      fieldStarted = true
    }
  }
  if (quoted) return { ok: false, error: 'A quoted field is not closed', line: quoteLine }
  if (field !== '' || fieldStarted || row.length > 0) endRow()
  return { ok: true, rows }
}
