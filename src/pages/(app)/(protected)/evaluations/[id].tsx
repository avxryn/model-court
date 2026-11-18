import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { Caption, CaseStage, DocketNumber, Sheet, Stamp } from '@/components/court/CaseFile'
import { CaseFolder, DividerTabs } from '@/components/court/Folder'
import { CaseActionBar } from '@/components/evaluations/CaseActionBar'
import { CaseActions } from '@/components/evaluations/CaseActions'
import { ConfigurationsEditor } from '@/components/evaluations/DraftEditor'
import { HearingList } from '@/components/evaluations/HearingList'
import { ImportedAnswers } from '@/components/evaluations/ImportedAnswers'
import { JurorCaseView } from '@/components/evaluations/JurorCaseView'
import { MissingKeys, SavedKeys } from '@/components/evaluations/KeyStatus'
import { QuestionsEditor } from '@/components/evaluations/QuestionsEditor'
import { RepeatsPicker } from '@/components/evaluations/RepeatsPicker'
import { RubricPicker } from '@/components/evaluations/RubricPicker'
import { StartHearingDialog } from '@/components/evaluations/StartHearingDialog'
import { useCaseDraft } from '@/components/evaluations/use-case-draft'
import { ErrorPanel } from '@/components/feedback/ErrorPanel'
import { PageSkeleton } from '@/components/feedback/PageSkeleton'
import { Breadcrumbs, Page } from '@/components/layout/Page'
import { useShellFocus } from '@/components/shell/ShellContext'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import type { DraftInput } from '@/domain/contracts'
import { plannedCalls } from '@/domain/quota'
import type { ModelRoute } from '@/domain/registry'
import { generatedParties, requiredProviders } from '@/domain/snapshot'
import { newIntentKey } from '@/lib/api-client'
import { caseBlockers } from '@/lib/case-blockers'
import { caseStep, docketNumber, recordStamp } from '@/lib/court'
import type { CatalogView, CredentialMetadata, EvaluationView, OwnerEvaluationView } from '@/lib/dto'
import { formatTime, plural } from '@/lib/format'
import { useDraftScenarioHash } from '@/lib/scenario-draft'
import { catalogModelName } from '@/lib/scenario-words'
import { isActive } from '@/lib/status'
import { useApi } from '@/lib/use-api'

export default function EvaluationPage() {
  const { id = '' } = useParams()
  const evaluation = useApi<EvaluationView>(`/evaluations/${id}`)
  if (evaluation.loading && !evaluation.data) return <Page width="wide"><PageSkeleton variant="sheet" label="Loading the case" /></Page>
  if (evaluation.error && !evaluation.data) return <Page><ErrorPanel error={evaluation.error} onRetry={evaluation.reload} /></Page>
  if (!evaluation.data) return null
  if (evaluation.data.role === 'reviewer') return <JurorCaseView evaluation={evaluation.data} />
  return <OwnerEvaluation key={evaluation.data.id} evaluation={evaluation.data as OwnerEvaluationView} reload={evaluation.reload} />
}

