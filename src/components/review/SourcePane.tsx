/**
 * The question's source document on an extraction worksheet (spec 04 §3.2, §8.5, D-88): the
 * same for every party. A text document shows with line numbers, wrapped and selectable. A PDF is
 * shown by the PDF viewer (step B); a PDF a restore left out reads "Source file not restored".
 */

import type { ReactNode } from 'react'
import { ExhibitSticker } from '@/components/court/CaseFile'
import { Plain } from '@/components/court/Paper'

export type SourceDocument = { kind: 'text'; text: string } | { kind: 'pdf'; pageCount: number | null; byteLength: number; available: boolean }

export const SOURCE_NOT_RESTORED = 'Source file not restored'

export function SourcePane({ document, pdf }: { document: SourceDocument | null; /** Step B: the PDF viewer, given the caller's auth. */ pdf?: ReactNode }) {
  return (
    <section aria-label="Source document" className="exhibit-panel">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <ExhibitSticker>SOURCE</ExhibitSticker>
        <Plain>the document every party read</Plain>
      </header>
      {document === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground italic">No document was attached to this question.</p>
      ) : document.kind === 'text' ? (
        <TextSource text={document.text} />
      ) : !document.available ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">{SOURCE_NOT_RESTORED}.</p>
      ) : (
        (pdf ?? <p className="px-4 py-3 text-sm text-muted-foreground">PDF, {document.pageCount ?? '?'} pages.</p>)
      )}
    </section>
  )
}

function TextSource({ text }: { text: string }) {
  const lines = text.split(/\r?\n/u)
  return (
    <div role="region" aria-label="Source document text" tabIndex={0} className="max-h-[32rem] overflow-y-auto py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <ol className="list-none p-0">
        {lines.map((line, index) => (
          <li key={index} className="flex gap-2.5 px-4 font-mono text-small leading-[1.65]">
            <span aria-hidden className="typewriter w-6 shrink-0 pt-[0.2rem] text-right text-caption text-mark">
              {index + 1}
            </span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{line || ' '}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
