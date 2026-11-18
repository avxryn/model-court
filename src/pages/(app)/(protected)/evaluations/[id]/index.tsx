import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Columns2, Repeat } from 'lucide-react'
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
import { RehearDialog } from '@/components/evaluations/RehearDialog'
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
import { useDraftPartyFingerprints, useDraftScenarioHash } from '@/lib/scenario-draft'
import { catalogModelName, hearingNumbers } from '@/lib/scenario-words'
import { isActive } from '@/lib/status'
import { useApi } from '@/lib/use-api'

export default function EvaluationPage() {
  const { id = '' } = useParams()
  const evaluation = useApi<EvaluationView>(`/evaluations/${id}`)
  if (evaluation.loading && !evaluation.data) return <Page width="wide"><PageSkeleton variant="sheet" label="Loading the case" /></Page>
  if (evaluation.error && !evaluation.data) return <Page><ErrorPanel error={evaluation.error} onRetry={evaluation.reload} /></Page>
  if (!evaluation.data) return null
  if (evaluation.data.role === 'reviewer') return <JurorCaseView evaluation={evaluation.data} />
  return <OwnerEvaluation key={`${evaluation.data.id}:${(evaluation.data as OwnerEvaluationView).revision}`} evaluation={evaluation.data as OwnerEvaluationView} reload={evaluation.reload} />
}

