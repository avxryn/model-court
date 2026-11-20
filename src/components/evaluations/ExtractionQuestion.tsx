/**
 * One extraction question's document and answer key (spec 04 §3.1, D-88). The document is saved
 * on its own (it lives beside the draft, not in it), so the editor needs the case, its revision
 * and a way to adopt the revision and draft the upload returns; the case page provides them.
 * The answer key is judge-only: never sent to a provider, hidden from jurors until unsealing.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Upload } from 'lucide-react'
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
import { ChoiceCard, ChoiceCardGroup } from '@/components/court/ChoiceCard'
import { api, ApiClientError, apiUploadPdf, describeError } from '@/lib/api-client'
import { formatSize } from '@/lib/format'
import type { PdfFacts } from '@/lib/pdf'
import { cn } from '@/lib/utils'

export const NO_TEXT_LAYER = 'This PDF has no text layer (probably a scan). Send the file instead, or the parties will get almost nothing.'

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
  // A saved PDF has no text to load into the box; its bytes stay on the server.
  const hasSaved = saved?.kind === 'text'
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
  const [pdf, setPdf] = useState<{ bytes: ArrayBuffer; facts: PdfFacts } | null>(null)
  const [delivery, setDelivery] = useState<'pdf_native' | 'text'>('pdf_native')
  const [pdfName, setPdfName] = useState<string | null>(null)
  const pdfInput = useRef<HTMLInputElement>(null)

  // Spec 04 §3.3 (D-90): the browser reads the PDF (pages, that it opens, its text layer); nothing is uploaded yet.
  const choosePdf = async (file: File | undefined) => {
    setError(null)
    setPdf(null)
    if (!file) return
    if (file.size > LIMITS.extraction.pdfBytes) return setError(`A PDF is at most ${formatSize(LIMITS.extraction.pdfBytes)}.`)
    try {
      const data = await file.arrayBuffer()
      const { readPdf } = await import('@/lib/pdf')
      const facts = await readPdf(data)
      if (facts.pageCount > LIMITS.extraction.pdfPages) return setError(`This PDF has ${facts.pageCount} pages; at most ${LIMITS.extraction.pdfPages}.`)
      setPdf({ bytes: data, facts })
      setDelivery('pdf_native')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This file couldn't be opened as a PDF.")
    }
  }

  const savePdf = async () => {
    if (!context || !pdf) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiUploadPdf<{ revision: number; draft: DraftInput; document: Omit<DraftDocument, 'caseKey' | 'available'> }>(`/evaluations/${context.evaluationId}/documents/${testCase.key}`, pdf.bytes, pdf.facts.pageCount, context.revision)
      context.onSaved(result.revision, result.draft, [...context.documents.filter((document) => document.caseKey !== testCase.key), { caseKey: testCase.key, available: true, ...result.document }])
      toast.success('PDF saved')
    } catch (caught) {
      setError(describeError(caught))
    } finally {
      setBusy(false)
    }
  }
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
        <p className="rounded-md bg-slip px-3 py-2 text-small text-muted-foreground">Save the draft, then paste this question’s document.</p>
      ) : (
        <>
          <Textarea id={id} rows={8} value={text ?? ''} placeholder={saved && !loaded ? 'Loading…' : 'Paste the document text here.'} aria-describedby={`${id}-help`} aria-invalid={error || bytes > LIMITS.extraction.textDocumentBytes ? true : undefined} onChange={(event) => setText(event.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="outline" disabled={busy || !text?.trim() || bytes > LIMITS.extraction.textDocumentBytes || !context?.saved || (pdf !== null && delivery === 'pdf_native')} onClick={() => void save()}>
              {saved ? 'Replace with this text' : 'Save document'}
            </Button>
            <FieldDescription id={`${id}-help`} className={cn('text-caption tabular-nums', (error || bytes > LIMITS.extraction.textDocumentBytes) && 'text-destructive')}>
              {error ??
                (ref ? (ref.delivery === 'pdf_native' ? `Saved: a PDF of ${ref.pageCount ?? '?'} ${ref.pageCount === 1 ? 'page' : 'pages'}, sent as the file. ` : `Saved · ${formatSize(ref.byteLength)} of text. `) : 'Not saved yet. ') +
                  `Up to ${formatSize(LIMITS.extraction.textDocumentBytes)} of text.`}
            </FieldDescription>
          </div>
          <div className="space-y-2 rounded-md border border-paper-rule px-3 py-3">
            <p id={`${id}-pdf-label`} className="text-small font-medium">
              Or upload a PDF <span className="font-normal text-muted-foreground">(up to {formatSize(LIMITS.extraction.pdfBytes)} and {LIMITS.extraction.pdfPages} pages, no password)</span>
            </p>
            {/* D-120: the same hidden input and outline button as the CSV import. */}
            <Button size="sm" variant="outline" aria-describedby={`${id}-pdf-label`} disabled={!context?.saved || busy} onClick={() => pdfInput.current?.click()}>
              <Upload aria-hidden /> Choose a PDF{pdf && pdfName && <span className="max-w-48 truncate font-normal text-muted-foreground">: {pdfName}</span>}
            </Button>
            <input
              ref={pdfInput}
              id={`${id}-pdf`}
              type="file"
              accept="application/pdf"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                setPdfName(file?.name ?? null)
                void choosePdf(file)
                event.target.value = ''
              }}
            />
            {pdf && (
              <div className="space-y-2">
                <p className="text-caption text-muted-foreground tabular-nums">
                  {pdf.facts.pageCount} {pdf.facts.pageCount === 1 ? 'page' : 'pages'} · {(pdf.bytes.byteLength / 1024).toLocaleString('en-US', { maximumFractionDigits: 0 })} KB · read in your browser, not uploaded yet
                </p>
                <ChoiceCardGroup aria-label="How parties get this PDF" value={delivery} onValueChange={(value) => {
                  const next = value as 'pdf_native' | 'text'
                  setDelivery(next)
                  if (next === 'text') setText(pdf.facts.text)
                }} className="sm:grid-cols-2">
                  <ChoiceCard id={`${id}-native`} value="pdf_native" title="Send the PDF file" description="Each provider gets the file and reads its text and an image of each page, as in production." />
                  <ChoiceCard id={`${id}-text`} value="text" title="Send the text only" description="You review the text below; every party gets exactly the same characters. Charts, stamps and scans are lost." />
                </ChoiceCardGroup>
                {delivery === 'text' && !pdf.facts.hasTextLayer && (
                  <p className="text-small text-warning">{NO_TEXT_LAYER}</p>
                )}
                {delivery === 'pdf_native' ? (
                  <Button size="sm" variant="outline" disabled={busy || !context?.saved} onClick={() => void savePdf()}>
                    Save the PDF file
                  </Button>
                ) : (
                  <p className="text-caption text-muted-foreground">The PDF never leaves your browser. Edit the text above, then save it.</p>
                )}
              </div>
            )}
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
        className="typewriter text-small"
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
        <FieldDescription id={`${id}-help`} className={cn('text-caption', (parseError || local.length > 0 || serverError) && 'text-destructive')}>
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
