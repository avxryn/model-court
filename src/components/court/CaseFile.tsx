/**
 * Case-file building blocks (D-25): paper sheets, the case caption, the stage
 * line, exhibits, jury instructions, testimony transcripts, and
 * rubber stamps. Presentation only; every caller passes anonymous data.
 */

import { Plain } from '@/components/court/Paper'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { CASE_STEPS, TERMS, type CaseStep, type TermKey } from '@/lib/court'
import { useScrollCue } from '@/lib/use-scroll-cue'
import { cn } from '@/lib/utils'

/** The case sheet: one white card. (`margin` is kept for callers; D-49 dropped the court-paper margin rule.) */
export function Sheet({ children, className, as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; margin?: boolean; as?: 'div' | 'section' | 'article' | 'main' } & Record<`aria-${string}`, string | undefined>) {
  const { margin: _margin, ...aria } = rest as typeof rest & { margin?: boolean }
  void _margin
  return (
    <Tag {...aria} className={cn('paper relative', className)}>
      {children}
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
 * blind)" over a five-segment progress bar. Not a control.
 */
export function CaseStage({ step, complete = false, name }: { step: CaseStep; complete?: boolean; /** Overrides the stage's name, as the sample's "Judgment (example)". */ name?: string }) {
  const index = CASE_STEPS.findIndex((s) => s.key === step)
  const entry = CASE_STEPS[index]
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-small">
        <span className="text-muted-foreground">Stage {index + 1} of {CASE_STEPS.length} · </span>
        <span className="font-medium text-foreground">{name ?? entry.name}</span>
        <span className="text-caption text-muted-foreground"> ({complete ? 'done' : entry.plain.toLowerCase()})</span>
      </span>
      <span aria-hidden className="grid max-w-56 grid-cols-5 gap-1">
        {CASE_STEPS.map((s, i) => (
          <span key={s.key} className={cn('h-1.5 rounded-full', complete || i < index ? 'bg-primary' : i === index ? 'bg-primary/45' : 'bg-border')} />
        ))}
      </span>
    </div>
  )
}

/**
 * The case header: the title in the display face, the parties as "A vs B",
 * and the docket details in a quiet column on the right. `stamp` (the seal)
 * sits above the details. Breadcrumbs above the sheet say where the page sits.
 */
export function Caption({ title, parties, details, stamp }: { title: ReactNode; parties?: ReactNode[] | null; details: ReactNode; stamp?: ReactNode }) {
  return (
    <div className="grid gap-5 px-5 pt-6 pb-6 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(13rem,17rem)] md:gap-8">
      <div className="min-w-0">
        <h1 className="font-display text-2xl leading-tight font-medium tracking-tight break-words sm:text-title">{title}</h1>
        {parties && parties.length > 0 && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
            {parties.map((party, index) => (
              <Fragment key={index}>
                {index > 0 && <span className="text-caption text-muted-foreground">vs</span>}
                <span className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground">{party}</span>
              </Fragment>
            ))}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 text-small text-muted-foreground md:border-l md:border-border md:pl-6">
        {stamp && <div className="pointer-events-none mb-1.5">{stamp}</div>}
        {details}
      </div>
    </div>
  )
}

export function DocketNumber({ children }: { children: ReactNode }) {
  return <span className="typewriter font-medium text-foreground">{children}</span>
}

/** A labelled region inside a sheet, separated from the one above by a ruled line. */
export function SheetSection({ id, label, aside, children, className }: { id: string; label: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn('border-t border-border px-5 py-6 sm:px-8', className)}>
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
  filed: { text: 'FILED', tone: 'border-stamp text-stamp', tilt: '-2deg' },
  sealed: { text: 'SEALED', tone: 'border-stamp text-stamp', tilt: '-3deg' },
  unsealed: { text: 'UNSEALED', tone: 'border-primary text-primary', tilt: '-3deg' },
  entered: { text: 'JUDGMENT ENTERED', tone: 'border-primary text-primary', tilt: '-2deg' },
  draft: { text: 'DRAFT', tone: 'border-muted-foreground text-muted-foreground', tilt: '-2deg' },
}

/** A rubber stamp. Text alternative included; presses once unless reduced motion is on. */
export function Stamp({ kind, detail, animate = false, size = 'md', className }: { kind: keyof typeof STAMP; detail?: string; animate?: boolean; size?: 'sm' | 'md'; className?: string }) {
  const s = STAMP[kind]
  return (
    <span
      role="img"
      aria-label={detail ? `${s.text.toLowerCase()}, ${detail}` : s.text.toLowerCase()}
      style={{ ['--stamp-tilt' as string]: s.tilt, transform: `rotate(${s.tilt})` }}
      className={cn('typewriter inline-flex flex-col items-center rounded-[3px] border-[1.5px] bg-card/60 text-center leading-tight font-semibold tracking-[0.14em] uppercase', s.tone, size === 'sm' ? 'px-1.5 py-0.5 text-caption' : 'px-2.5 py-1 text-caption', animate && 'stamp-press', className)}
    >
      {s.text}
      {detail && <span className="text-caption font-medium tracking-[0.06em]">{detail}</span>}
    </span>
  )
}

export function ExhibitSticker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('typewriter inline-block rounded-[4px] bg-sticker px-1.5 py-0.5 text-caption font-medium tracking-[0.06em] text-sticker-foreground', className)}>{children}</span>
}