function OwnerEvaluation({ evaluation, reload }: { evaluation: OwnerEvaluationView; reload: () => Promise<void> }) {
  useShellFocus(evaluation.id)
  const catalog = useApi<CatalogView>('/catalog')
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const c = useCaseDraft(evaluation)
  const { draft } = c
  // With a hearing on file the folder opens on Hearings; a new case opens on its questions.
  const [tab, setTab] = useState<string>(evaluation.runs.length > 0 ? 'runs' : 'cases')

  const routes: ModelRoute[] | null = useMemo(() => (catalog.data ? catalog.data.models.map((m) => ({ ...m, adapterVersion: '' })) : null), [catalog.data])
  const workingScenario = useDraftScenarioHash(draft)
  // Where the working draft stands (D-68): computed here so it follows edits and saves without a reload.
  const workingVersion = evaluation.runs.find((run) => run.scenarioHash === workingScenario)?.scenarioVersion ?? null
  const draftStanding = { draftScenarioVersion: workingVersion, nextScenarioVersion: evaluation.nextScenarioVersion, draftDiff: workingScenario === evaluation.draftScenarioHash ? evaluation.draftDiff : null }
  const providers = requiredProviders(draft.configurations, routes ?? [])
  const keys = credentials.data?.items ?? []
  const missingProviders = providers.filter((provider) => !keys.some((key) => key.provider === provider))
  const activeRun = evaluation.runs.find((run) => isActive(run.status))
  const latestRun = [...evaluation.runs].sort((a, b) => b.createdAt - a.createdAt)[0]
  const stamp = recordStamp(latestRun?.status)
  const calls = plannedCalls(draft)
  // Repeats apply to generated parties only (D-65): drop the setting when none is left, so the draft stays valid.
  const change = (next: DraftInput) => {
    if (next.samplesPerAnswer && generatedParties(next.configurations).length === 0) {
      const { samplesPerAnswer: _dropped, ...rest } = next
      c.change(rest)
    } else c.change(next)
  }
  const setSamples = (samples: 1 | 2 | 3) => {
    const { samplesPerAnswer: _previous, ...rest } = draft
    c.change(samples === 1 ? rest : { ...rest, samplesPerAnswer: samples })
  }
  const blockers = caseBlockers({ draft, routes, imports: c.imports, dirty: c.dirty, hasErrors: c.hasErrors, missingProviders, hasActiveHearing: !!activeRun, generationDisabled: catalog.data ? !catalog.data.generationEnabled : false })

  return (
    <Page width="wide">
      <div className="flex items-start justify-between gap-3">
        <Breadcrumbs items={[{ label: 'Your cases', to: '/evaluations' }, { label: evaluation.title }]} />
        <CaseActions evaluationId={evaluation.id} title={evaluation.title} revision={c.revision} />
      </div>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="block">
        <CaseFolder
          docket={docketNumber(evaluation.id)}
          title={evaluation.title}
          dividers={
            <DividerTabs
              label="Case sections"
              items={[
                { value: 'cases', label: 'Questions', count: draft.cases.length },
                { value: 'configurations', label: 'Parties', count: draft.configurations.length },
                { value: 'runs', label: 'Hearings', count: evaluation.runs.length },
              ]}
            />
          }
        >
          <Sheet>
            <Caption
              title={evaluation.title}
              parties={draft.configurations.map((party) => party.label || 'Unnamed party')}
              details={
                <>
                  <div>
                    Case no. <DocketNumber>{docketNumber(evaluation.id)}</DocketNumber>
                  </div>
                  <CaseStage {...caseStep(latestRun?.status)} />
                  <div>
                    {plural(evaluation.runs.length, 'hearing')}
                    {latestRun && <> · latest {formatTime(latestRun.createdAt)}</>}
                  </div>
                  <div>
                    Presiding: <span className="italic">you, as judge</span>
                  </div>
                  {evaluation.taskDescription && <div className="text-xs leading-snug text-muted-foreground">{evaluation.taskDescription}</div>}
                </>
              }
              stamp={<Stamp kind={stamp ?? 'draft'} />}
            />
            <div className="border-t border-paper-rule px-5 pt-6 pb-10 sm:px-8">
              {c.saveState === 'conflict' && (
                <Alert variant="destructive" className="mb-6">
                  <AlertTriangle aria-hidden />
                  <AlertTitle>This draft changed in another tab</AlertTitle>
                  <AlertDescription>Your edits are still here but were not saved. Reloading the saved draft discards these edits.</AlertDescription>
                  <AlertAction>
                    <Button size="sm" variant="outline" onClick={() => void reload()}>
                      Reload the saved draft
                    </Button>
                  </AlertAction>
                </Alert>
              )}
              {activeRun && (
                <Alert className="mb-6">
                  <AlertTitle>A hearing is in progress</AlertTitle>
                  <AlertDescription>
                    Edits here only affect future hearings.{' '}
                    <Link className="underline" to={`/runs/${activeRun.id}`}>
                      Open the current hearing
                    </Link>
                    .
                  </AlertDescription>
                </Alert>
              )}
              <TabsContent value="cases">
                <RubricPicker value={draft.rubricVersion} onChange={(rubricVersion) => c.change({ ...draft, rubricVersion })} />
                <QuestionsEditor cases={draft.cases} errors={c.errors} newId={newIntentKey} onChange={(cases) => c.change({ ...draft, cases })} />
              </TabsContent>
              <TabsContent value="configurations">
                {credentials.data && <MissingKeys missing={missingProviders} />}
                <ConfigurationsEditor
                  draft={draft}
                  catalog={catalog.data}
                  errors={c.errors}
                  newId={newIntentKey}
                  onChange={change}
                  renderImportedAnswers={(party) => (
                    <ImportedAnswers
                      key={party.key}
                      evaluationId={evaluation.id}
                      party={party}
                      cases={draft.cases}
                      saved={!c.dirty}
                      existing={c.imports.filter((item) => item.configurationKey === party.key)}
                      revision={c.revision}
                      onSaved={(next, items) => c.importsSaved(party.key, next, items)}
                    />
                  )}
                />
                <RepeatsPicker draft={draft} max={catalog.data?.limits.samplesPerAnswer ?? 1} onChange={setSamples} />
                <SavedKeys providers={providers} keys={keys} />
              </TabsContent>
              <TabsContent value="runs">
                <HearingList runs={evaluation.runs} to={(run) => `/runs/${run.id}`} versions={{ rows: evaluation.runs, draft: draftStanding, modelName: catalogModelName(catalog.data?.models) }} />
              </TabsContent>
            </div>
            <CaseActionBar
              saveState={c.saveState}
              dirty={c.dirty}
              canSave={c.dirty && !c.hasErrors && c.saveState !== 'saving'}
              onSave={() => void c.save()}
              calls={calls}
              blockers={blockers}
              start={<StartHearingDialog evaluationId={evaluation.id} revision={c.revision} draft={draft} providers={providers} keys={keys} disabled={blockers.length > 0} />}
            />
          </Sheet>
        </CaseFolder>
      </Tabs>
    </Page>
  )
}
