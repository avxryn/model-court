/**
 * Spec 07 §9.4 (D-111): with four or five parties, a square matrix "row beat column on k of n
 * questions", beside the per-question table. It scrolls inside its own frame at narrow widths, with
 * the first column kept in view.
 */

import { pairwiseWins, type Tally } from '@/components/record/headline'
import { cn } from '@/lib/utils'

export function PairwiseTable({ tally }: { tally: Pick<Tally, 'questions' | 'parties'> }) {
  if (tally.questions.length === 0 || tally.parties.length < 4) return null
  const { beats, questions } = pairwiseWins(tally)
  return (
    <div className="exhibit-panel overflow-hidden">
      <div className="overflow-x-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label="Pairwise, party against party" aria-describedby="pairwise-hint">
        <table className="w-full caption-bottom text-sm">
          <caption className="sr-only">Pairwise: the number of questions on which the party in the row scored more points than the party in the column, out of {questions}.</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="sticky left-0 z-10 min-w-32 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Row beat column on
              </th>
              {tally.parties.map((p) => (
                <th key={p.key} scope="col" className="min-w-24 px-3 py-2 text-right text-xs font-medium whitespace-normal">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tally.parties.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium whitespace-normal">
                  {row.label}
                </th>
                {tally.parties.map((col) => {
                  if (row.key === col.key) return <td key={col.key} className="px-3 py-2 text-right text-muted-foreground" aria-label="same party">—</td>
                  const k = beats[row.key][col.key]
                  const lost = beats[col.key][row.key]
                  return (
                    <td key={col.key} className={cn('px-3 py-2 text-right tabular-nums', k > lost ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                      {k} of {questions}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p id="pairwise-hint" className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        Questions where the row party scored more points than the column party; ties count for neither. Scroll sideways for more parties.
      </p>
    </div>
  )
}
