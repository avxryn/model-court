/**
 * Case-file building blocks (D-25): paper sheets, the case caption, folder
 * tabs for progress, exhibits, jury instructions, testimony transcripts, and
 * rubber stamps. Presentation only; every caller passes anonymous data.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
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
      {plain && <span className="ml-2 font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">({entry.plain})</span>}
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

/** Folder tabs showing where a case stands. */
export function CaseProgress({ step, complete = false, className }: { step: CaseStep; complete?: boolean; className?: string }) {
  const currentIndex = CASE_STEPS.findIndex((s) => s.key === step)
  return (
    <ol aria-label="Case progress" className={cn('grid grid-cols-5 items-end gap-0.5 sm:gap-1', className)}>
      {CASE_STEPS.map((s, index) => {
        const isCurrent = !complete && index === currentIndex
        const done = complete || index < currentIndex
        return (
          <li key={s.key} className="min-w-0" aria-current={isCurrent ? 'step' : undefined}>
            <div
              className={cn(
                'rounded-t-lg px-1.5 pt-1.5 pb-2 sm:px-3 sm:pt-2 sm:pb-2.5',
                isCurrent ? 'bg-paper ring-1 ring-paper-edge [clip-path:inset(-2px_-2px_0_-2px)]' : done ? 'mt-1.5 bg-manila text-manila-foreground' : 'mt-1.5 bg-tab-idle text-tab-idle-foreground',
              )}
            >
              <div className={cn('typewriter text-[0.625rem] font-bold sm:text-[0.6875rem]', isCurrent ? 'text-stamp' : '')}>
                <span className="sm:hidden">{index + 1}</span>
                <span className="hidden sm:inline">
                  STEP {index + 1}
                  {isCurrent ? ' · NOW' : done ? ' · DONE' : ''}
                </span>
                <span className="sr-only">{isCurrent ? ' (current)' : done ? ' (done)' : ''}</span>
              </div>
              <div className={cn('truncate font-heading leading-tight', isCurrent ? 'text-xs font-bold text-foreground sm:text-base' : 'text-xs sm:text-[0.9375rem]')}>{s.name}</div>
              <div className={cn('hidden text-xs leading-snug sm:block', isCurrent ? 'text-muted-foreground' : '')}>{s.plain}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The case caption: court heading, "In re" title, the parties, and the
 * docket details. `stamp` sits in the top-right corner.
 */
export function Caption({ title, parties, details, stamp, backTo }: { title: ReactNode; parties?: ReactNode[] | null; details: ReactNode; stamp?: ReactNode; backTo?: { to: string; label: string } }) {
  return (
    <div className="relative px-5 pt-7 pb-6 sm:px-8">
      {backTo && (
        <Link to={backTo.to} className="mb-3 inline-block font-sans text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          ← {backTo.label}
        </Link>
      )}
      {stamp && <div className="pointer-events-none mb-4 flex justify-end sm:absolute sm:top-6 sm:right-8 sm:mb-0">{stamp}</div>}
      <div className="text-center">
        <div className="font-heading text-sm font-bold tracking-[0.18em]">IN THE MODEL COURT</div>
        <div className="mt-1 text-[0.6875rem] tracking-[0.14em] text-muted-foreground">BLIND REVIEW DIVISION</div>
      </div>
      <div className="mt-5 flex flex-wrap border-y border-foreground">
        <div className="min-w-0 flex-[3_1_18rem] border-foreground py-4 pr-5 sm:border-r">
          <div className="font-heading text-sm italic">In re:</div>
          <h1 className="mt-0.5 font-heading text-2xl leading-tight font-bold break-words sm:text-[1.75rem]">{title}</h1>
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
      {detail && <span className={cn('font-bold tracking-[0.08em]', size === 'sm' ? 'text-[0.625rem]' : 'text-[0.6875rem]')}>{detail}</span>}
    </span>
  )
}

export function ExhibitSticker({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('typewriter inline-block rounded-[3px] bg-sticker px-2.5 py-0.5 text-xs font-bold text-sticker-foreground', className)}>{children}</span>
}

/** A stapled exhibit page with a yellow sticker. */
export function Exhibit({ number, children, plain = true }: { number: number | string; children: ReactNode; plain?: boolean }) {
  return (
    <section aria-label={`Exhibit ${number}`} className="relative rounded-[2px] bg-white px-5 pt-7 pb-5 ring-1 ring-exhibit-edge shadow-[0_6px_14px_-6px_rgb(60_45_15/0.18)]">
      <span aria-hidden className="absolute -top-1.5 left-6 h-3 w-7 rounded-t-[3px] border-2 border-b-0 border-staple" />
      <ExhibitSticker className="absolute -top-3 right-4 rotate-3">EXHIBIT {number}</ExhibitSticker>
      {plain && <div className="mb-1.5 text-xs text-muted-foreground">{TERMS.exhibit.plain}</div>}
      <div className="font-heading text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap">{children}</div>
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
      <p className="mt-2 font-heading text-[0.9375rem] leading-relaxed whitespace-pre-wrap italic">{children}</p>
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
    <article className="min-w-0 rounded-[2px] bg-white ring-1 ring-exhibit-edge">
      <header className="flex items-center justify-between gap-3 border-b border-paper-rule px-4 py-3">
        <h3 className="typewriter rounded-[3px] bg-foreground px-3 py-1 text-sm font-bold text-paper">TESTIMONY {label}</h3>
        <span className="text-xs text-muted-foreground">shuffled · unlabeled</span>
      </header>
      <div role="region" aria-label={`Testimony ${label} text`} tabIndex={0} className="max-h-96 overflow-y-auto py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ol className="list-none p-0">
          {lines.map((line, i) => {
            const blank = line.trim() === ''
            if (!blank) n += 1
            return (
              <li key={i} className={cn('flex gap-3 px-4 font-heading text-base leading-[1.7]', blank && 'h-3')}>
                <span aria-hidden className="typewriter w-6 shrink-0 pt-[0.2rem] text-right text-[0.6875rem] text-stamp">
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
