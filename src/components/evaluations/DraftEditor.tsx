/**
 * CaseEditor and ConfigurationEditor: controlled, field-level validation from
 * the shared draft schema (E02). Server validation remains authoritative.
 */

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from 'lucide-react'
import { CaseImport } from '@/components/evaluations/CaseImport'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { IMPORT_SOURCE_TYPES, isImported, type CaseInput, type ComparisonMode, type Configuration, type DraftInput, type ImportedConfiguration, type ModelConfiguration, type Provenance } from '@/domain/contracts'
import { DEFAULT_SYSTEM_PROMPT } from '@/domain/example'
import { SOURCE_LABELS } from '@/lib/parties'
import { LIMITS } from '@/domain/limits'
import { DIMENSIONS, RUBRIC_VERSION, RUBRIC_VERSIONS, RUBRICS, type RubricVersion } from '@/domain/rubric'
import { codePointLength } from '@/domain/text'
import type { CatalogView } from '@/lib/dto'
import { cn } from '@/lib/utils'

export type FieldErrors = Record<string, string>

function TextField({ id, label, value, onChange, error, max, multiline, rows = 3, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; max: number; multiline?: boolean; rows?: number; hint?: string }) {
  const count = codePointLength(value)
  const describedBy = `${id}-help`
  const props = { id, value, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? <Textarea {...props} rows={rows} onChange={(e) => onChange(e.target.value)} /> : <Input {...props} onChange={(e) => onChange(e.target.value)} />}
      <p id={describedBy} className={cn('flex justify-between gap-4 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
        <span>{error ?? hint}</span>
        <span className={cn('tabular-nums', count > max && 'text-destructive')}>
          {count.toLocaleString()}/{max.toLocaleString()}
        </span>
      </p>
    </div>
  )
}

export function CasesEditor({ cases, onChange, errors, newId, disabled }: { cases: CaseInput[]; onChange: (next: CaseInput[]) => void; errors: FieldErrors; newId: () => string; disabled?: boolean }) {
  const update = (index: number, patch: Partial<CaseInput>) => onChange(cases.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const move = (index: number, delta: number) => {
    const next = [...cases]
    const [item] = next.splice(index, 1)
    next.splice(index + delta, 0, item)
    onChange(next)
  }
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="sr-only">Questions</legend>
      <CaseImport currentCount={cases.length} newId={newId} onImport={onChange} disabled={disabled} />
      {cases.map((testCase, index) => (
        <Card key={testCase.key} className="rounded-[2px] bg-white ring-exhibit-edge">
          <CardHeader>
            <CardTitle className="court-label">
              Question presented <span className="typewriter font-normal tracking-normal">· Q{index + 1}</span>
            </CardTitle>
            <CardAction className="flex gap-1">
              <Button size="icon-sm" variant="ghost" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp aria-hidden />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Move question ${index + 1} down`} disabled={index === cases.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown aria-hidden />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove question ${index + 1}`} disabled={cases.length <= LIMITS.minCases} onClick={() => onChange(cases.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <TextField id={`case-${testCase.key}-title`} label="Short title" value={testCase.title} max={LIMITS.caseTitle.max} error={errors[`cases.${index}.title`]} onChange={(title) => update(index, { title })} />
            </div>
            <TextField id={`case-${testCase.key}-input`} label="The question (sent to the models)" multiline rows={4} value={testCase.input} max={LIMITS.caseInput.max} error={errors[`cases.${index}.input`]} onChange={(input) => update(index, { input })} />
            <TextField
              id={`case-${testCase.key}-reference`}
              label="Exhibit: reference evidence (sent to the models)"
              multiline
              rows={4}
              value={testCase.reference}
              max={LIMITS.caseReference.max}
              hint="May be empty to test abstention."
              error={errors[`cases.${index}.reference`]}
              onChange={(reference) => update(index, { reference })}
            />
            <div className="md:col-span-2">
              <TextField
                id={`case-${testCase.key}-expected`}
                label="Jury instructions: what a good answer does (never sent to the models)"
                multiline
                rows={2}
                value={testCase.expectedBehavior}
                max={LIMITS.caseExpectedBehavior.max}
                error={errors[`cases.${index}.expectedBehavior`]}
                onChange={(expectedBehavior) => update(index, { expectedBehavior })}
              />
            </div>
            <div className="md:col-span-2 md:max-w-xs">
              <TextField
                id={`case-${testCase.key}-language`}
                label="Language (optional)"
                value={testCase.language ?? ''}
                max={LIMITS.caseLanguage.max}
                hint="For example en or Spanish. Tag two or more languages to see findings by language."
                error={errors[`cases.${index}.language`]}
                onChange={(language) => update(index, { language: language.trim() === '' ? undefined : language })}
              />
            </div>
          </CardContent>
        </Card>
      ))}
      <Button
        variant="outline"
        disabled={cases.length >= LIMITS.maxCases}
        onClick={() => onChange([...cases, { key: newId(), title: `Question ${cases.length + 1}`, input: '', reference: '', expectedBehavior: '' }])}
      >
        <Plus aria-hidden /> Add a question ({cases.length}/{LIMITS.maxCases})
      </Button>
    </fieldset>
  )
}

/** Choose the jury's rubric (D-35). Hearings keep the version they started with. */
export function RubricPicker({ value, onChange, disabled }: { value: RubricVersion | undefined; onChange: (next: RubricVersion) => void; disabled?: boolean }) {
  const current = value ?? RUBRIC_VERSION
  return (
    <fieldset disabled={disabled} className="mb-6 space-y-2">
      <legend id="rubric-legend" className="court-label mb-2">
        The jury’s rubric{' '}
        <span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">(what jurors score; each line is 0–2)</span>
      </legend>
      <RadioGroup aria-labelledby="rubric-legend" value={current} onValueChange={(v) => onChange(v as RubricVersion)} className="grid gap-2 md:grid-cols-3">
        {RUBRIC_VERSIONS.map((version) => {
          const rubric = RUBRICS[version]
          return (
            <Label key={version} htmlFor={`rubric-${version}`} className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 font-normal transition-colors duration-150', current === version ? 'border-foreground bg-slip' : 'border-paper-edge bg-white hover:bg-slip/60')}>
              <RadioGroupItem id={`rubric-${version}`} value={version} className="mt-0.5" aria-labelledby={`rubric-${version}-text`} />
              <span id={`rubric-${version}-text`} className="leading-snug">
                <span className="block font-medium text-foreground">{rubric.name}</span>
                <span className="block text-xs text-muted-foreground">{DIMENSIONS.map((d) => rubric.lines[d].label).join(' · ')}</span>
              </span>
            </Label>
          )
        })}
      </RadioGroup>
    </fieldset>
  )
}

export function ConfigurationsEditor({
  draft,
  onChange,
  errors,
  catalog,
  disabled,
  newId,
  renderImportedAnswers,
}: {
  draft: DraftInput
  onChange: (next: DraftInput) => void
  errors: FieldErrors
  catalog: CatalogView | null
  disabled?: boolean
  newId: () => string
  /** Answer editor for a saved imported party (needs the API, so the page supplies it). */
  renderImportedAnswers?: (party: ImportedConfiguration) => ReactNode
}) {
  const models = catalog?.models ?? []
  const minParties = catalog?.limits.minConfigurations ?? LIMITS.minConfigurationsPerRun
  const maxParties = catalog?.limits.configurations ?? LIMITS.minConfigurationsPerRun
  const modelParties = draft.configurations.filter((c): c is ModelConfiguration => !isImported(c))
  const hasImported = modelParties.length < draft.configurations.length
  const sharedPrompt = modelParties[0]?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT

  const append = (party: Configuration, mode = draft.comparisonMode) => onChange({ ...draft, comparisonMode: mode, configurations: [...draft.configurations, party] })
  const addModelParty = () => {
    const template = modelParties.at(-1)
    const unused = models.find((m) => m.enabled && !modelParties.some((c) => c.modelKey === m.key))
    append({
      key: newId(),
      label: `Party ${draft.configurations.length + 1}`,
      modelKey: unused?.key ?? template?.modelKey ?? models.find((m) => m.enabled)?.key ?? '',
      systemPrompt: template?.systemPrompt ?? sharedPrompt,
      maxOutputTokens: LIMITS.maxOutputTokens,
    })
  }
  // An imported party only makes sense in a configuration comparison, so adding one switches the mode.
  const addImportedParty = () =>
    append({ kind: 'imported', key: newId(), label: `Party ${draft.configurations.length + 1}`, provenance: { sourceType: 'human_baseline', description: '', redacted: false } }, 'configuration')
  const removeParty = (index: number) => onChange({ ...draft, configurations: draft.configurations.filter((_, i) => i !== index) })
  const setMode = (mode: ComparisonMode) => {
    if (mode === 'model' && hasImported) return
    // Model comparison shares one instruction text across every model party.
    const configurations = mode === 'model' ? draft.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt: sharedPrompt })) : draft.configurations
    onChange({ ...draft, comparisonMode: mode, configurations })
  }
  const replaceParty = (index: number, party: Configuration) => onChange({ ...draft, configurations: draft.configurations.map((c, i) => (i === index ? party : c)) })
  const setSharedPrompt = (systemPrompt: string) => onChange({ ...draft, configurations: draft.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt })) })

  return (
    <fieldset disabled={disabled} className="space-y-6">
      <legend className="sr-only">Parties</legend>
      <div className="space-y-2">
        <Label id="mode-label">Comparison mode</Label>
        <RadioGroup aria-labelledby="mode-label" value={draft.comparisonMode} onValueChange={(value) => setMode(value as ComparisonMode)} className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['model', 'Model comparison', hasImported ? 'Not available with an imported party.' : 'Same instructions; only the model differs.'],
              ['configuration', 'Configuration comparison', 'Instructions may differ too, and imported answers are allowed. Not an isolated test of model quality.'],
            ] as const
          ).map(([value, title, description]) => (
            <Label
              key={value}
              htmlFor={`mode-${value}`}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 font-normal transition-colors duration-150',
                draft.comparisonMode === value ? 'border-foreground bg-slip' : 'border-paper-edge bg-white hover:bg-slip/60',
                value === 'model' && hasImported && 'cursor-not-allowed opacity-60',
              )}
            >
              <RadioGroupItem id={`mode-${value}`} value={value} className="mt-0.5" disabled={value === 'model' && hasImported} aria-labelledby={`mode-${value}-text`} />
              <span id={`mode-${value}-text`}>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      {draft.comparisonMode === 'model' && modelParties.length > 0 && (
        <TextField id="shared-system-prompt" label="System instructions (shared, sent to every party)" multiline rows={4} value={sharedPrompt} max={LIMITS.systemPrompt.max} error={errors['configurations.0.systemPrompt']} onChange={setSharedPrompt} />
      )}

      <div className={cn('grid gap-4 md:grid-cols-2', draft.configurations.length > 2 && 'xl:grid-cols-3')}>
        {draft.configurations.map((configuration, index) => (
          <Card key={configuration.key} className="rounded-[2px] bg-white ring-exhibit-edge">
            <CardHeader>
              <CardTitle className="court-label">
                Party <span className="typewriter font-normal tracking-normal">{index + 1}</span>
                {isImported(configuration) && <span className="typewriter ml-2 rounded-[3px] bg-sticker px-1.5 py-0.5 text-[0.625rem] font-bold tracking-normal text-sticker-foreground">IMPORTED</span>}
              </CardTitle>
              {draft.configurations.length > minParties && (
                <CardAction>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove party ${index + 1}`} onClick={() => removeParty(index)}>
                    <Trash2 aria-hidden />
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <TextField id={`cfg-${configuration.key}-label`} label="Name (sealed from jurors until you unseal)" value={configuration.label} max={LIMITS.configurationLabel.max} error={errors[`configurations.${index}.label`]} onChange={(label) => replaceParty(index, { ...configuration, label })} />
              {isImported(configuration) ? (
                <ImportedPartyFields party={configuration} index={index} errors={errors} onChange={(party) => replaceParty(index, party)} renderAnswers={renderImportedAnswers} />
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`cfg-${configuration.key}-model`}>Model</Label>
                    <Select value={configuration.modelKey} onValueChange={(value) => replaceParty(index, { ...configuration, modelKey: String(value) })} items={models.map((m) => ({ value: m.key, label: m.label }))}>
                      <SelectTrigger id={`cfg-${configuration.key}-model`} className="w-full">
                        <SelectValue placeholder="Choose a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((model) => (
                          <SelectItem key={model.key} value={model.key} disabled={!model.enabled}>
                            {model.label}
                            {!model.enabled && ' (not yet verified)'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Output limit: {LIMITS.maxOutputTokens} tokens. No tools, browsing, or streaming.</p>
                  </div>
                  {draft.comparisonMode === 'configuration' && (
                    <TextField
                      id={`cfg-${configuration.key}-prompt`}
                      label="System instructions (sent to this model)"
                      multiline
                      rows={5}
                      value={configuration.systemPrompt}
                      max={LIMITS.systemPrompt.max}
                      error={errors[`configurations.${index}.systemPrompt`]}
                      onChange={(systemPrompt) => replaceParty(index, { ...configuration, systemPrompt })}
                    />
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {maxParties > draft.configurations.length && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={addModelParty}>
            <Plus aria-hidden /> Add a model party ({draft.configurations.length}/{maxParties})
          </Button>
          <Button variant="outline" onClick={addImportedParty}>
            <Upload aria-hidden /> Add imported answers
          </Button>
          <span className="text-xs text-muted-foreground">A model party adds one paid call per question. Imported answers (a human baseline or exported transcripts) cost nothing.</span>
        </div>
      )}
    </fieldset>
  )
}

function ImportedPartyFields({ party, index, errors, onChange, renderAnswers }: { party: ImportedConfiguration; index: number; errors: FieldErrors; onChange: (next: ImportedConfiguration) => void; renderAnswers?: (party: ImportedConfiguration) => ReactNode }) {
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
      <TextField
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
        <Input id={`cfg-${party.key}-collected`} type="date" value={party.provenance.collectedOn ?? ''} onChange={(e) => set({ collectedOn: e.target.value || undefined })} aria-invalid={errors[`${base}.collectedOn`] ? true : undefined} />
      </div>
      <div className="flex items-start gap-3">
        <Checkbox id={`cfg-${party.key}-redacted`} checked={party.provenance.redacted} onCheckedChange={(checked) => set({ redacted: checked === true })} />
        <Label htmlFor={`cfg-${party.key}-redacted`} className="flex-col items-start gap-0.5 font-normal leading-snug">
          I removed names, emails, and other details that could reveal the source
          <span className="text-xs text-muted-foreground">The record says the answers were redacted.</span>
        </Label>
      </div>
      {renderAnswers?.(party)}
    </div>
  )
}
