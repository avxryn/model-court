/**
 * Case-file building blocks (D-25): paper sheets, the case caption, the stage
 * line, exhibits, jury instructions, testimony transcripts, and
 * rubber stamps. Presentation only; every caller passes anonymous data.
 */

import { Plain } from '@/components/court/Paper'
import { useEffect, useState, type ReactNode } from 'react'
import { CASE_STEPS, TERMS, type CaseStep, type TermKey } from '@/lib/court'
import { cn } from '@/lib/utils'

/** A sheet of paper with the red double margin rule of court paper. */
export function Sheet({ children, className, margin = true, as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; margin?: boolean; as?: 'div' | 'section' | 'article' | 'main' } & Record<`aria-${string}`, string | undefined>) {
  return (
    <Tag {...rest} className={cn('paper relative rounded-sm', className)}>
      {margin && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-6 w-1 border-x border-margin-rule sm:left-12" />}
      <div className={cn(margin && 'pl-6 sm:pl-12')}>{children}</div>
    </Tag>
  )
}

/** A court term with its plain meaning beside it. */
export function Term({ name, plain = true, className }: { name: TermKey; plain?: boolean; className?: string }) {
  const entry = TERMS[name]
  return (
    <span className={className}>
      {entry.term}
      {plain && (
        <>
          {' '}
          <Plain>{entry.plain}</Plain>
        </>
      )}
    </span>
  )
}

export function SectionLabel({ id, name, children, className }: { id?: string; name?: TermKey; children?: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn('court-label', className)}>
      {name ? <Term name={name} /> : children}
    </h2>
  )
}

/**
 * Where a case stands, for the caption: "Stage 3 of 5 · Deliberate (review
 * blind)" and five small marks (grey done, red current). Not a control.
 */
export function CaseStage({ step, complete = false }: { step: CaseStep; complete?: boolean }) {
  const index = CASE_STEPS.findIndex((s) => s.key === step)
  const entry = CASE_STEPS[index]
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <span>
        Stage {index + 1} of {CASE_STEPS.length} · {entry.name}
        <span className="font-sans text-xs text-muted-foreground"> ({complete ? 'done' : entry.plain.toLowerCase()})</span>
      </span>
      <span aria-hidden className="inline-flex gap-[3px]">
        {CASE_STEPS.map((s, i) => (
          <span key={s.key} className={cn('h-1 w-3.5 rounded-[1px]', complete || i < index ? 'bg-mark' : i === index ? 'bg-stamp' : 'ring-1 ring-mark ring-inset')} />
        ))}
      </span>
    </div>
  )
}

/**
 * The case caption: court heading, "In re" title, the parties, and the
 * docket details. `stamp` sits in the top-right corner. Breadcrumbs above
 * the sheet (not a back link inside it) say where the page sits.
 */
