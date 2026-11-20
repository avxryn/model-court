import type { ReactNode } from 'react'
import { CountedField } from '@/components/evaluations/CountedField'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IMPORT_SOURCE_TYPES, type ImportedConfiguration, type Provenance } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { SOURCE_LABELS } from '@/lib/parties'

/** Where an imported party's answers came from, and its answer editor (D-37). */
export function ImportedPartyFields({ party, index, errors, onChange, renderAnswers }: { party: ImportedConfiguration; index: number; errors: FieldErrors; onChange: (next: ImportedConfiguration) => void; renderAnswers?: (party: ImportedConfiguration) => ReactNode }) {
  const set = (patch: Partial<Provenance>) => onChange({ ...party, provenance: { ...party.provenance, ...patch } })
  const base = `configurations.${index}.provenance`
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`cfg-${party.key}-source`}>Where these answers came from</Label>
        <Select value={party.provenance.sourceType} onValueChange={(value) => set({ sourceType: value as Provenance['sourceType'] })} items={IMPORT_SOURCE_TYPES.map((value) => ({ value, label: SOURCE_LABELS[value] }))}>
          <SelectTrigger id={`cfg-${party.key}-source`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_SOURCE_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {SOURCE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <CountedField
        id={`cfg-${party.key}-description`}
        label="Describe the source (shown after unsealing)"
        multiline
        rows={2}
        value={party.provenance.description}
        max={LIMITS.provenanceDescription.max}
        hint="For example: written by the support lead in November."
        error={errors[`${base}.description`]}
        onChange={(description) => set({ description })}
      />
      <div className="space-y-1.5 sm:max-w-xs">
        <Label htmlFor={`cfg-${party.key}-collected`}>Collected on (optional)</Label>
        <Input
          id={`cfg-${party.key}-collected`}
          type="date"
          value={party.provenance.collectedOn ?? ''}
          onChange={(e) => set({ collectedOn: e.target.value || undefined })}
          aria-invalid={errors[`${base}.collectedOn`] ? true : undefined}
          aria-describedby={errors[`${base}.collectedOn`] ? `cfg-${party.key}-collected-help` : undefined}
        />
        {errors[`${base}.collectedOn`] && (
          <FieldError id={`cfg-${party.key}-collected-help`} className="text-caption">
            {errors[`${base}.collectedOn`]}
          </FieldError>
        )}
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id={`cfg-${party.key}-redacted`} checked={party.provenance.redacted} onCheckedChange={(checked) => set({ redacted: checked === true })} />
        <Label htmlFor={`cfg-${party.key}-redacted`} className="flex-col items-start gap-0.5 font-normal leading-snug">
          I removed names, emails, and other details that could reveal the source
          <span className="text-caption text-muted-foreground">The record says the answers were redacted.</span>
        </Label>
      </div>
      {renderAnswers?.(party)}
    </div>
  )
}
