/**
 * A grounded question's numbered sources (spec 05 §3, D-96), identical for every party. Rows
 * fold: "S1 · title · first line", one open at a time (the native `<details name>` group), each
 * with the anchor `src-<caseKey>-<n>` that citation chips scroll to. Text is rendered as text
 * only; a note (`origin`, record only) is never a link, even when it looks like one.
 */

import { Plain } from '@/components/court/Paper'
import type { Span } from '@/domain/grounded/match'
import { splitAtSpans } from '@/lib/citations-view'

export interface ListedSource {
  number: number
  title: string | null
  text: string
  /** The judge's note: the unsealed record only, never the worksheet. */
  origin?: string | null
}

export function sourceAnchor(caseKey: string, number: number): string {
  return `src-${caseKey}-${number}`
}

/** Opens a source row and brings it into view (from a citation chip's "Show in sources"). */
export function showSource(caseKey: string, number: number): void {
  const row = document.getElementById(sourceAnchor(caseKey, number))
  if (!(row instanceof HTMLDetailsElement)) return
  row.open = true
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  row.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  row.querySelector('summary')?.focus({ preventScroll: true })
}

function firstLine(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line
}

export function SourceList({ caseKey, sources, highlights, heading = true }: { caseKey: string; sources: readonly ListedSource[]; /** Unsealed record only: spans of quotes found in each source. */ highlights?: ReadonlyMap<number, readonly Span[]>; heading?: boolean }) {
  return (
    <section aria-label="Sources" className="space-y-2">
      {heading && (
        <h3 className="court-label">
          Sources{sources.length > 0 ? ` · Exhibits S1–S${sources.length}` : ''} <Plain>the passages every party received, in this order</Plain>
        </h3>
      )}
      {sources.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No sources were entered.</p>
      ) : (
        <div className="divide-y divide-paper-rule rounded-md border border-paper-rule">
          {sources.map((source) => {
            const marks = highlights?.get(source.number) ?? []
            return (
              <details key={source.number} id={sourceAnchor(caseKey, source.number)} name={`sources-${caseKey}`} className="group scroll-mt-28">
                <summary className="flex cursor-pointer list-none gap-2 px-3 py-2 text-sm outline-none hover:bg-slip focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="typewriter shrink-0 font-semibold">S{source.number}</span>
                  <span className="min-w-0 truncate">
                    {source.title && <span className="font-medium">{source.title} · </span>}
                    <span className="text-muted-foreground">{firstLine(source.text)}</span>
                  </span>
                  {marks.length > 0 && <span className="ml-auto shrink-0 text-xs text-muted-foreground">{marks.length === 1 ? '1 quote found' : `${marks.length} quotes found`}</span>}
                </summary>
                <div className="space-y-2 px-3 pt-1 pb-3">
                  <p className="max-h-80 overflow-y-auto text-reading leading-relaxed break-words whitespace-pre-wrap">
                    {marks.length === 0
                      ? source.text
                      : splitAtSpans(source.text, marks).map((piece, index) =>
                          piece.marked ? (
                            <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
                              {piece.text}
                            </mark>
                          ) : (
                            <span key={index}>{piece.text}</span>
                          ),
                        )}
                  </p>
                  {source.origin && <p className="text-xs text-muted-foreground">Judge’s note (not sent, not shown to jurors): {source.origin}</p>}
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
