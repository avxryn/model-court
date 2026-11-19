/**
 * One extraction question's document and answer key (spec 04 §3.1, D-88). The document is saved
 * on its own (it lives beside the draft, not in it), so the editor needs the case, its revision
 * and a way to adopt the revision and draft the upload returns; the case page provides them.
 * The answer key is judge-only: never sent to a provider, hidden from jurors until unsealing.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import type { CaseInput, DraftInput } from '@/domain/contracts'
import { isOptional, type ExtractionSchema, type SchemaNode } from '@/domain/extraction/schema'
import { validateAgainstSchema } from '@/domain/extraction/validate'
import type { ExtractionFields, ExtractionSettings } from '@/domain/kits/extraction'
import { LIMITS } from '@/domain/limits'
import { utf8ByteLength } from '@/domain/text'
import { api, ApiClientError, describeError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

export interface DraftDocument {
  caseKey: string
  kind: 'text' | 'pdf'
  delivery: 'text' | 'pdf_native'
  sha256: string
  byteLength: number
  pageCount: number | null
  available: boolean
}

export interface ExtractionDocumentsValue {
  evaluationId: string
  revision: number
  /** False while the draft has unsaved edits: a document can be saved only on a saved question. */
  saved: boolean
  documents: readonly DraftDocument[]
  onSaved: (revision: number, draft: DraftInput, documents: DraftDocument[]) => void
}

const DocumentsContext = createContext<ExtractionDocumentsValue | null>(null)

export function ExtractionDocumentsProvider({ value, children }: { value: ExtractionDocumentsValue; children: ReactNode }) {
  return <DocumentsContext.Provider value={value}>{children}</DocumentsContext.Provider>
}

/** A key with every field: null for May-be-empty ones, a typed blank for the rest. */
export function answerKeySkeleton(schema: ExtractionSchema): Record<string, unknown> {
  const blank = (node: SchemaNode): unknown => {
    if (node.type === 'object') return Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, isOptional(node, name) ? null : blank(child)]))
    if (node.type === 'array') return []
    if (node.type === 'string') return node.enum ? node.enum[0] : ''
    if (node.type === 'boolean') return false
    return 0
  }
  return blank(schema) as Record<string, unknown>
}

