/**
 * Scores one anonymous response on the fixed rubric. Composes shadcn
 * RadioGroup, Textarea, Checkbox, and Label; anchors come from the single
 * rubric definition shared with the server scorer (E02).
 */

import { Plain } from '@/components/common'
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { DraftRating, Score } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { DIMENSIONS, noteRequired, rubricLines } from '@/domain/rubric'
import { codePointLength } from '@/domain/text'
import { cn } from '@/lib/utils'

export function emptyRating(responseId: string): DraftRating {
  return { responseId, correctness: null, completeness: null, grounding: null, note: '', suspectedIdentityClue: false }
}

export function RubricForm({ label, rating, onChange, disabled, rubricVersion }: { label: string; rating: DraftRating; onChange: (next: DraftRating) => void; disabled?: boolean; rubricVersion?: string }) {
  const RUBRIC = rubricLines(rubricVersion)
  const id = useId()
  const needsNote = noteRequired(rating)
  const noteLength = codePointLength(rating.note.trim())
  const noteInvalid = needsNote && noteLength < LIMITS.ratingNote.min

  return (
    <div className="space-y-5">
      <div className="court-label">
        Juror’s worksheet <Plain>your ratings</Plain>
      </div>
      {DIMENSIONS.map((dimension) => (
        <FieldSet key={dimension} className="space-y-1.5 border-b border-dotted border-paper-edge pb-4" disabled={disabled}>
          <FieldLegend id={`${id}-${dimension}-legend`} className="mb-0 font-heading text-base font-bold">
            {RUBRIC[dimension].label} <span className="sr-only">for testimony {label}</span>
          </FieldLegend>
          <RadioGroup
            value={rating[dimension] === null ? null : String(rating[dimension])}
            onValueChange={(value) => onChange({ ...rating, [dimension]: Number(value) as Score })}
            className="grid gap-1.5"
            disabled={disabled}
            aria-labelledby={`${id}-${dimension}-legend`}
          >
            {([0, 1, 2] as const).map((score) => {
              const itemId = `${id}-${dimension}-${score}`
              const checked = rating[dimension] === score
              return (
                <Label
                  key={score}
                  htmlFor={itemId}
                  className={cn(
                    'relative -mx-1.5 flex cursor-pointer items-center gap-3 rounded-md px-1.5 py-1 text-sm leading-snug font-normal transition-colors duration-150 focus-within:ring-2 focus-within:ring-ring/50',
                    checked ? 'bg-slip' : 'hover:bg-slip/60',
                    disabled && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <RadioGroupItem id={itemId} value={String(score)} className="absolute sr-only" aria-labelledby={`${itemId}-text`} />
                  <span
                    aria-hidden
                    className={cn(
                      'typewriter grid size-9 shrink-0 place-items-center rounded-full text-base tabular-nums transition-colors duration-150',
                      checked ? 'bg-foreground font-bold text-paper' : 'bg-paper text-foreground ring-[1.5px] ring-mark',
                    )}
                  >
                    {score}
                  </span>
                  <span id={`${itemId}-text`}>
                    <span className="sr-only">{score} — </span>
                    <span className={checked ? 'text-foreground' : 'text-muted-foreground'}>{RUBRIC[dimension].anchors[score]}</span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </FieldSet>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`} className="flex-wrap gap-x-2 gap-y-1 font-heading text-base leading-snug font-bold">
          Evidence note {needsNote ? <span className="text-destructive">(required for any 0)</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Textarea
          id={`${id}-note`}
          value={rating.note}
          disabled={disabled}
          maxLength={LIMITS.ratingNote.max * 2}
          aria-invalid={noteInvalid || undefined}
          aria-describedby={`${id}-note-help`}
          onChange={(event) => onChange({ ...rating, note: event.target.value })}
          placeholder="What in the testimony supports your scores?"
          className="bg-white font-heading"
          rows={3}
        />
        <FieldDescription id={`${id}-note-help`} className={cn('text-xs', noteInvalid && 'text-destructive')}>
          {noteInvalid ? `Explain the 0 in at least ${LIMITS.ratingNote.min} characters.` : `${noteLength}/${LIMITS.ratingNote.max} characters`}
        </FieldDescription>
      </div>

      <div className="flex items-start gap-3 rounded-md bg-slip px-3 py-3">
        <Checkbox
          id={`${id}-clue`}
          checked={rating.suspectedIdentityClue}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...rating, suspectedIdentityClue: checked === true })}
        />
        <Label htmlFor={`${id}-clue`} className="flex-col items-start gap-1 text-sm leading-snug font-normal text-pretty">
          This testimony hints at which party gave it
          <span className="block text-xs leading-snug text-muted-foreground">Flagged sessions are counted as potentially unblinded in results.</span>
        </Label>
      </div>
    </div>
  )
}
