/**
 * One question's task-kit fields (spec 03 §5.2, §6.2; D-79), under its jury instructions. Answer
 * keys are reviewer-only: never sent to the models, shown to jurors as part of the instructions.
 */

import { Plus, Trash2 } from 'lucide-react'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ExtractionQuestionFields } from '@/components/evaluations/ExtractionQuestion'
import { GroundedQuestionFields } from '@/components/evaluations/SourcesEditor'
import { ToolsQuestionFields } from '@/components/evaluations/ToolTaskEditor'
import type { CaseInput } from '@/domain/contracts'
import type { ExtractionSettings } from '@/domain/kits/extraction'
import type { ClassificationFields, ClassificationSettings } from '@/domain/kits/classification'
import type { SummarizationFields } from '@/domain/kits/summarization'
import type { TaskKit } from '@/domain/kits/types'
import { LIMITS } from '@/domain/limits'
import { cn } from '@/lib/utils'

const NO_KEY = '__none__'

/** "a | b" ↔ ['a', 'b']; blank pieces are dropped. */
const splitPhrases = (value: string) => value.split('|').map((part) => part.trim()).filter(Boolean)

export function QuestionKitFields({ kit, settings, testCase, index, errors, onChange }: { kit: TaskKit<unknown, unknown>; settings: unknown; testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void }) {
  const prefix = `cases.${index}.kitFields`
  const fieldErrors = Object.entries(errors).filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
  const error = (suffix: string) => fieldErrors.find(([path]) => path === `${prefix}.${suffix}` || path.startsWith(`${prefix}.${suffix}.`))?.[1]
  const other = fieldErrors.find(([path]) => path === prefix || path === `${prefix}.kind`)?.[1]
  const id = (field: string) => `case-${testCase.key}-kit-${field}`
  const raw = testCase.kitFields as { kind?: string } | undefined
  const own = raw?.kind === kit.family ? raw : undefined
  // Spec 04 (D-88): a document and an answer key; laid out by their own component.
  if (kit.family === 'extraction') return <ExtractionQuestionFields settings={settings as ExtractionSettings} testCase={testCase} index={index} errors={errors} onChange={onChange} />
  // Spec 05 (D-95): numbered sources and the grounding key.
  if (kit.family === 'grounded') return <GroundedQuestionFields testCase={testCase} index={index} errors={errors} onChange={onChange} />
  // Spec 06 (D-103): the tools, canned responses, step cap and expectations.
  if (kit.family === 'tools') return <ToolsQuestionFields testCase={testCase} index={index} errors={errors} onChange={onChange} />
  const body =
    kit.family === 'summarization' ? (
      <SummaryFields fields={(own as SummarizationFields | undefined) ?? { kind: 'summarization', requiredPoints: [], mustNotMention: [] }} id={id} error={error} onChange={(kitFields) => onChange({ kitFields })} />
    ) : kit.family === 'classification' ? (
      <LabelKey settings={settings as ClassificationSettings} fields={(own as ClassificationFields | undefined) ?? { kind: 'classification' }} id={id} error={error} onChange={(kitFields) => onChange({ kitFields })} />
    ) : null
  if (!body) return null
  return (
    <div className="space-y-4 border-t border-paper-rule pt-4 md:col-span-2">
      <p className="court-label">
        {kit.name}: answer keys <Plain>never sent to the models</Plain>
      </p>
      {body}
      {other && <p className="text-caption text-destructive">{other}</p>}
    </div>
  )
}