function DocumentEditor({ testCase }: { testCase: CaseInput }) {
  const context = useContext(DocumentsContext)
  const saved = context?.documents.find((document) => document.caseKey === testCase.key)
  const ref = (testCase.kitFields as ExtractionFields | undefined)?.document
  const [text, setText] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = `case-${testCase.key}-document`

  const evaluationId = context?.evaluationId
  const hasSaved = !!saved
  useEffect(() => {
    if (!evaluationId || !hasSaved || loaded) return
    let live = true
    api<{ kind: 'text'; text: string }>('GET', `/evaluations/${evaluationId}/documents/${testCase.key}`)
      .then((document) => live && setText((current) => current ?? document.text))
      .catch((caught: unknown) => live && setError(describeError(caught)))
      .finally(() => live && setLoaded(true))
    return () => {
      live = false
    }
  }, [evaluationId, hasSaved, loaded, testCase.key])

  const bytes = utf8ByteLength(text ?? '')
  const save = async () => {
    if (!context || text === null) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ revision: number; draft: DraftInput; document: Omit<DraftDocument, 'caseKey' | 'available'> }>('PUT', `/evaluations/${context.evaluationId}/documents/${testCase.key}`, { body: { kind: 'text', text }, revision: context.revision })
      context.onSaved(result.revision, result.draft, [...context.documents.filter((document) => document.caseKey !== testCase.key), { caseKey: testCase.key, available: true, ...result.document }])
      toast.success('Document saved')
    } catch (caught) {
      setError(caught instanceof ApiClientError && caught.fields.length ? caught.fields.map((field) => field.message).join(' ') : describeError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Field className="gap-1.5 md:col-span-2">
      <FieldLabel htmlFor={id}>
        Document <Plain>the source to pull fields from; sent to the models</Plain>
      </FieldLabel>
      {!context?.saved && !saved ? (
        <p className="rounded-md bg-slip px-3 py-2 text-sm text-muted-foreground">Save the draft, then paste this question’s document.</p>
      ) : (
        <>
          <Textarea id={id} rows={8} value={text ?? ''} placeholder={saved && !loaded ? 'Loading…' : 'Paste the document text here.'} aria-describedby={`${id}-help`} aria-invalid={error || bytes > LIMITS.extraction.textDocumentBytes ? true : undefined} onChange={(event) => setText(event.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy || !text?.trim() || bytes > LIMITS.extraction.textDocumentBytes || !context?.saved} onClick={() => void save()}>
              {saved ? 'Replace document' : 'Save document'}
            </Button>
            <FieldDescription id={`${id}-help`} className={cn('text-xs tabular-nums', (error || bytes > LIMITS.extraction.textDocumentBytes) && 'text-destructive')}>
              {error ?? (ref ? `Saved · ${ref.byteLength.toLocaleString('en-US')} bytes. ` : 'Not saved yet. ') + `Up to ${LIMITS.extraction.textDocumentBytes / 1024} KiB of text.`}
            </FieldDescription>
          </div>
        </>
      )}
    </Field>
  )
}

function AnswerKeyEditor({ settings, testCase, index, errors, onChange }: { settings: ExtractionSettings; testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void }) {
  const fields = (testCase.kitFields as ExtractionFields | undefined) ?? { kind: 'extraction' as const }
  const [text, setText] = useState(() => (fields.answerKey ? JSON.stringify(fields.answerKey, null, 2) : ''))
  const [parseError, setParseError] = useState<string | null>(null)
  const id = `case-${testCase.key}-answer-key`
  const local = useMemo(() => (fields.answerKey ? validateAgainstSchema(settings.schema, fields.answerKey, 'answerKey') : []), [fields.answerKey, settings.schema])
  const serverError = Object.entries(errors).find(([path]) => path.startsWith(`cases.${index}.kitFields.answerKey`))?.[1]
  const set = (answerKey: Record<string, unknown> | undefined) => {
    const { answerKey: _old, ...rest } = fields
    onChange({ kitFields: answerKey ? { ...rest, answerKey } : rest })
  }
  return (
    <Field className="gap-1.5 md:col-span-2">
      <FieldLabel htmlFor={id}>
        Answer key (optional) <Plain>never sent to the models; jurors see it only after unsealing</Plain>
      </FieldLabel>
      <Textarea
        id={id}
        rows={6}
        className="typewriter text-xs"
        spellCheck={false}
        value={text}
        placeholder='{"fullName": "Dana Whitfield", "phone": null}'
        aria-invalid={parseError || local.length > 0 || serverError ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          setText(event.target.value)
          if (event.target.value.trim() === '') {
            setParseError(null)
            return set(undefined)
          }
          try {
            const value = JSON.parse(event.target.value) as unknown
            if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object')
            setParseError(null)
            set(value as Record<string, unknown>)
          } catch {
            setParseError("This isn't a JSON object yet.")
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            const skeleton = answerKeySkeleton(settings.schema)
            setText(JSON.stringify(skeleton, null, 2))
            setParseError(null)
            set(skeleton)
          }}
        >
          Start from the field list
        </Button>
        <FieldDescription id={`${id}-help`} className={cn('text-xs', (parseError || local.length > 0 || serverError) && 'text-destructive')}>
          {parseError ?? (local[0] ? `${local[0].path || '(the key)'}: ${local[0].problem}` : serverError) ?? 'Write null for a field the document doesn’t have, so invented values can be counted; leave a field out to not compare it.'}
        </FieldDescription>
      </div>
    </Field>
  )
}

export function ExtractionQuestionFields({ settings, testCase, index, errors, onChange }: { settings: ExtractionSettings; testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void }) {
  return (
    <>
      <DocumentEditor testCase={testCase} />
      <AnswerKeyEditor settings={settings} testCase={testCase} index={index} errors={errors} onChange={onChange} />
    </>
  )
}
