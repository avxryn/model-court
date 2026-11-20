/**
 * The record's Extraction section (spec 04 §3.4, D-88), after unsealing: per party, valid JSON,
 * must-fill fields filled, fields matching the answer key, invented and missed values, and the
 * jury's Invented and Ambiguous flags; per question, a field-by-field table (answer key | each
 * party) with each cell marked and flagged. Checks sit next to the jury's findings and never
 * change them.
 */

import { SheetSection } from '@/components/court/CaseFile'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { describePath } from '@/domain/extraction/render'
import type { ExtractionSchema } from '@/domain/extraction/schema'
import type { ResultsView } from '@/lib/dto'
import { plural } from '@/lib/format'
import { cn } from '@/lib/utils'

type Section = NonNullable<Extract<ResultsView, { extraction?: unknown }>['extraction']>

const OUTCOME_WORDS: Record<string, string> = { match: 'Match', mismatch: 'Wrong', missed: 'Missed', invented: 'Invented', extra_item: 'Extra item' }

function show(value: unknown): string {
  if (value === null || value === undefined) return '— empty'
  if (typeof value === 'string') return value.trim() === '' ? '— empty' : value
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return typeof value === 'number' ? String(value) : JSON.stringify(value)
}

export function ExtractionSection({ data }: { data: ResultsView }) {
  const section = (data as { extraction?: Section }).extraction
  if (!section) return null
  const parties = data.configurations.map((c) => ({ key: c.key, label: c.label }))
  const byKey = new Map(section.parties.map((party) => [party.configurationKey, party]))
  const schema = section.authoringSchema as ExtractionSchema
  const titleOf = (caseKey: string) => {
    const index = data.cases.findIndex((testCase) => testCase.key === caseKey)
    return index >= 0 ? `Q${index + 1} · ${data.cases[index].title}` : 'A question'
  }
  const rows: Array<{ label: string; value: (key: string) => string }> = [
    { label: 'Valid JSON', value: (key) => `${byKey.get(key)?.validJson ?? 0} of ${byKey.get(key)?.answers ?? 0}` },
    { label: 'Must-fill fields filled', value: (key) => `${byKey.get(key)?.requiredFilled ?? 0} of ${byKey.get(key)?.answers ?? 0}` },
    { label: 'Fields matching the answer key', value: (key) => (byKey.get(key)?.compared ? `${byKey.get(key)!.matched} of ${byKey.get(key)!.compared}` : 'No answer key') },
    { label: 'Invented (against the key)', value: (key) => String(byKey.get(key)?.invented ?? 0) },
    { label: 'Missed (against the key)', value: (key) => String(byKey.get(key)?.missed ?? 0) },
    { label: 'Jurors flagged Invented', value: (key) => String(byKey.get(key)?.flaggedInvented ?? 0) },
    { label: 'Jurors flagged Ambiguous', value: (key) => String(byKey.get(key)?.flaggedAmbiguous ?? 0) },
  ]
  return (
    <SheetSection id="extraction" label="Extraction">
      <p className="max-w-2xl text-small leading-relaxed text-muted-foreground">
        How each party’s fields compare with the answer keys, on eligible questions, next to what the jury flagged. These are counts, not part of the jury’s findings. A juror’s Invented flag and the key’s invented count can disagree; where they do is worth a look.
      </p>
      <div className="exhibit-panel mt-4 overflow-x-auto">
        <Table>
          <caption className="sr-only">Extraction results by party</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead>
              {parties.map((party) => (
                <TableHead key={party.key} className="text-right">
                  {party.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                {parties.map((party) => (
                  <TableCell key={party.key} className="text-right tabular-nums">
                    {row.value(party.key)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {section.cases
        .filter((testCase) => testCase.fields.length > 0)
        .map((testCase) => (
          <div key={testCase.caseKey} className="mt-6">
            <h3 className="mb-2 text-small font-medium">{titleOf(testCase.caseKey)}</h3>
            <div className="exhibit-panel overflow-x-auto">
              <Table>
                <caption className="sr-only">Fields of {titleOf(testCase.caseKey)}: the answer key and each party</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Field</TableHead>
                    <TableHead>Answer key</TableHead>
                    {parties.map((party) => (
                      <TableHead key={party.key}>{party.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {testCase.fields.map((field) => (
                    <TableRow key={field.path}>
                      <TableCell className="font-medium">{describePath(schema, field.path)}</TableCell>
                      <TableCell>{show(field.answerKey)}</TableCell>
                      {parties.map((party) => {
                        const cell = field.byParty[party.key]
                        if (!cell) return <TableCell key={party.key} className="text-muted-foreground">—</TableCell>
                        const flags = [cell.flags.invented > 0 && `flagged invented × ${cell.flags.invented}`, cell.flags.ambiguous > 0 && `flagged ambiguous × ${cell.flags.ambiguous}`].filter(Boolean).join(' · ')
                        return (
                          <TableCell key={party.key} className="align-top">
                            <span className="block break-words">{show(cell.value)}</span>
                            {cell.outcome && <span className={cn('text-caption', cell.outcome === 'match' ? 'text-success' : 'text-destructive')}>{OUTCOME_WORDS[cell.outcome] ?? cell.outcome}</span>}
                            {flags && <span className="block text-caption text-muted-foreground">{flags}</span>}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      <p className="mt-4 text-caption text-muted-foreground">
        Field list {section.schemaSha256.slice(0, 12)}… · {plural(section.documents.length, 'document')} · {section.documents.some((document) => document.delivery === 'pdf_native') ? 'each provider read the PDF its own way' : 'every party read the same text'}
      </p>
    </SheetSection>
  )
}
