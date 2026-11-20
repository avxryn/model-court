/**
 * The case's questions (E02): one card per question with field-level
 * validation from the shared draft schema. The optional earlier
 * conversation and language fold away until they are used.
 */

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Fold } from '@/components/court/Fold'
import { CaseImport } from '@/components/evaluations/CaseImport'
import { ConversationEditor } from '@/components/evaluations/ConversationEditor'
import { CountedField } from '@/components/evaluations/CountedField'
import { QuestionKitFields } from '@/components/evaluations/QuestionKitFields'
import { SourcesImport } from '@/components/evaluations/SourcesImport'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { CaseInput } from '@/domain/contracts'
import { EXTRACTION_DEFAULT_INPUT } from '@/domain/kits/extraction'
import { GROUNDED_DEFAULT_FIELDS } from '@/domain/kits/grounded'
import { GENERAL_V1 } from '@/domain/kits/general'
import { blankToolTask } from '@/domain/tools/task'
import type { TaskKit } from '@/domain/kits/types'
import { LIMITS } from '@/domain/limits'
import { plural } from '@/lib/format'
import { maxQuestionsFor } from '@/domain/parties'

export function QuestionsEditor({ cases, onChange, errors, newId, disabled, kit = GENERAL_V1 as TaskKit<unknown, unknown>, kitSettings, parties }: { cases: CaseInput[]; onChange: (next: CaseInput[]) => void; errors: FieldErrors; newId: () => string; disabled?: boolean; /** Spec 03 (D-79): the draft's task kit and its settings. */ kit?: TaskKit<unknown, unknown>; kitSettings?: unknown; /** Spec 07 §9.1: the party count, which caps the questions at 15 answers per juror. */ parties?: number }) {
  const maxQuestions = parties ? maxQuestionsFor(parties) : LIMITS.maxCases
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
      {/* D-119: the CSV has no columns for tools or field lists, so importing would drop them. */}
      {kit.family !== 'tools' && kit.family !== 'extraction' && <CaseImport currentCount={cases.length} newId={newId} onImport={onChange} disabled={disabled} kitVersion={kit.version} parties={parties} />}
      {kit.family === 'grounded' && <SourcesImport cases={cases} disabled={disabled} />}
      {cases.map((testCase, index) => (
        <Card key={testCase.key} className="rounded-md bg-card ring-border">
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
          <CardContent>
            <QuestionFields testCase={testCase} index={index} errors={errors} kit={kit} kitSettings={kitSettings} onChange={(patch) => update(index, patch)} />
          </CardContent>
        </Card>
      ))}
      <Button
        variant="outline"
        disabled={cases.length >= maxQuestions}
        onClick={() => onChange([...cases, { key: newId(), title: `Question ${cases.length + 1}`, input: kit.family === 'extraction' ? EXTRACTION_DEFAULT_INPUT : '', reference: '', expectedBehavior: kit.defaultJuryInstructions ?? '', ...(kit.family === 'extraction' ? { kitFields: { kind: 'extraction' as const } } : kit.family === 'grounded' ? { kitFields: { ...GROUNDED_DEFAULT_FIELDS } } : kit.family === 'tools' ? { kitFields: blankToolTask() } : {}) }])}
      >
        <Plus aria-hidden /> Add a question ({cases.length}/{maxQuestions})
      </Button>
      {maxQuestions < LIMITS.maxCases && (
        <p className="text-xs text-muted-foreground">
          With {parties} parties a hearing holds up to {maxQuestions} questions, so each juror scores at most {LIMITS.maxTestimoniesPerHearing} answers.
        </p>
      )}
    </fieldset>
  )
}

function QuestionFields({ testCase, index, errors, onChange, kit, kitSettings }: { testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void; kit: TaskKit<unknown, unknown>; kitSettings: unknown }) {
  const takesConversation = kit.inputKinds.includes('conversation')
  // Spec 04: a document kit's source is uploaded beside the question; there is no exhibit.
  const documentKit = kit.inputKinds.includes('document')
  // Spec 05: a sources kit's evidence is its numbered sources; there is no exhibit either.
  const sourcesKit = kit.inputKinds.includes('sources')
  const id = (field: string) => `case-${testCase.key}-${field}`
  const error = (field: string) => errors[`cases.${index}.${field}`]
  const messages = testCase.messages ?? []
  const extrasError = error('messages') ?? error('language')
  // Starts open when either optional part is in use; an error always opens it.
  const [open, setOpen] = useState(messages.length > 0 || !!testCase.language)
  const extras = [messages.length > 0 && plural(messages.length / 2, 'earlier exchange'), testCase.language && `language ${testCase.language}`].filter(Boolean).join(' · ')
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <CountedField className="md:col-span-2" id={id('title')} label="Short title" value={testCase.title} max={LIMITS.caseTitle.max} error={error('title')} onChange={(title) => onChange({ title })} />
      <CountedField
        className={documentKit || sourcesKit ? 'md:col-span-2' : undefined}
        id={id('input')}
        label={documentKit ? 'What to extract (sent to the models)' : 'The question (sent to the models)'}
        multiline
        rows={documentKit ? 2 : sourcesKit ? 3 : 4}
        value={testCase.input}
        max={LIMITS.caseInput.max}
        error={error('input')}
        onChange={(input) => onChange({ input })}
      />
      {!documentKit && !sourcesKit && <CountedField
        id={id('reference')}
        label={kit.family === 'summarization' ? 'Document (exhibit, sent to the models)' : kit.family === 'classification' || kit.family === 'tools' ? 'Context (exhibit, sent to the models)' : 'Exhibit: reference evidence (sent to the models)'}
        multiline
        rows={4}
        value={testCase.reference}
        max={LIMITS.caseReference.max}
        hint={kit.family === 'summarization' ? 'The text to summarize. Required to start a hearing.' : kit.family === 'classification' ? 'Optional, for example a routing policy.' : kit.family === 'tools' ? 'Optional, for example a refund policy the assistant follows.' : 'May be empty to test abstention.'}
        error={error('reference')}
        onChange={(reference) => onChange({ reference })}
      />}
      <CountedField
        className="md:col-span-2"
        id={id('expected')}
        label="Jury instructions: what a good answer does (never sent to the models)"
        multiline
        rows={2}
        value={testCase.expectedBehavior}
        max={LIMITS.caseExpectedBehavior.max}
        error={error('expectedBehavior')}
        onChange={(expectedBehavior) => onChange({ expectedBehavior })}
      />
      <QuestionKitFields kit={kit} settings={kitSettings} testCase={testCase} index={index} errors={errors} onChange={onChange} />
      <Fold
        className="md:col-span-2"
        open={open || !!extrasError}
        onOpenChange={setOpen}
        summary={
          <span>
            {takesConversation ? 'Earlier conversation and language' : 'Language'} <span className="text-xs">(optional{extras ? `: ${extras}` : ''})</span>
          </span>
        }
        contentClassName="space-y-4"
      >
        {takesConversation && <ConversationEditor caseKey={testCase.key} messages={messages} error={error('messages')} onChange={(next) => onChange({ messages: next.length > 0 ? next : undefined })} />}
        <CountedField
          className="md:max-w-xs"
          id={id('language')}
          label="Language"
          value={testCase.language ?? ''}
          max={LIMITS.caseLanguage.max}
          hint="For example en or Spanish. Tag two or more languages to see findings by language."
          error={error('language')}
          onChange={(language) => onChange({ language: language.trim() === '' ? undefined : language })}
        />
      </Fold>
    </div>
  )
}
