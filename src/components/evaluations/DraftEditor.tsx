/**
 * CaseEditor and ConfigurationEditor: controlled, field-level validation from
 * the shared draft schema (E02). Server validation remains authoritative.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { CaseImport } from '@/components/evaluations/CaseImport'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { CaseInput, ComparisonMode, Configuration, DraftInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
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

export function ConfigurationsEditor({ draft, onChange, errors, catalog, disabled, newId }: { draft: DraftInput; onChange: (next: DraftInput) => void; errors: FieldErrors; catalog: CatalogView | null; disabled?: boolean; newId: () => string }) {
  const models = catalog?.models ?? []
  const minParties = catalog?.limits.minConfigurations ?? LIMITS.minConfigurationsPerRun
  const maxParties = catalog?.limits.configurations ?? LIMITS.minConfigurationsPerRun
  const addParty = () => {
    const last = draft.configurations[draft.configurations.length - 1]
    const unused = models.find((m) => m.enabled && !draft.configurations.some((c) => c.modelKey === m.key))
    onChange({
      ...draft,
      configurations: [...draft.configurations, { ...last, key: newId(), label: `Party ${draft.configurations.length + 1}`, modelKey: unused?.key ?? last.modelKey }],
    })
  }
  const removeParty = (index: number) => onChange({ ...draft, configurations: draft.configurations.filter((_, i) => i !== index) })
  const setMode = (mode: ComparisonMode) => {
    // Model comparison shares one instruction text across both candidates.
    const configurations = mode === 'model' ? draft.configurations.map((c) => ({ ...c, systemPrompt: draft.configurations[0].systemPrompt })) : draft.configurations
    onChange({ ...draft, comparisonMode: mode, configurations })
  }
  const updateConfig = (index: number, patch: Partial<Configuration>) =>
    onChange({ ...draft, configurations: draft.configurations.map((c, i) => (i === index ? { ...c, ...patch } : c)) })
  const setSharedPrompt = (systemPrompt: string) => onChange({ ...draft, configurations: draft.configurations.map((c) => ({ ...c, systemPrompt })) })

  return (
    <fieldset disabled={disabled} className="space-y-6">
      <legend className="sr-only">Parties</legend>
      <div className="space-y-2">
        <Label id="mode-label">Comparison mode</Label>
        <RadioGroup aria-labelledby="mode-label" value={draft.comparisonMode} onValueChange={(value) => setMode(value as ComparisonMode)} className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ['model', 'Model comparison', 'Same instructions; only the model differs.'],
              ['configuration', 'Configuration comparison', 'Instructions may differ too. Not an isolated test of model quality.'],
            ] as const
          ).map(([value, title, description]) => (
            <Label key={value} htmlFor={`mode-${value}`} className={cn('flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-3 font-normal transition-colors duration-150', draft.comparisonMode === value ? 'border-foreground bg-slip' : 'border-paper-edge bg-white hover:bg-slip/60')}>
              <RadioGroupItem id={`mode-${value}`} value={value} className="mt-0.5" aria-labelledby={`mode-${value}-text`} />
              <span id={`mode-${value}-text`}>
                <span className="block text-sm font-medium">{title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>

      {draft.comparisonMode === 'model' && (
        <TextField
          id="shared-system-prompt"
          label="System instructions (shared, sent to every party)"
          multiline
          rows={4}
          value={draft.configurations[0].systemPrompt}
          max={LIMITS.systemPrompt.max}
          error={errors['configurations.0.systemPrompt']}
          onChange={setSharedPrompt}
        />
      )}

      <div className={cn('grid gap-4 md:grid-cols-2', draft.configurations.length > 2 && 'xl:grid-cols-3')}>
        {draft.configurations.map((configuration, index) => (
          <Card key={configuration.key} className="rounded-[2px] bg-white ring-exhibit-edge">
            <CardHeader>
              <CardTitle className="court-label">
                Party <span className="typewriter font-normal tracking-normal">{index + 1}</span>
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
              <TextField id={`cfg-${configuration.key}-label`} label="Name (sealed from jurors until you unseal)" value={configuration.label} max={LIMITS.configurationLabel.max} error={errors[`configurations.${index}.label`]} onChange={(label) => updateConfig(index, { label })} />
              <div className="space-y-1.5">
                <Label htmlFor={`cfg-${configuration.key}-model`}>Model</Label>
                <Select value={configuration.modelKey} onValueChange={(value) => updateConfig(index, { modelKey: String(value) })} items={models.map((m) => ({ value: m.key, label: m.label }))}>
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
                  onChange={(systemPrompt) => updateConfig(index, { systemPrompt })}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {maxParties > draft.configurations.length && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={addParty}>
            <Plus aria-hidden /> Add a party ({draft.configurations.length}/{maxParties})
          </Button>
          <span className="text-xs text-muted-foreground">
            Each party adds one paid call per question.{draft.comparisonMode === 'model' && ' In a model comparison, every party needs a different model.'}
          </span>
        </div>
      )}
    </fieldset>
  )
}
