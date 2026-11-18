/**
 * Scores one anonymous response on the fixed rubric. Composes shadcn
 * RadioGroup, Textarea, Checkbox, and Label; anchors come from the single
 * rubric definition shared with the server scorer (E02).
 */

import { Plain } from '@/components/court/Paper'
import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldDescription, FieldSet } from '@/components/ui/field'
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
    <div className="space-y-4">
      <div className="court-label">
        Juror’s worksheet <Plain>your ratings</Plain>
      </div>
      <div>
        {DIMENSIONS.map((dimension) => {
          const value = rating[dimension]
          return (
            <FieldSet
              key={dimension}
              className="gap-0 border-b border-dashed border-border py-2.5 last:border-b-0"
              disabled={disabled}
              // 0, 1 or 2 scores the line that has focus (the worksheet's keyboard flow, D-47).
              onKeyDown={(event) => {
                if (disabled || event.metaKey || event.ctrlKey || event.altKey || !['0', '1', '2'].includes(event.key) || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
                event.preventDefault()
                onChange({ ...rating, [dimension]: Number(event.key) as Score })
              }}
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <span id={`${id}-${dimension}-legend`} className="block text-sm font-medium">
                    {RUBRIC[dimension].label} <span className="sr-only">for testimony {label}</span>
                  </span>
                  <span aria-live="polite" className="block text-xs leading-snug text-muted-foreground">
                    {value === null ? 'Not scored yet' : RUBRIC[dimension].anchors[value]}
                  </span>
                </div>
                <RadioGroup
                  value={value === null ? null : String(value)}
                  onValueChange={(next) => onChange({ ...rating, [dimension]: Number(next) as Score })}
                  className="flex w-auto shrink-0 gap-0 overflow-hidden rounded-md ring-1 ring-input"
                  disabled={disabled}
                  aria-labelledby={`${id}-${dimension}-legend`}
                >
                  {([0, 1, 2] as const).map((score) => {
                    const itemId = `${id}-${dimension}-${score}`
                    const checked = value === score
                    return (
                      <Label
                        key={score}
                        htmlFor={itemId}
                        title={RUBRIC[dimension].anchors[score]}
                        className={cn(
                          'relative grid h-8 w-9 cursor-pointer place-items-center border-r border-input text-sm font-medium tabular-nums transition-colors last:border-r-0 focus-within:z-[1] focus-within:ring-3 focus-within:ring-ring/50',
                          checked ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                          disabled && 'cursor-not-allowed opacity-70',
                        )}
                      >
                        <RadioGroupItem id={itemId} value={String(score)} className="absolute sr-only" aria-label={`${score}: ${RUBRIC[dimension].anchors[score]}`} />
                        <span aria-hidden>{score}</span>
                      </Label>
                    )
                  })}
                </RadioGroup>
              </div>
            </FieldSet>
          )
        })}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${id}-note`} className="flex-wrap gap-x-2 gap-y-1 text-sm leading-snug font-medium">
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
          className="bg-card"
          rows={2}
        />
        <FieldDescription id={`${id}-note-help`} className={cn('text-xs', noteInvalid && 'text-destructive')}>
          {noteInvalid ? `Explain the 0 in at least ${LIMITS.ratingNote.min} characters.` : `${noteLength}/${LIMITS.ratingNote.max} characters`}
        </FieldDescription>
      </div>

      <div className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2.5">
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
