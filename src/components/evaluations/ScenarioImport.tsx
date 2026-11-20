/**
 * Open a new case from a scenario file or a certified record (spec 02 §3.4, D-71). The file is
 * read in this browser only (`parseScenarioFile`), shown in full, and created in one request,
 * which the server validates again. A file from someone else is data: nothing in it is trusted.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import type { Configuration } from '@/domain/contracts'
import { defaultModelKeys, makeExampleDraft } from '@/domain/example'
import type { ModelRoute } from '@/domain/registry'
import { parseScenarioFile, type ParsedScenario } from '@/domain/scenario-file'
import { LIMITS } from '@/domain/limits'
import { rubricName } from '@/components/record/RecordGate'
import { api, ApiClientError, describeError, newIntentKey } from '@/lib/api-client'
import type { CatalogView } from '@/lib/dto'
import { plural } from '@/lib/format'
import { useApi } from '@/lib/use-api'

export function ScenarioImport({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const navigate = useNavigate()
  const catalog = useApi<CatalogView>('/catalog')
  const [text, setText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [includeParties, setIncludeParties] = useState(true)
  const [parsed, setParsed] = useState<ParsedScenario | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = async (content: string, parties: boolean) => {
    if (!catalog.data) return
    const routes = catalog.data.models.map((model) => ({ ...model })) as ModelRoute[]
    const defaults = makeExampleDraft(newIntentKey, defaultModelKeys(routes)).configurations as Configuration[]
    setParsed(await parseScenarioFile(content, newIntentKey, { routes, defaults, maxParties: catalog.data.limits.configurations, includeParties: parties }))
  }

  const choose = async (file: File | undefined) => {
    setError(null)
    setParsed(null)
    if (!file) return
    if (file.size > LIMITS.scenarioFileBytes) {
      setError(`The file is larger than ${LIMITS.scenarioFileBytes / 1024} KiB.`)
      return
    }
    const content = await file.text()
    setFileName(file.name)
    setText(content)
    await parse(content, includeParties)
  }

  const create = async () => {
    if (!parsed?.ok) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ id: string }>('POST', '/evaluations', { body: { title: parsed.title, taskDescription: parsed.taskDescription, draft: parsed.draft, origin: { kind: parsed.origin } } })
      onCreated()
      navigate(`/evaluations/${result.id}`)
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  const ok = parsed?.ok ? parsed : null
  return (
    <div className="space-y-4">
      <Field className="gap-1.5">
        <FieldLabel htmlFor="scenario-file">Scenario file or certified record (JSON)</FieldLabel>
        <Input id="scenario-file" type="file" accept="application/json,.json" disabled={!catalog.data} onChange={(event) => void choose(event.target.files?.[0])} />
        <p className="text-caption text-muted-foreground">Read in this browser only. Nothing is sent until you open the case.</p>
      </Field>
      {parsed && !parsed.ok && (
        <div role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-small text-destructive">
          <p className="font-medium">{fileName} cannot be opened as a case.</p>
          <ul className="mt-1 list-disc pl-5">
            {parsed.issues.slice(0, 6).map((issue, index) => (
              <li key={index}>
                {issue.path && <span className="font-mono text-caption">{issue.path}: </span>}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {ok && (
        <div className="space-y-3 rounded-md bg-slip p-4 text-small">
          <p className="font-medium">
            “{ok.title}”: {plural(ok.draft.cases.length, 'question')}, rubric {rubricName(ok.draft.rubricVersion ?? 'reference-qa-v1')}, {plural(ok.draft.configurations.length, 'party', 'parties')}
            {ok.partiesFromFile === 0 && ' (the default pair)'}.
          </p>
          {ok.origin === 'certified_record' && (
            <p className="text-muted-foreground">
              {ok.certification === 'matches' ? 'The record matches its certification.' : ok.certification === 'edited' ? 'The record was edited since it was exported (it no longer matches its certification).' : 'The record has no certification.'} That says nothing about whether to trust its content.
            </p>
          )}
          <Field orientation="horizontal" className="items-start">
            <Checkbox
              id="import-parties"
              checked={includeParties}
              onCheckedChange={(c) => {
                setIncludeParties(c === true)
                if (text) void parse(text, c === true)
              }}
            />
            <FieldLabel htmlFor="import-parties" className="font-normal">
              Take the parties from the file when it has any (models from this catalog only)
            </FieldLabel>
          </Field>
          {ok.notices.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground marker:text-mark">
              {ok.notices.map((notice) => (
                <li key={notice}>{notice}</li>
              ))}
            </ul>
          )}
          {ok.partiesFromFile > 0 && (
            <div className="space-y-2">
              <p className="text-muted-foreground">These system instructions will be sent to the providers at your first hearing. Read them first:</p>
              {ok.draft.configurations.map((party) =>
                'systemPrompt' in party ? (
                  <figure key={party.key} className="rounded-md border border-border bg-background p-3">
                    <figcaption className="text-caption font-medium">{party.label}</figcaption>
                    <p className="mt-1 max-h-40 overflow-y-auto text-small whitespace-pre-wrap">{party.systemPrompt}</p>
                  </figure>
                ) : null,
              )}
            </div>
          )}
          <p className="text-muted-foreground">Exhibits and questions will also be sent to the providers at each hearing. You can read and edit them all before the first one.</p>
        </div>
      )}
      {error && <FieldError>{error}</FieldError>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Back to templates
        </Button>
        <Button type="button" disabled={!ok || busy} onClick={() => void create()}>
          {busy ? 'Opening…' : 'Open as a new case'}
        </Button>
      </div>
    </div>
  )
}