/** Reference evidence: a sunken note with a small exhibit tag. */
export function Exhibit({ number, children, plain = true }: { number: number | string; children: ReactNode; plain?: boolean }) {
  return (
    <section aria-label={`Exhibit ${number}`} className="rounded-lg bg-slip px-4 py-3.5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ExhibitSticker>EXHIBIT {number}</ExhibitSticker>
        {plain && <span className="text-caption text-muted-foreground">{TERMS.exhibit.plain}</span>}
      </div>
      <div className="text-reading leading-relaxed break-words whitespace-pre-wrap text-foreground/85">{children}</div>
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
      <h3 className="court-label border-b border-border px-4 py-2.5">
        The conversation so far{' '}
        <Plain>identical for every party</Plain>
      </h3>
      <ol className="divide-y divide-border">
        {messages.map((message, index) => (
          <li key={index} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[5.5rem_1fr] sm:gap-3">
            <span className={cn('typewriter pt-0.5 text-caption font-medium', message.role === 'user' ? 'text-muted-foreground' : 'text-primary')}>{message.role === 'user' ? 'USER' : 'ASSISTANT'}</span>
            <span className="min-w-0 text-reading leading-relaxed break-words whitespace-pre-wrap">{message.content}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** The scoring guide, in a quiet bordered note. */
export function JuryInstructions({ children }: { children: ReactNode }) {
  return (
    <section aria-label="Jury instructions" className="rounded-lg border border-border px-4 py-3.5">
      <h3 className="court-label">
        <Term name="instructions" />
      </h3>
      <p className="mt-1.5 text-small leading-relaxed whitespace-pre-wrap text-muted-foreground">{children}</p>
    </section>
  )
}

/**
 * Testimony transcript: one numbered line per paragraph, rendered as plain
 * text in a labelled, scrollable region (model text is never HTML).
 */
export function Testimony({ label, text, children, renderLine }: { label: string; text: string; children?: ReactNode; /** Spec 05 (D-96): renders one line (e.g. with citation chips); must be a pure function of shared data so every party renders alike. */ renderLine?: (line: string, index: number) => ReactNode }) {
  const lines = text.split('\n')
  let n = 0
  return (
    <article data-testimony className="min-w-0 exhibit-panel">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className="typewriter shrink-0 rounded-[4px] bg-foreground px-2 py-0.5 text-caption font-semibold tracking-[0.06em] whitespace-nowrap text-background">TESTIMONY {label}</h3>
        <span className="text-right text-caption leading-snug text-muted-foreground">Shuffled · unlabeled</span>
      </header>
      <div role="region" aria-label={`Testimony ${label} text`} tabIndex={0} className="max-h-96 overflow-y-auto py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ol className="list-none p-0">
          {lines.map((line, i) => {
            const blank = line.trim() === ''
            if (!blank) n += 1
            return (
              <li key={i} className={cn('flex gap-2.5 px-4 text-reading leading-[1.65]', blank && 'h-3')}>
                <span aria-hidden className="typewriter w-5 shrink-0 pt-[0.2rem] text-right text-caption text-mark">
                  {blank ? '' : n}
                </span>
                <span className="min-w-0 break-words whitespace-pre-wrap">{renderLine && !blank ? renderLine(line, i) : line}</span>
              </li>
            )
          })}
        </ol>
      </div>
      {children && <div className="border-t border-border px-4 pt-3 pb-4">{children}</div>}
    </article>
  )
}

/**
 * A contents bar for a long sheet: one link per section, sticky under the
 * mobile bar (and at the top on wide screens), marking the section in view.
 */
export function SheetIndex({ items }: { items: Array<{ id: string; label: string }> }) {
  const [active, setActive] = useState<string | null>(null)
  const row = useRef<HTMLOListElement>(null)
  useScrollCue(row)
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
    <nav aria-label="On this page" className="sticky top-14 z-10 -mb-px border-t border-border bg-paper/95 px-5 backdrop-blur-sm sm:px-8 lg:top-0 print:hidden">
      <ol ref={row} className="scroll-cue flex gap-1 overflow-x-auto py-2 text-small">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? 'location' : undefined}
              className={cn('inline-flex min-h-7 items-center rounded-md px-2.5 outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50', active === item.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