function OwnerEvaluation({ evaluation, reload }: { evaluation: OwnerEvaluationView; reload: () => Promise<void> }) {
  useShellFocus(evaluation.id)
  const catalog = useApi<CatalogView>('/catalog')
  const credentials = useApi<{ items: CredentialMetadata[] }>('/credentials')
  const c = useCaseDraft(evaluation)
  const { draft } = c
  const [params, setParams] = useSearchParams()
  // With a hearing on file the folder opens on Hearings; a new case opens on its questions. A re-hearing opens on its parties.
  const [tab, setTab] = useState<string>(params.get('rehearing') ? 'configurations' : evaluation.runs.length > 0 ? 'runs' : 'cases')
  // Re-hear (D-69): ?rehear=<runId> opens the dialog; ?rehearing=<runId> keeps the banner once restored.
  const rehearable = (id: string | null) => evaluation.runs.find((run) => run.id === id && (run.status === 'revealed' || run.status === 'decided' || run.status === 'canceled')) ?? null
  const rehearSource = rehearable(params.get('rehear'))
  const rehearing = rehearable(params.get('rehearing'))
  const routes: ModelRoute[] | null = useMemo(() => (catalog.data ? catalog.data.models.map((m) => ({ ...m, adapterVersion: '' })) : null), [catalog.data])
  const workingScenario = useDraftScenarioHash(draft)
  // Where the working draft stands (D-68): computed here so it follows edits and saves without a reload.
  const workingVersion = evaluation.runs.find((run) => run.scenarioHash === workingScenario)?.scenarioVersion ?? null
  const draftStanding = { draftScenarioVersion: workingVersion, nextScenarioVersion: evaluation.nextScenarioVersion, draftDiff: workingScenario === evaluation.draftScenarioHash ? evaluation.draftDiff : null }
  const sameRuns = workingVersion === null ? [] : evaluation.runs.filter((run) => run.scenarioVersion === workingVersion)
  // Parties already heard (D-69): the hearing being re-heard, else the newest unsealed hearing on these questions.
  const heardIn = (rehearing && rehearing.scenarioVersion === workingVersion && rehearing.parties ? rehearing : null) ?? [...sameRuns].sort((a, b) => b.createdAt - a.createdAt).find((run) => run.parties) ?? null
  const fingerprints = useDraftPartyFingerprints(draft, routes, c.imports)
  const heardFingerprints = new Set(heardIn?.parties?.map((party) => party.fingerprint) ?? [])
  const seenImported = new Set(evaluation.runs.flatMap((run) => (run.parties ?? []).filter((party) => party.source === 'imported').map((party) => party.fingerprint)))
  const repeatedImported = draft.configurations.filter((party) => party.kind === 'imported' && seenImported.has(fingerprints?.get(party.key) ?? '')).map((party) => party.label)
  const setParam = (name: 'rehear' | 'rehearing', value: string | null) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('rehear')
        if (name === 'rehearing') next.delete('rehearing')
        if (value) next.set(name, value)
        return next
      },
      { replace: true },
    )
  }

  const providers = requiredProviders(draft.configurations, routes ?? [])
  const keys = credentials.data?.items ?? []
  const missingProviders = providers.filter((provider) => !keys.some((key) => key.provider === provider))
  const activeRun = evaluation.runs.find((run) => isActive(run.status))
  const latestRun = [...evaluation.runs].sort((a, b) => b.createdAt - a.createdAt)[0]
  const stamp = recordStamp(latestRun?.status)
  const calls = plannedCalls(draft)
  // The Start dialog says which questions this is and splits the calls into parties asked again and new ones (D-69).
  const perParty = draft.cases.length * (draft.samplesPerAnswer ?? 1)
  const modelParties = generatedParties(draft.configurations)
  const askedAgain = heardIn && fingerprints ? modelParties.filter((party) => heardFingerprints.has(fingerprints.get(party.key) ?? '')) : []
  const newParties = modelParties.filter((party) => !askedAgain.includes(party))
  const hearingScenario = {
    hash: workingScenario,
    sameAs: workingVersion === null ? null : `${hearingNumbers(sameRuns.map((run) => run.number))} (v${workingVersion})`,
    nextVersion: evaluation.nextScenarioVersion,
    split: heardIn && askedAgain.length > 0 ? { heardIn: heardIn.number, again: askedAgain.length * perParty, fresh: newParties.length * perParty, freshLabels: newParties.map((party) => party.label) } : null,
  }
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
                {rehearing && <RehearBanner source={rehearing} runs={evaluation.runs} matches={workingScenario === null || workingScenario === rehearing.scenarioHash} onClose={() => setParam('rehearing', null)} />}
                {credentials.data && <MissingKeys missing={missingProviders} />}
                {repeatedImported.length > 0 && (
                  <Alert className="mb-6">
                    <AlertTriangle aria-hidden />
                    <AlertTitle>Jurors of earlier hearings have seen these exact answers</AlertTitle>
                    <AlertDescription>{repeatedImported.join(', ')} {repeatedImported.length === 1 ? 'uses' : 'use'} the same imported answers as an earlier hearing. A juror who sat on it, and saw its record unsealed, can recognize them. Their findings on {repeatedImported.length === 1 ? 'this party' : 'these parties'} may not be blind.</AlertDescription>
                  </Alert>
                )}
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
                {evaluation.runs.filter((run) => run.status === 'revealed' || run.status === 'decided').length >= 2 && (
                  <div className="mb-4 flex justify-end">
                    <Button size="sm" variant="outline" render={<Link to={`/evaluations/${evaluation.id}/compare`} />} nativeButton={false}>
                      <Columns2 aria-hidden /> Compare hearings
                    </Button>
                  </div>
                )}
                <HearingList runs={evaluation.runs} to={(run) => `/runs/${run.id}`} versions={{
                    rows: evaluation.runs,
                    draft: draftStanding,
                    modelName: catalogModelName(catalog.data?.models),
                    actions: (row) =>
                      rehearable(row.id) && (
                        <Button size="sm" variant="outline" onClick={() => setParam('rehear', row.id)}>
                          <Repeat aria-hidden /> Re-hear with different parties
                        </Button>
                      ),
                  }}
                />
              </TabsContent>
            </div>
            <CaseActionBar
              saveState={c.saveState}
              dirty={c.dirty}
              canSave={c.dirty && !c.hasErrors && c.saveState !== 'saving'}
              onSave={() => void c.save()}
              calls={calls}
              blockers={blockers}
              start={<StartHearingDialog evaluationId={evaluation.id} revision={c.revision} draft={draft} providers={providers} keys={keys} disabled={blockers.length > 0} scenario={hearingScenario} />}
            />
          </Sheet>
        </CaseFolder>
      </Tabs>
      {rehearSource && (
        <RehearDialog
          open
          onOpenChange={(open) => {
            if (!open) setParam('rehear', null)
          }}
          evaluationId={evaluation.id}
          revision={c.revision}
          source={rehearSource}
          draftScenarioHash={evaluation.draftScenarioHash}
          dirty={c.dirty}
          onRestored={async () => {
            setParam('rehearing', rehearSource.id)
            setTab('configurations')
            await reload()
          }}
        />
      )}
    </Page>
  )
}

/** Shown on the Parties tab after a restore: the questions are the earlier hearing's, until they are edited. */
function RehearBanner({ source, runs, matches, onClose }: { source: OwnerEvaluationView['runs'][number]; runs: OwnerEvaluationView['runs']; matches: boolean; onClose: () => void }) {
  const same = hearingNumbers(runs.filter((run) => run.scenarioHash === source.scenarioHash).map((run) => run.number))
  return (
    <Alert variant={matches ? 'default' : 'destructive'} className="mb-6">
      {matches ? <Repeat aria-hidden /> : <AlertTriangle aria-hidden />}
      <AlertTitle>{matches ? `Re-hearing v${source.scenarioVersion}` : `These questions no longer match v${source.scenarioVersion}`}</AlertTitle>
      <AlertDescription>
        {matches
          ? `Questions are hearing ${source.number}’s; change only the parties, then start. The new hearing can be compared with ${same}.`
          : `Hearings on them cannot be compared with ${same}. Undo the question edits to keep them comparable.`}
      </AlertDescription>
      <AlertAction>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  )
}
