/**
 * One extraction answer on the worksheet (spec 04 §3.2, D-88): fields, not JSON. A table of
 * label and value in the field list's order (groups indented), "— left empty" for an empty
 * value, a "Show as JSON" toggle with the server's canonical JSON (never the provider's bytes),
 * and two optional flags per value: Invented and Ambiguous. An answer that isn't JSON shows the
 * same neutral line for every party, then its text. No check result is ever shown here.
 */

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { FieldFlag } from '@/domain/contracts'
import type { RenderedField } from '@/domain/extraction/render'
import { cn } from '@/lib/utils'

export const UNPARSED_TEXT = "This answer isn't valid JSON, so it can't be shown as fields."
export const LEFT_EMPTY = '— left empty'

type Extraction = { status: 'parsed'; fields: RenderedField[] } | { status: 'unparsed' }

export function ExtractionTestimony({
  label,
  text,
  extraction,
  flags,
  onFlagsChange,
  disabled,
  children,
}: {
  label: string
  text: string
  extraction: Extraction
  flags: readonly FieldFlag[]
  onFlagsChange: (next: FieldFlag[]) => void
  disabled?: boolean
  children?: ReactNode
}) {
  const [asJson, setAsJson] = useState(false)
  const has = (path: string, flag: FieldFlag['flag']) => flags.some((item) => item.path === path && item.flag === flag)
  const toggle = (path: string, flag: FieldFlag['flag']) => onFlagsChange(has(path, flag) ? flags.filter((item) => !(item.path === path && item.flag === flag)) : [...flags, { path, flag }])
  return (
    <article data-testimony className="min-w-0 exhibit-panel">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className="typewriter shrink-0 rounded-[4px] bg-foreground px-2 py-0.5 text-xs font-semibold tracking-[0.06em] whitespace-nowrap text-background">TESTIMONY {label}</h3>
        {extraction.status === 'parsed' && (
          <Button size="xs" variant="ghost" aria-pressed={asJson} onClick={() => setAsJson((value) => !value)}>
            {asJson ? 'Show as fields' : 'Show as JSON'}
          </Button>
        )}
      </header>
      <div role="region" aria-label={`Testimony ${label} fields`} tabIndex={0} className="max-h-[32rem] overflow-y-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {extraction.status === 'unparsed' ? (
          <div className="space-y-2 px-4 py-3">
            <p className="text-sm text-muted-foreground">{UNPARSED_TEXT}</p>
            <pre className="text-reading break-words whitespace-pre-wrap">{text}</pre>
          </div>
        ) : asJson ? (
          <pre className="typewriter px-4 py-3 text-xs break-words whitespace-pre-wrap">{text}</pre>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Fields of testimony {label}</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Value</th>
                <th scope="col">Flags</th>
              </tr>
            </thead>
            <tbody>
              {extraction.fields.map((row) =>
                row.kind === 'group' ? (
                  <tr key={`g${row.path}`} className="border-t border-border first:border-t-0">
                    <th scope="row" colSpan={3} className="py-1.5 pr-3 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase" style={{ paddingLeft: `${1 + row.depth * 1}rem` }}>
                      {row.label}
                      {row.empty && <span className="ml-2 normal-case">{LEFT_EMPTY}</span>}
                    </th>
                  </tr>
                ) : (
                  <tr key={row.path} className="border-t border-border align-top first:border-t-0">
                    <th scope="row" className="w-2/5 py-1.5 pr-3 text-left font-medium" style={{ paddingLeft: `${1 + row.depth * 1}rem` }}>
                      {row.label}
                    </th>
                    <td className={cn('py-1.5 pr-2 break-words whitespace-pre-wrap', row.value === null && 'text-muted-foreground italic')}>{row.value ?? LEFT_EMPTY}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      <div className="flex justify-end gap-1">
                        {(['invented', 'ambiguous'] as const).map((flag) => (
                          <Button
                            key={flag}
                            size="xs"
                            variant={has(row.path, flag) ? 'secondary' : 'ghost'}
                            aria-pressed={has(row.path, flag)}
                            aria-label={`Mark ${row.label} as ${flag} in testimony ${label}`}
                            disabled={disabled}
                            onClick={() => toggle(row.path, flag)}
                          >
                            {flag === 'invented' ? 'Invented' : 'Ambiguous'}
                          </Button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </div>
      {flags.length > 0 && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">A flagged value is worth a note: what in the document supports or contradicts it.</p>}
      {children && <div className="border-t border-border px-4 pt-3 pb-4">{children}</div>}
    </article>
  )
}
