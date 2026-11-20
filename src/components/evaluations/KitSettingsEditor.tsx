/**
 * The chosen kit's settings (spec 03 §5.1, §6.1; D-79). Shown under the kit picker; nothing for
 * General answers. Validation comes from the shared draft schema through `errors`.
 */

import { useState } from 'react'
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { DraftInput } from '@/domain/contracts'
import { ExtractionSettingsFields } from '@/components/evaluations/ExtractionSettings'
import type { ClassificationSettings } from '@/domain/kits/classification'
import type { ExtractionSettings } from '@/domain/kits/extraction'
import type { SummarizationSettings } from '@/domain/kits/summarization'
import { LIMITS } from '@/domain/limits'
import { draftKit, draftKitSettings, withKitSettings } from '@/lib/kits'
import { cn } from '@/lib/utils'

export function KitSettingsEditor({ draft, onChange, errors }: { draft: DraftInput; onChange: (next: DraftInput) => void; errors: FieldErrors }) {
  const kit = draftKit(draft)
  if (kit.family === 'summarization') return <SummarizationSettingsFields settings={draftKitSettings<SummarizationSettings>(draft)} errors={errors} onChange={(settings) => onChange(withKitSettings(draft, settings))} />
  if (kit.family === 'extraction') return <ExtractionSettingsFields settings={draftKitSettings<ExtractionSettings>(draft)} errors={errors} onChange={(settings) => onChange(withKitSettings(draft, settings))} />
  if (kit.family === 'classification') return <ClassificationSettingsFields settings={draftKitSettings<ClassificationSettings>(draft)} errors={errors} onChange={(settings) => onChange(withKitSettings(draft, settings))} />
  return null
}

function NumberField({ id, label, value, onChange, error, hint, min, max }: { id: string; label: string; value: number | undefined; onChange: (value: number | undefined) => void; error?: string; hint?: string; min: number; max: number }) {
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="w-28! tabular-nums"
        value={value ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Math.trunc(Number(event.target.value)))}
      />
      <FieldDescription id={`${id}-help`} className={cn('text-caption', error && 'text-destructive')}>
        {error ?? hint}
      </FieldDescription>
    </Field>
  )
}

function SummarizationSettingsFields({ settings, onChange, errors }: { settings: SummarizationSettings; onChange: (next: SummarizationSettings) => void; errors: FieldErrors }) {
  const set = (patch: Partial<SummarizationSettings>) => onChange({ ...settings, ...patch })
  const cap = settings.lengthUnit === 'words' ? LIMITS.kits.summaryMaxWords : LIMITS.kits.summaryMaxCharacters
  return (
    <div className="mb-8 space-y-5 rounded-md border border-paper-rule px-4 py-4">
      <p className="court-label">
        Summary limits <Plain>stated to every party; the checks enforce them</Plain>
      </p>
      <div className="space-y-1.5">
        <p id="kit-unit-legend" className="text-small font-medium">Count length in</p>
        <ChoiceCardGroup aria-labelledby="kit-unit-legend" value={settings.lengthUnit} onValueChange={(v) => set({ lengthUnit: v as SummarizationSettings['lengthUnit'] })} className="sm:grid-cols-2">
          <ChoiceCard id="kit-unit-words" value="words" title="Words" />
          <ChoiceCard id="kit-unit-characters" value="characters" title="Characters" description="For languages written without spaces." />
        </ChoiceCardGroup>
      </div>
      <div className="flex flex-wrap gap-6">
        <NumberField id="kit-max" label={`Most ${settings.lengthUnit}`} value={settings.maxLength} min={1} max={cap} hint={`Up to ${cap.toLocaleString('en-US')} ${settings.lengthUnit}`} error={errors['kit.settings.maxLength']} onChange={(value) => set({ maxLength: value ?? 0 })} />
        <NumberField id="kit-min" label={`Fewest ${settings.lengthUnit} (optional)`} value={settings.minLength} min={0} max={cap} hint="Leave empty for no minimum." error={errors['kit.settings.minLength']} onChange={(value) => onChange(value === undefined ? withoutMin(settings) : { ...settings, minLength: value })} />
      </div>
      <div className="space-y-1.5">
        <p id="kit-format-legend" className="text-small font-medium">Format</p>
        <ChoiceCardGroup aria-labelledby="kit-format-legend" value={settings.format} onValueChange={(v) => set({ format: v as SummarizationSettings['format'] })} className="sm:grid-cols-3">
          <ChoiceCard id="kit-format-any" value="any" title="Any" description="Not checked." />
          <ChoiceCard id="kit-format-paragraph" value="paragraph" title="Paragraph" description="No bullet points." />
          <ChoiceCard id="kit-format-bullets" value="bullets" title="Bullet points" description="At least two." />
        </ChoiceCardGroup>
      </div>
      <div className="flex items-start gap-2">
        <Checkbox id="kit-numbers" checked={settings.checkNumbers} onCheckedChange={(checked) => set({ checkNumbers: checked === true })} className="mt-0.5" />
        <Label htmlFor="kit-numbers" className="block font-normal leading-snug">
          Check that every number in a summary appears in the document
          <span className="mt-0.5 block text-caption text-muted-foreground">Catches invented figures. It also flags spelled-out numbers, reworded dates and computed totals, so read a failure before you count it.</span>
        </Label>
      </div>
    </div>
  )
}

function withoutMin(settings: SummarizationSettings): SummarizationSettings {
  const { minLength: _removed, ...rest } = settings
  return rest
}

function ClassificationSettingsFields({ settings, onChange, errors }: { settings: ClassificationSettings; onChange: (next: ClassificationSettings) => void; errors: FieldErrors }) {
  // Kept as typed, so a new empty line can be started; saved labels drop blank lines.
  const [text, setText] = useState(settings.labels.join('\n'))
  const labelErrors = Object.entries(errors).filter(([path]) => path === 'kit.settings.labels' || path.startsWith('kit.settings.labels.'))
  const labelError = labelErrors.map(([, message]) => message)[0]
  return (
    <div className="mb-8 space-y-5 rounded-md border border-paper-rule px-4 py-4">
      <p className="court-label">
        Labels <Plain>sent to every party as the allowed answers</Plain>
      </p>
      <Field className="gap-1.5">
        <FieldLabel htmlFor="kit-labels">Allowed labels, one per line</FieldLabel>
        <Textarea
          id="kit-labels"
          rows={Math.min(8, Math.max(3, settings.labels.length + 1))}
          className="max-w-md"
          value={text}
          aria-invalid={labelError ? true : undefined}
          aria-describedby="kit-labels-help"
          onChange={(event) => {
            setText(event.target.value)
            onChange({ ...settings, labels: event.target.value.split(/\r?\n/u).filter((line) => line.trim() !== '') })
          }}
        />
        <FieldDescription id="kit-labels-help" className={cn('text-caption', labelError && 'text-destructive')}>
          {labelError ?? `${LIMITS.kits.labels.min}–${LIMITS.kits.labels.max} labels, each up to ${LIMITS.kits.label.max} characters. Every party must answer with one of them on its first line.`}
        </FieldDescription>
      </Field>
      <NumberField
        id="kit-reasoning"
        label="Fewest words of reasoning"
        value={settings.minReasoningWords}
        min={0}
        max={LIMITS.kits.minReasoningWords}
        hint="0 turns this check off."
        error={errors['kit.settings.minReasoningWords']}
        onChange={(value) => onChange({ ...settings, minReasoningWords: value ?? 0 })}
      />
    </div>
  )
}
