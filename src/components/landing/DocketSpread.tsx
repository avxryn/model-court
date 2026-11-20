/**
 * The landing hero's docket spread (D-53): the five sheets of the sample case
 * spread across the desk, the worksheet scores tick in, the record is sealed,
 * then unsealed with the parties named. Static markup animated by CSS alone
 * (styles.css, "docket spread"), so the prerendered landing stays request-free.
 * The parties are the sample's illustrative configurations, not real models:
 * the landing makes no claim about any provider.
 */

import type { CSSProperties } from 'react'
import { SAMPLE_CASES, SAMPLE_CONFIGURATIONS } from '@/sample/fixture'
import { EXAMPLE_POLICY } from '@/domain/example'
import { cn } from '@/lib/utils'

const CASE = SAMPLE_CASES[0]

/** "Configuration 1 — strict grounding" → "Strict grounding". */
function partyName(key: string): string {
  const label = SAMPLE_CONFIGURATIONS.find((c) => c.key === key)?.label ?? key
  const short = label.split(' — ')[1] ?? label
  return short.charAt(0).toUpperCase() + short.slice(1)
}

const [FIRST, SECOND] = CASE.responses

/** The worksheet rows that tick in, in order: [testimony, criterion, score]. */
const TICKS: Array<[string, string, number]> = [
  ['A', 'Correctness', 1],
  ['A', 'Grounding', 0],
  ['B', 'Grounding', 2],
]

const STEPS: Array<[string, string]> = [
  ['File the case', '0.2s'],
  ['Hear testimony', '0.65s'],
  ['Deliberate blind', '1.25s'],
  ['Seal the record', '2.25s'],
  ['Unseal', '4.05s'],
]

const vars = (v: Record<string, string | number>) => v as CSSProperties

const TAG = 'rounded-[4px] px-1.5 py-0.5 font-mono text-caption font-semibold tracking-[0.06em] whitespace-nowrap'

function Testimony({ response, index }: { response: (typeof CASE.responses)[number]; index: number }) {
  return (
    <div className={cn('ds-sheet', index === 0 ? 'ds-s3' : 'ds-s4')} style={vars({ '--i': index + 2 })}>
      <div className="mb-2 flex items-center gap-2">
        <span className="ds-who min-w-0">
          <span className={cn('ds-label max-w-full truncate bg-foreground text-background', TAG)}>TESTIMONY {response.label}</span>
          <span className={cn('ds-party max-w-full truncate bg-sticker text-sticker-foreground', TAG)}>{partyName(response.configurationKey)}</span>
        </span>
        <span className="ds-shuffled absolute top-3.5 right-3.5 hidden text-caption text-muted-foreground sm:inline">shuffled</span>
      </div>
      <p className="line-clamp-3 text-small leading-snug">{response.text}</p>
    </div>
  )
}

export function DocketSpread() {
  return (
    <div
      role="img"
      aria-label={`Illustration of a case in Model Court: the sample case "Support policy answers" with its exhibit, a question, two unlabeled testimonies and a juror's 0 to 2 scores. The record is sealed, then unsealed to show that Testimony A came from "${partyName(FIRST.configurationKey)}" and Testimony B from "${partyName(SECOND.configurationKey)}".`}
      className="min-w-0"
    >
      <div className="ds-stage" aria-hidden>
        <div className="ds-sheet ds-s1" style={vars({ '--i': 0 })}>
          <span className="ds-stamp ds-sealed font-mono text-caption font-semibold tracking-[0.14em] uppercase">Sealed</span>
          <span className="ds-stamp ds-unsealed font-mono text-caption font-semibold tracking-[0.14em] uppercase">Unsealed</span>
          <div className="mb-1.5 font-mono text-caption text-muted-foreground">MC-SAMPLE</div>
          <div className="pr-16 font-display text-lg leading-tight font-medium tracking-[-0.01em]">Support policy answers</div>
          <p className="mt-1.5 text-small leading-snug text-muted-foreground">Which setup answers return questions from the policy?</p>
          <div className="mt-2 text-caption text-muted-foreground">Stage 3 of 5 · Deliberate</div>
        </div>
        <div className="ds-sheet ds-s2" style={vars({ '--i': 1 })}>
          <div className="mb-2 flex items-center gap-2">
            <span className={cn('bg-sticker text-sticker-foreground', TAG)}>EXHIBIT 1</span>
            <span className="text-caption text-muted-foreground">reference evidence</span>
          </div>
          <p className="line-clamp-3 text-small leading-snug">{EXAMPLE_POLICY}</p>
        </div>
        <Testimony response={FIRST} index={0} />
        <Testimony response={SECOND} index={1} />
        <div className="ds-sheet ds-s5" style={vars({ '--i': 4 })}>
          <div className="mb-1.5 font-mono text-caption text-muted-foreground">
            QUESTION 1 OF {SAMPLE_CASES.length}
          </div>
          <div className="line-clamp-2 font-display text-[1.0625rem] leading-snug">{CASE.input}</div>
          <div className="mt-2">
            {TICKS.map(([label, criterion, score], t) => (
              <div key={`${label}-${criterion}`} className="flex items-center gap-2 border-b border-dashed border-border py-1.5 text-caption font-medium last:border-b-0">
                {label} · {criterion}
                <span className="ml-auto inline-flex overflow-hidden rounded-[5px] border border-input">
                  {[0, 1, 2].map((step) => (
                    <span key={step} className="relative grid h-[1.375rem] w-6 place-items-center border-r border-input text-caption text-muted-foreground last:border-r-0">
                      {step}
                      {step === score && (
                        <b className="ds-tick font-medium" style={vars({ '--t': t })}>
                          {step}
                        </b>
                      )}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ol className="mt-1.5 flex flex-wrap justify-center gap-1.5" aria-hidden>
        {STEPS.map(([step, delay]) => (
          <li key={step} className="ds-step inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-caption text-muted-foreground" style={vars({ '--d': delay })}>
            <i className="size-1.5 rounded-full bg-input" />
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}
