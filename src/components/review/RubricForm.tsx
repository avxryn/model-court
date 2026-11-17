/**
 * Scores one anonymous response on the fixed rubric. Composes shadcn
 * RadioGroup, Textarea, Checkbox, and Label; anchors come from the single
 * rubric definition shared with the server scorer (E02).
 */

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import type { DraftRating, Score } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { DIMENSIONS, noteRequired, RUBRIC } from '@/domain/rubric'
import { codePointLength } from '@/domain/text'
import { cn } from '@/lib/utils'

export function emptyRating(responseId: string): DraftRating {
  return { responseId, correctness: null, completeness: null, grounding: null, note: '', suspectedIdentityClue: false }
}

export function RubricForm({ label, rating, onChange, disabled }: { label: string; rating: DraftRating; onChange: (next: DraftRating) => void; disabled?: boolean }) {
  const id = useId()
  const needsNote = noteRequired(rating)
  const noteLength = codePointLength(rating.note.trim())
  const noteInvalid = needsNote && noteLength < LIMITS.ratingNote.min

  return (
    <div className="space-y-6">
      {DIMENSIONS.map((dimension) => (
        <FieldSet key={dimension} className="space-y-2" disabled={disabled}>
          <FieldLegend id={`${id}-${dimension}-legend`} className="mb-0 text-sm font-semibold">
            {RUBRIC[dimension].label} <span className="sr-only">for response {label}</span>
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
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm leading-snug font-normal transition-colors duration-150',
                    checked ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/15' : 'border-border bg-card hover:border-input hover:bg-secondary/60',
                    disabled && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <RadioGroupItem id={itemId} value={String(score)} className="mt-0.5" aria-labelledby={`${itemId}-text`} />
                  <span id={`${itemId}-text`}>
                    <span className="font-semibold text-foreground tabular-nums">{score}</span>
                    <span className={checked ? 'text-foreground/80' : 'text-muted-foreground'}> — {RUBRIC[dimension].anchors[score]}</span>
                  </span>
                </Label>
              )
            })}
          </RadioGroup>
        </FieldSet>
      ))}

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`}>
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
          placeholder="What in the response supports your scores?"
          rows={3}
        />
        <FieldDescription id={`${id}-note-help`} className={cn('text-xs', noteInvalid && 'text-destructive')}>
          {noteInvalid ? `Explain the 0 in at least ${LIMITS.ratingNote.min} characters.` : `${noteLength}/${LIMITS.ratingNote.max} characters`}
        </FieldDescription>
      </div>

      <div className="flex items-start gap-3 rounded-lg bg-secondary/60 px-3 py-3">
        <Checkbox
          id={`${id}-clue`}
          checked={rating.suspectedIdentityClue}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...rating, suspectedIdentityClue: checked === true })}
        />
        <Label htmlFor={`${id}-clue`} className="flex-col items-start gap-1 text-sm leading-snug font-normal text-pretty">
          This response hints at which model wrote it
          <span className="block text-xs leading-snug text-muted-foreground">Flagged sessions are counted as potentially unblinded in results.</span>
        </Label>
      </div>
    </div>
  )
}
