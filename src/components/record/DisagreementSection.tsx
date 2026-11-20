/**
 * Where the jury split (D-54): the questions where jurors were two points apart
 * on a line (one gave 0, another 2) or flagged that a testimony hinted at its
 * party, most contested first. Only the jury counts; the judge's own review is
 * context-aware and reported separately. Each row links to that question's
 * testimony, which opens it.
 */

import { ArrowDown, Flag } from 'lucide-react'
import { SheetSection } from '@/components/court/CaseFile'
import { Plain } from '@/components/court/Paper'
import { DIMENSIONS, rubricLines, type Dimension } from '@/domain/rubric'
import type { ResultsView } from '@/lib/dto'

export interface Split {
  configurationKey: string
  dimension: Dimension
  low: number
  high: number
}

export interface ContestedQuestion {
  key: string
  number: number
  title: string
  splits: Split[]
  /** Lines one point apart: shown only as a count. */
  nearSplits: number
  flags: number
}

/** Jury disagreement per question. `jurors` is how many distinct jurors scored anything. */
export function findSplits(data: Pick<ResultsView, 'cases'>): { jurors: number; contested: ContestedQuestion[]; nearOnly: number } {
  const everyone = new Set<string>()
  const questions: ContestedQuestion[] = []
  data.cases.forEach((testCase, index) => {
    const jury = testCase.judgments.filter((j) => j.contextType !== 'owner')
    jury.forEach((j) => everyone.add(j.reviewer))
    const splits: Split[] = []
    let nearSplits = 0
    const parties = [...new Set(jury.map((j) => j.configurationKey))]
    for (const configurationKey of parties) {
      for (const dimension of DIMENSIONS) {
        const scores = jury.filter((j) => j.configurationKey === configurationKey).map((j) => j[dimension]).filter((s): s is 0 | 1 | 2 => s !== null)
        if (scores.length < 2) continue
        const low = Math.min(...scores)
        const high = Math.max(...scores)
        if (high - low >= 2) splits.push({ configurationKey, dimension, low, high })
        else if (high - low === 1) nearSplits += 1
      }
    }
    const flags = new Set(jury.filter((j) => j.suspectedIdentityClue).map((j) => `${j.reviewer}|${j.configurationKey}`)).size
    questions.push({ key: testCase.key, number: index + 1, title: testCase.title, splits, nearSplits, flags })
  })
  const contested = questions.filter((q) => q.splits.length > 0 || q.flags > 0).sort((a, b) => b.splits.length - a.splits.length || b.flags - a.flags || b.nearSplits - a.nearSplits || a.number - b.number)
  const nearOnly = questions.filter((q) => q.splits.length === 0 && q.flags === 0 && q.nearSplits > 0).length
  return { jurors: everyone.size, contested, nearOnly }
}

/** Shown only when at least two jurors scored, since one juror cannot disagree. */
export function DisagreementSection({ data }: { data: ResultsView }) {
  const { jurors, contested, nearOnly } = findSplits(data)
  if (jurors < 2) return null
  const lines = rubricLines(data.rubricVersion)
  const labels = Object.fromEntries(data.configurations.map((c) => [c.key, c.label]))
  return (
    <SheetSection
      id="splits"
      label={
        <>
          Where the jury split <Plain>questions to read closely</Plain>
        </>
      }
    >
      {contested.length === 0 ? (
        <p className="text-small text-muted-foreground">
          No juror was two points from another on any line, and no testimony was flagged for hinting at its party.
          {nearOnly > 0 && ` ${nearOnly === 1 ? 'One question has' : `${nearOnly} questions have`} one-point differences only.`}
        </p>
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border">
          {contested.map((q) => (
            <li key={q.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-2">
                <div className="text-small font-medium">
                  Q{q.number}: {q.title}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {q.splits.map((s) => (
                    <li key={`${s.configurationKey}-${s.dimension}`} className="rounded-md bg-muted px-2 py-0.5 text-caption">
                      {lines[s.dimension].label} · {labels[s.configurationKey]}: <span className="font-medium tabular-nums">{s.low} vs {s.high}</span>
                    </li>
                  ))}
                  {q.flags > 0 && (
                    <li className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-caption text-warning">
                      <Flag aria-hidden className="size-3" />
                      {q.flags === 1 ? 'Identity clue flagged once' : `Identity clue flagged ${q.flags} times`}
                    </li>
                  )}
                </ul>
              </div>
              <a href={`#q-${q.key}`} className="inline-flex shrink-0 items-center gap-1 rounded-sm text-small text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                Read the testimony <ArrowDown aria-hidden className="size-3.5" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </SheetSection>
  )
}
