/**
 * A testimony whose citations are chips (spec 05 §3, D-96). Rendering is a pure function of the
 * testimony text and the question's sources (`citedLines`), applied the same way to every party:
 * `[S2]` is a button that opens the source in a popover ("Show in sources" scrolls the rail to
 * it), `[S2: "…"]` is set as a quotation followed by the chip, and a citation to a source that
 * doesn't exist stays plain text. No quote is checked or highlighted here: that is a check result.
 */

import type { ReactNode } from 'react'
import { Testimony } from '@/components/court/CaseFile'
import { showSource, type ListedSource } from '@/components/review/SourceList'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { citedLines, type CitedPart } from '@/lib/citations-view'

function Chip({ caseKey, source }: { caseKey: string; source: ListedSource }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Source S${source.number}${source.title ? `: ${source.title}` : ''}`}
        className="typewriter mx-0.5 inline-flex items-center rounded-[4px] border border-border bg-slip px-1 align-baseline text-[0.8em] leading-tight font-semibold text-foreground hover:bg-paper focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        S{source.number}
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))]" align="start">
        <p className="text-small font-medium">
          S{source.number}
          {source.title ? ` · ${source.title}` : ''}
        </p>
        <p className="max-h-60 overflow-y-auto text-reading leading-relaxed break-words whitespace-pre-wrap">{source.text}</p>
        <Button size="xs" variant="outline" className="self-start" onClick={() => showSource(caseKey, source.number)}>
          Show in sources
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** One line's parts as React nodes. */
export function renderCitedParts(parts: readonly CitedPart[], caseKey: string, sources: readonly ListedSource[]): ReactNode {
  return parts.map((part, index) => {
    if (part.kind === 'text') return <span key={index}>{part.text}</span>
    if (part.kind === 'quote') return <q key={index} className="italic">{part.text}</q>
    const source = sources.find((candidate) => candidate.number === part.number)
    const open = part.first ? '[' : ''
    const close = part.last ? ']' : ','
    return (
      <span key={index} className="whitespace-nowrap text-muted-foreground">
        {open}
        {part.exists && source ? <Chip caseKey={caseKey} source={source} /> : <span>S{part.number}</span>}
        {close}
      </span>
    )
  })
}

export function CitedText({ text, caseKey, sources }: { text: string; caseKey: string; sources: readonly ListedSource[] }) {
  const lines = citedLines(text, sources.length)
  return (
    <>
      {lines.map((parts, index) => (
        <span key={index}>
          {index > 0 && '\n'}
          {renderCitedParts(parts, caseKey, sources)}
        </span>
      ))}
    </>
  )
}

export function CitedTestimony({ label, text, caseKey, sources, children }: { label: string; text: string; caseKey: string; sources: readonly ListedSource[]; children?: ReactNode }) {
  const lines = citedLines(text, sources.length)
  return (
    <Testimony label={label} text={text} renderLine={(_line, index) => renderCitedParts(lines[index] ?? [], caseKey, sources)}>
      {children}
    </Testimony>
  )
}
