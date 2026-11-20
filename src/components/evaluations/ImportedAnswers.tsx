/**
 * Answers for one imported party (D-38): one per question, saved together.
 * Shows owner-only blinding warnings; never edits the text itself.
 */

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { blindingWarnings } from '@/domain/blinding-lint'
import type { CaseInput, ImportedConfiguration } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { codePointLength } from '@/domain/text'
import { api, ApiClientError, describeError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface SavedImport {
  configurationKey: string
  caseKey: string
  text: string
}

export function ImportedAnswers({
  evaluationId,
  party,
  cases,
  saved,
  existing,
  revision,
  onSaved,
}: {
  evaluationId: string
  party: ImportedConfiguration
  cases: CaseInput[]
  /** False until this party is in the saved draft with no unsaved edits. */
  saved: boolean
  existing: SavedImport[]
  revision: number
  onSaved: (revision: number, imports: SavedImport[]) => void
}) {
  const initial = Object.fromEntries(existing.map((item) => [item.caseKey, item.text]))
  const [texts, setTexts] = useState<Record<string, string>>(initial)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const filled = cases.filter((testCase) => (texts[testCase.key] ?? '').trim() !== '')
  const savedCount = cases.filter((testCase) => existing.some((item) => item.caseKey === testCase.key)).length
  const dirty = cases.some((testCase) => (texts[testCase.key] ?? '') !== (initial[testCase.key] ?? ''))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const items = filled.map((testCase) => ({ caseKey: testCase.key, text: texts[testCase.key] }))
      const result = await api<{ revision: number }>('PUT', `/evaluations/${evaluationId}/imports/${party.key}`, { body: { items, confirmMayShareWithJurors: true }, revision })
      onSaved(
        result.revision,
        items.map((item) => ({ configurationKey: party.key, ...item })),
      )
      toast.success('Imported answers saved')
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((f) => f.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label={`Answers for ${party.label}`} className="space-y-4 border-t border-paper-rule pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="court-label">Imported answers</h4>
        <span className="text-caption text-muted-foreground tabular-nums">
          {savedCount} of {cases.length} saved
        </span>
      </div>
      {!saved ? (
        <p className="rounded-md bg-slip px-3 py-2 text-small text-muted-foreground">Save the draft to add answers for this party.</p>
      ) : (
        <>
          {cases.map((testCase, index) => {
            const value = texts[testCase.key] ?? ''
            const warnings = value.trim() ? blindingWarnings(value) : []
            const id = `import-${party.key}-${testCase.key}`
            return (
              <div key={testCase.key} className="space-y-1.5">
                <Label htmlFor={id} className="font-heading">
                  Q{index + 1}: {testCase.title}
                </Label>
                <Textarea id={id} rows={4} className="bg-exhibit font-heading" value={value} aria-describedby={`${id}-help`} onChange={(e) => setTexts((t) => ({ ...t, [testCase.key]: e.target.value }))} />
                <div id={`${id}-help`} className="space-y-0.5 text-caption">
                  <div className={cn('tabular-nums', codePointLength(value) > LIMITS.importedText.max ? 'text-destructive' : 'text-muted-foreground')}>
                    {codePointLength(value).toLocaleString()}/{LIMITS.importedText.max.toLocaleString()}
                  </div>
                  {warnings.map((warning) => (
                    <div key={warning.kind} className="flex items-start gap-1 text-warning">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3 shrink-0" />
                      {warning.message} Jurors may be able to tell this answer was not generated.
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="flex items-start gap-3 rounded-md bg-slip px-3 py-3">
            <Checkbox id={`import-${party.key}-consent`} checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} />
            <Label htmlFor={`import-${party.key}-consent`} className="flex-col items-start gap-0.5 font-normal leading-snug">
              I may share these answers with the jurors I invite
              <span className="text-caption text-muted-foreground">They are shown to jurors as written, and deleted with this case. They are never sent to an AI provider.</span>
            </Label>
          </div>
          {error && (
            <p role="alert" className="text-small text-destructive">
              {error}
            </p>
          )}
          <Button variant="outline" disabled={!consent || busy || filled.length === 0 || !dirty} onClick={() => void save()}>
            {busy ? 'Saving…' : `Save ${filled.length} answer${filled.length === 1 ? '' : 's'}`}
          </Button>
        </>
      )}
    </section>
  )
}