function SummaryFields({ fields, id, error, onChange }: { fields: SummarizationFields; id: (field: string) => string; error: (suffix: string) => string | undefined; onChange: (next: SummarizationFields) => void }) {
  const points = fields.requiredPoints
  const setPoints = (requiredPoints: SummarizationFields['requiredPoints']) => onChange({ ...fields, requiredPoints })
  return (
    <>
      <div className="space-y-3">
        <p className="text-small font-medium">Required points</p>
        <p className="-mt-2 text-caption text-muted-foreground">A point counts as covered when any of its phrases appears in the summary. Jurors see the point, not the phrases.</p>
        {points.length === 0 && <p className="text-small text-muted-foreground">None yet. Without required points the coverage check does not apply.</p>}
        {points.map((point, i) => (
          <div key={`${i}/${points.length}`} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <Field className="gap-1.5">
              <FieldLabel htmlFor={id(`point-${i}`)}>Point {i + 1}</FieldLabel>
              <Input id={id(`point-${i}`)} value={point.text} maxLength={LIMITS.kits.requiredPointText.max} aria-invalid={error(`requiredPoints.${i}.text`) ? true : undefined} onChange={(e) => setPoints(points.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)))} />
              {error(`requiredPoints.${i}.text`) && <FieldDescription className="text-caption text-destructive">{error(`requiredPoints.${i}.text`)}</FieldDescription>}
            </Field>
            <Field className="gap-1.5">
              <FieldLabel htmlFor={id(`phrases-${i}`)}>Phrases that show it</FieldLabel>
              <Input
                id={id(`phrases-${i}`)}
                defaultValue={point.anyOf.join(' | ')}
                aria-invalid={error(`requiredPoints.${i}.anyOf`) ? true : undefined}
                aria-describedby={id(`phrases-${i}-help`)}
                onChange={(e) => setPoints(points.map((p, j) => (j === i ? { ...p, anyOf: splitPhrases(e.target.value) } : p)))}
              />
              <FieldDescription id={id(`phrases-${i}-help`)} className={cn('text-caption', error(`requiredPoints.${i}.anyOf`) && 'text-destructive')}>
                {error(`requiredPoints.${i}.anyOf`) ?? `Separate with | (up to ${LIMITS.kits.phrasesPerPoint}). Whole words; case ignored.`}
              </FieldDescription>
            </Field>
            <Button size="icon-sm" variant="ghost" className="sm:mt-7" aria-label={`Remove point ${i + 1}`} onClick={() => setPoints(points.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" disabled={points.length >= LIMITS.kits.requiredPoints} onClick={() => setPoints([...points, { text: '', anyOf: [] }])}>
          <Plus aria-hidden /> Add a required point ({points.length}/{LIMITS.kits.requiredPoints})
        </Button>
      </div>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={id('avoid')}>Phrases the summary must not contain (optional)</FieldLabel>
        <Input id={id('avoid')} defaultValue={fields.mustNotMention.join(' | ')} aria-invalid={error('mustNotMention') ? true : undefined} aria-describedby={id('avoid-help')} onChange={(e) => onChange({ ...fields, mustNotMention: splitPhrases(e.target.value) })} />
        <FieldDescription id={id('avoid-help')} className={cn('text-caption', error('mustNotMention') && 'text-destructive')}>
          {error('mustNotMention') ?? `A name to keep private, or a claim not in the document. Separate with | (up to ${LIMITS.kits.mustNotMention}).`}
        </FieldDescription>
      </Field>
    </>
  )
}

function LabelKey({ settings, fields, id, error, onChange }: { settings: ClassificationSettings; fields: ClassificationFields; id: (field: string) => string; error: (suffix: string) => string | undefined; onChange: (next: ClassificationFields) => void }) {
  const labels = settings.labels
  const expected = fields.expectedLabel
  const also = fields.alsoAccept ?? []
  const setExpected = (value: string) => {
    if (value === NO_KEY) onChange({ kind: 'classification' })
    else onChange({ kind: 'classification', expectedLabel: value, ...(also.filter((label) => label !== value).length > 0 ? { alsoAccept: also.filter((label) => label !== value) } : {}) })
  }
  const toggleAlso = (label: string, on: boolean) => {
    const next = on ? [...also, label] : also.filter((item) => item !== label)
    const { alsoAccept: _previous, ...rest } = fields
    onChange(next.length > 0 ? { ...rest, alsoAccept: next } : rest)
  }
  return (
    <>
      <Field className="max-w-sm gap-1.5">
        <FieldLabel htmlFor={id('expected')}>Expected label</FieldLabel>
        <Select value={expected ?? NO_KEY} onValueChange={(value) => setExpected(String(value))} items={[{ value: NO_KEY, label: 'No answer key for this question' }, ...labels.map((label) => ({ value: label, label }))]}>
          <SelectTrigger id={id('expected')} aria-invalid={error('expectedLabel') ? true : undefined} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_KEY}>No answer key for this question</SelectItem>
            {labels.map((label) => (
              <SelectItem key={label} value={label}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription className={cn('text-caption', error('expectedLabel') && 'text-destructive')}>{error('expectedLabel') ?? 'Without one, the accuracy check does not apply to this question.'}</FieldDescription>
      </Field>
      {expected && labels.length > 1 && (
        <fieldset className="space-y-1.5">
          <legend className="text-small font-medium">Also accept (optional, when more than one label fits)</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {labels
              .filter((label) => label !== expected)
              .map((label) => (
                <div key={label} className="flex items-center gap-2">
                  <Checkbox id={id(`also-${label}`)} checked={also.includes(label)} disabled={!also.includes(label) && also.length >= LIMITS.kits.alsoAccept} onCheckedChange={(checked) => toggleAlso(label, checked === true)} />
                  <Label htmlFor={id(`also-${label}`)} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
          </div>
          {error('alsoAccept') && <p className="text-caption text-destructive">{error('alsoAccept')}</p>}
        </fieldset>
      )}
    </>
  )
}