export function Caption({ title, parties, details, stamp }: { title: ReactNode; parties?: ReactNode[] | null; details: ReactNode; stamp?: ReactNode }) {
  return (
    <div className="relative px-5 pt-7 pb-6 sm:px-8">
      {stamp && <div className="pointer-events-none mb-4 flex justify-end sm:absolute sm:top-6 sm:right-8 sm:mb-0">{stamp}</div>}
      <div className="text-center">
        <div className="font-heading text-sm font-bold tracking-[0.18em]">IN THE MODEL COURT</div>
        <div className="mt-1 text-caption tracking-[0.14em] text-muted-foreground">BLIND REVIEW DIVISION</div>
      </div>
      <div className="mt-5 flex flex-wrap border-y border-foreground">
        <div className="min-w-0 flex-[3_1_18rem] border-foreground py-4 pr-5 sm:border-r">
          <div className="font-heading text-sm italic">In re:</div>
          <h1 className="mt-0.5 font-heading text-2xl leading-tight font-bold break-words sm:text-title">{title}</h1>
          {parties && parties.length > 0 && (
            <div className="mt-3 font-heading text-base">
              {parties.map((party, index) => (
                <div key={index}>
                  {index > 0 && <div className="my-0.5 ml-6 text-sm italic">v.</div>}
                  <div>
                    {party}
                    {index === parties.length - 1 ? '.' : ','}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-[2_1_13rem] flex-col gap-1 py-4 font-heading text-sm sm:pl-5">{details}</div>
      </div>
    </div>
  )
}

export function DocketNumber({ children }: { children: ReactNode }) {
  return <span className="typewriter font-bold">{children}</span>
}

/** A labelled region inside a sheet, separated from the one above by a ruled line. */
export function SheetSection({ id, label, aside, children, className }: { id: string; label: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('border-t border-paper-rule px-5 py-6 sm:px-8', className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="court-label">
          {label}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const STAMP: Record<'filed' | 'sealed' | 'unsealed' | 'entered' | 'draft', { text: string; tone: string; tilt: string }> = {
  filed: { text: 'FILED', tone: 'border-stamp text-stamp', tilt: '-4deg' },
  sealed: { text: 'SEALED', tone: 'border-stamp text-stamp', tilt: '-9deg' },
  unsealed: { text: 'UNSEALED', tone: 'border-primary text-primary', tilt: '-9deg' },
  entered: { text: 'JUDGMENT ENTERED', tone: 'border-primary text-primary', tilt: '-5deg' },
  draft: { text: 'DRAFT', tone: 'border-muted-foreground text-muted-foreground', tilt: '-6deg' },
}

/** A rubber stamp. Text alternative included; presses once unless reduced motion is on. */
export function Stamp({ kind, detail, animate = false, size = 'md', className }: { kind: keyof typeof STAMP; detail?: string; animate?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const s = STAMP[kind]
  return (
    <span
      role="img"
      aria-label={detail ? `${s.text.toLowerCase()}, ${detail}` : s.text.toLowerCase()}
      style={{ ['--stamp-tilt' as string]: s.tilt, transform: `rotate(${s.tilt})` }}
      className={cn('typewriter inline-flex flex-col items-center rounded-[4px] border-[3px] border-double bg-paper/60 text-center leading-tight font-bold', s.tone, size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-4 py-1.5 text-lg tracking-[0.16em]', animate && 'stamp-press', className)}
    >
      {s.text}
      {detail && <span className={cn('font-bold tracking-[0.08em]', size === 'sm' ? 'text-[0.625rem]' : 'text-caption')}>{detail}</span>}
    </span>
  )
}

export function ExhibitSticker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('typewriter inline-block rounded-[3px] bg-sticker px-2.5 py-0.5 text-xs font-bold text-sticker-foreground', className)}>{children}</span>
}

/** A stapled exhibit page with a yellow sticker. */
export function Exhibit({ number, children, plain = true }: { number: number | string; children: ReactNode; plain?: boolean }) {
  return (
    <section aria-label={`Exhibit ${number}`} className="relative exhibit-panel px-5 pt-7 pb-5 shadow-exhibit">
      <span aria-hidden className="absolute -top-1.5 left-6 h-3 w-7 rounded-t-[3px] border-2 border-b-0 border-staple" />
      <ExhibitSticker className="absolute -top-3 right-4 rotate-3">EXHIBIT {number}</ExhibitSticker>
      {plain && <div className="mb-1.5 text-xs text-muted-foreground">{TERMS.exhibit.plain}</div>}
      <div className="font-heading text-reading leading-relaxed break-words whitespace-pre-wrap">{children}</div>
    </section>
  )
}

/**
 * The conversation so far (D-39): the same history every party saw, shown as
 * a transcript with speaker labels. Plain text only.
 */
export function ConversationSoFar({ messages }: { messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> }) {
  if (messages.length === 0) return null
  return (
    <section aria-label="The conversation so far" className="exhibit-panel">
      <h3 className="court-label border-b border-paper-rule px-4 py-2.5">
        The conversation so far{' '}
        <Plain>identical for every party</Plain>
      </h3>
      <ol className="divide-y divide-paper-rule">
        {messages.map((message, index) => (
          <li key={index} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <span className={cn('typewriter pt-0.5 text-xs font-bold', message.role === 'user' ? 'text-stamp' : 'text-primary')}>{message.role === 'user' ? 'USER' : 'ASSISTANT'}</span>
            <span className="min-w-0 font-heading text-reading leading-relaxed break-words whitespace-pre-wrap">{message.content}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** The scoring guide, on a dashed instruction slip. */
export function JuryInstructions({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Jury instructions" className="rounded-[2px] border border-dashed border-slip-edge bg-slip px-5 py-4">
      <h3 className="court-label">
        <Term name="instructions" />
      </h3>
      <p className="mt-2 font-heading text-reading leading-relaxed whitespace-pre-wrap italic">{children}</p>
    </section>
  )
}

/**
 * Testimony transcript: one numbered line per paragraph, rendered as plain
 * text in a labelled, scrollable region (model text is never HTML).
 */
export function Testimony({ label, text, children }: { label: string; text: string; children?: ReactNode }) {
  const lines = text.split('\n')
  let n = 0
  return (
    <article data-testimony className="min-w-0 exhibit-panel">
      <header className="flex items-center justify-between gap-3 border-b border-paper-rule px-4 py-3">
        <h3 className="typewriter shrink-0 rounded-[3px] bg-foreground px-3 py-1 text-sm font-bold whitespace-nowrap text-paper">TESTIMONY {label}</h3>
        <span className="text-right text-xs leading-snug text-muted-foreground">shuffled · unlabeled</span>
      </header>
      <div role="region" aria-label={`Testimony ${label} text`} tabIndex={0} className="max-h-96 overflow-y-auto py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ol className="list-none p-0">
          {lines.map((line, i) => {
            const blank = line.trim() === ''
            if (!blank) n += 1
            return (
              <li key={i} className={cn('flex gap-3 px-4 font-heading text-base leading-[1.7]', blank && 'h-3')}>
                <span aria-hidden className="typewriter w-6 shrink-0 pt-[0.2rem] text-right text-caption text-stamp">
                  {blank ? '' : n}
                </span>
                <span className="min-w-0 break-words whitespace-pre-wrap">{line}</span>
              </li>
            )
          })}
        </ol>
      </div>
      {children && <div className="border-t border-foreground/80 px-4 pt-4 pb-5">{children}</div>}
    </article>
  )
}

/**
 * A contents bar for a long sheet: one link per section, sticky under the
 * mobile bar (and at the top on wide screens), marking the section in view.
 */
export function SheetIndex({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState<string | null>(null)
  const ids = items.map((item) => item.id).join(' ')
  useEffect(() => {
    const targets = ids.split(' ').map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-80px 0px -60% 0px' },
    )
    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [ids])
  return (
    <nav aria-label="On this page" className="sticky top-14 z-10 -mb-px border-t border-paper-rule bg-paper/95 px-5 backdrop-blur-sm sm:px-8 lg:top-0 print:hidden">
      <ol className="flex gap-1 overflow-x-auto py-2 text-sm">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? 'location' : undefined}
              className={cn('inline-flex min-h-7 items-center rounded-md px-2.5 outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50', active === item.id ? 'bg-slip font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
