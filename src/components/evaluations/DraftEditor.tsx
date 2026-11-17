/**
 * The case's parties (E02): comparison mode, shared or per-party system
 * instructions, model parties and imported parties. Controlled, with
 * field-level validation from the shared draft schema; server validation
 * remains authoritative. Questions live in QuestionsEditor.
 */

import type { ReactNode } from 'react'
import { Plus, Trash2, Upload } from 'lucide-react'
import { ExhibitSticker } from '@/components/court/CaseFile'
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { CountedField } from '@/components/evaluations/CountedField'
import { ImportedPartyFields } from '@/components/evaluations/ImportedPartyFields'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { isImported, type ComparisonMode, type Configuration, type DraftInput, type ImportedConfiguration, type ModelConfiguration } from '@/domain/contracts'
import { DEFAULT_SYSTEM_PROMPT } from '@/domain/example'
import { LIMITS } from '@/domain/limits'
import type { CatalogView } from '@/lib/dto'
import { cn } from '@/lib/utils'

export type FieldErrors = Record<string, string>

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
        <ChoiceCardGroup aria-labelledby="mode-label" value={draft.comparisonMode} onValueChange={(value) => setMode(value as ComparisonMode)} className="sm:grid-cols-2">
          <ChoiceCard id="mode-model" value="model" disabled={hasImported} title="Model comparison" description={hasImported ? 'Not available with an imported party.' : 'Same instructions; only the model differs.'} />
          <ChoiceCard id="mode-configuration" value="configuration" title="Configuration comparison" description="Instructions may differ too, and imported answers are allowed. Not an isolated test of model quality." />
        </ChoiceCardGroup>
      </div>

      {draft.comparisonMode === 'model' && modelParties.length > 0 && (
        <CountedField id="shared-system-prompt" label="System instructions (shared, sent to every party)" multiline rows={4} value={sharedPrompt} max={LIMITS.systemPrompt.max} error={errors['configurations.0.systemPrompt']} onChange={setSharedPrompt} />
      )}

      <div className={cn('grid items-start gap-4 md:grid-cols-2', draft.configurations.length > 2 && 'xl:grid-cols-3')}>
        {draft.configurations.map((configuration, index) => (
          <Card key={configuration.key} className="rounded-[2px] bg-exhibit ring-exhibit-edge">
            <CardHeader>
              <CardTitle className="court-label">
                Party <span className="typewriter font-normal tracking-normal">{index + 1}</span>
                {isImported(configuration) && <ExhibitSticker className="ml-2 px-1.5 py-0 text-[0.6875rem]">IMPORTED</ExhibitSticker>}
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
              <CountedField id={`cfg-${configuration.key}-label`} label="Name (sealed from jurors until you unseal)" value={configuration.label} max={LIMITS.configurationLabel.max} error={errors[`configurations.${index}.label`]} onChange={(label) => replaceParty(index, { ...configuration, label })} />
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
                    <CountedField
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
