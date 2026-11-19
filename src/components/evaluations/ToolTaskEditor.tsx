/**
 * One tool-use question's task (spec 06 §3, D-103): the tools every party may call, the canned
 * responses Model Court answers with, the step cap, what should happen (never sent to the models)
 * and "Try a call", which runs the same pure answerer the server uses, in the browser, with no
 * provider call. Everything here is part of the draft; the server re-validates it on save.
 */

import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Plain } from '@/components/court/Paper'
import type { FieldErrors } from '@/components/evaluations/DraftEditor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { CaseInput } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { schemaIssues } from '@/domain/tools/json-schema'
import { answerCall, describeAnswer, parseArguments } from '@/domain/tools/mock'
import { blankTool, blankToolTask, EXAMPLE_TOOL_TASK, type ToolDefinition, type ToolsFields } from '@/domain/tools/task'
import { prettyJson } from '@/domain/tools/trace'
import { cn } from '@/lib/utils'

const T = LIMITS.tools
const NONE = '__none__'

function fieldsOf(testCase: CaseInput): ToolsFields {
  const raw = testCase.kitFields as ToolsFields | undefined
  return raw?.kind === 'tools' ? raw : blankToolTask()
}

/** A JSON object typed as text: the draft changes only when the text parses to an object. */
function JsonField({ id, label, value, onChange, rows = 4, hint, problems, error }: { id: string; label: string; value: Record<string, unknown> | undefined; onChange: (next: Record<string, unknown> | undefined) => void; rows?: number; hint?: string; problems?: string[]; error?: string }) {
  const [text, setText] = useState(() => (value === undefined ? '' : prettyJson(value)))
  const [parseError, setParseError] = useState<string | null>(null)
  const shown = parseError ?? error ?? problems?.[0]
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={rows}
        className="font-mono text-xs"
        spellCheck={false}
        value={text}
        aria-invalid={shown ? true : undefined}
        aria-describedby={`${id}-help`}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          if (next.trim() === '') {
            setParseError(null)
            onChange(undefined)
            return
          }
          const parsed = parseArguments(next)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setParseError('Not a JSON object yet. The last valid value is kept until this one parses.')
            return
          }
          setParseError(null)
          onChange(parsed as Record<string, unknown>)
        }}
      />
      <FieldDescription id={`${id}-help`} className={cn('text-xs', shown && 'text-destructive')}>
        {shown ?? hint}
      </FieldDescription>
    </Field>
  )
}

export function ToolsQuestionFields({ testCase, index, errors, onChange }: { testCase: CaseInput; index: number; errors: FieldErrors; onChange: (patch: Partial<CaseInput>) => void }) {
  const fields = fieldsOf(testCase)
  const set = (patch: Partial<ToolsFields>) => onChange({ kitFields: { ...fields, ...patch } })
  const setTool = (toolIndex: number, patch: Partial<ToolDefinition>) => set({ tools: fields.tools.map((tool, i) => (i === toolIndex ? { ...tool, ...patch } : tool)) })
  const prefix = `cases.${index}.kitFields`
  const errorAt = (suffix: string) => Object.entries(errors).find(([path]) => path === `${prefix}.${suffix}` || path.startsWith(`${prefix}.${suffix}.`))?.[1]
  const taskError = errors[prefix]
  const id = (field: string) => `case-${testCase.key}-tools-${field}`
  // Remounts the JSON editors when the whole task is replaced ("Use the example").
  const [generation, setGeneration] = useState(0)
  const names = fields.tools.map((tool) => tool.name)

  return (
    <div className="space-y-5 border-t border-paper-rule pt-4 md:col-span-2" key={generation}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="court-label">
          Tools <Plain>names, descriptions and argument schemas are sent to the models</Plain>
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onChange({ kitFields: { kind: 'tools', ...EXAMPLE_TOOL_TASK } })
            setGeneration((n) => n + 1)
          }}
        >
          Use the example (order lookup)
        </Button>
      </div>
      {fields.tools.map((tool, toolIndex) => (
        <ToolCard
          key={toolIndex}
          tool={tool}
          toolIndex={toolIndex}
          id={(field) => id(`${toolIndex}-${field}`)}
          errorAt={(suffix) => errorAt(`tools.${toolIndex}.${suffix}`)}
          canRemove={fields.tools.length > 1}
          onChange={(patch) => setTool(toolIndex, patch)}
          onRemove={() => {
            const removed = tool.name
            set({
              tools: fields.tools.filter((_, i) => i !== toolIndex),
              expect: { ...fields.expect, requiredCalls: fields.expect.requiredCalls.filter((call) => call.tool !== removed), forbiddenTools: fields.expect.forbiddenTools.filter((name) => name !== removed) },
            })
          }}
        />
      ))}
      <Button variant="outline" size="sm" disabled={fields.tools.length >= T.perQuestion} onClick={() => set({ tools: [...fields.tools, blankTool(fields.tools.length + 1)] })}>
        <Plus aria-hidden /> Add a tool ({fields.tools.length}/{T.perQuestion})
      </Button>

      <Field className="max-w-md gap-1.5">
        <FieldLabel htmlFor={id('max-steps')}>Step cap</FieldLabel>
        <Select value={String(fields.maxSteps)} onValueChange={(value) => set({ maxSteps: Number(value), expect: { ...fields.expect, ...(fields.expect.targetSteps !== undefined && fields.expect.targetSteps > Number(value) ? { targetSteps: Number(value) } : {}) } })}>
          <SelectTrigger id={id('max-steps')} className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: T.maxSteps }, (_, i) => i + 1).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} {n === 1 ? 'call' : 'calls'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription className="text-xs">
          Each party may make up to {fields.maxSteps} {fields.maxSteps === 1 ? 'call' : 'calls'} to its model for this question. All of them are reserved from your daily allowance at Start; unused ones come back.
        </FieldDescription>
      </Field>

      <Expectations fields={fields} names={names} id={id} errorAt={errorAt} onChange={(expect) => set({ expect })} />
      <TryACall fields={fields} id={id} />
      {taskError && <p className="text-xs text-destructive">{taskError}</p>}
    </div>
  )
}

function ToolCard({ tool, toolIndex, id, errorAt, canRemove, onChange, onRemove }: { tool: ToolDefinition; toolIndex: number; id: (field: string) => string; errorAt: (suffix: string) => string | undefined; canRemove: boolean; onChange: (patch: Partial<ToolDefinition>) => void; onRemove: () => void }) {
  const problems = useMemo(() => schemaIssues(tool.parameters).map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)), [tool.parameters])
  return (
    <section aria-label={`Tool ${toolIndex + 1}`} className="space-y-3 rounded-md border border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-48 flex-1 gap-1.5">
          <FieldLabel htmlFor={id('name')}>Name</FieldLabel>
          <Input id={id('name')} className="font-mono" value={tool.name} maxLength={T.name} aria-invalid={errorAt('name') ? true : undefined} onChange={(event) => onChange({ name: event.target.value })} />
          {errorAt('name') && <FieldDescription className="text-xs text-destructive">{errorAt('name')}</FieldDescription>}
        </Field>
        <Button size="icon-sm" variant="ghost" aria-label={`Remove tool ${toolIndex + 1}`} disabled={!canRemove} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={id('description')}>Description</FieldLabel>
        <Textarea id={id('description')} rows={2} value={tool.description} onChange={(event) => onChange({ description: event.target.value })} />
        {errorAt('description') && <FieldDescription className="text-xs text-destructive">{errorAt('description')}</FieldDescription>}
      </Field>
      <JsonField
        id={id('parameters')}
        label="Arguments (JSON Schema)"
        rows={6}
        value={tool.parameters}
        hint='An object schema. Supported: type, properties, required, additionalProperties: false, items, enum, const, minimum, maximum, minLength, maxLength, minItems, maxItems, description.'
        problems={problems}
        error={errorAt('parameters')}
        onChange={(next) => onChange({ parameters: next ?? { type: 'object', properties: {} } })}
      />
      <div className="space-y-3">
        <p className="court-label">
          Responses <Plain>the first row whose arguments match is returned to the party</Plain>
        </p>
        {tool.responses.map((response, row) => (
          <div key={row} className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-2">
            <JsonField id={id(`when-${row}`)} label={`Row ${row + 1}: when these arguments`} rows={3} value={response.when} hint="A partial object; {} matches any valid call." error={errorAt(`responses.${row}.when`)} onChange={(when) => onChange({ responses: tool.responses.map((r, i) => (i === row ? { ...r, when: when ?? {} } : r)) })} />
            <Field className="gap-1.5">
              <FieldLabel htmlFor={id(`output-${row}`)}>Return this</FieldLabel>
              <Textarea id={id(`output-${row}`)} rows={3} className="font-mono text-xs" value={response.output} onChange={(event) => onChange({ responses: tool.responses.map((r, i) => (i === row ? { ...r, output: event.target.value } : r)) })} />
              {errorAt(`responses.${row}.output`) && <FieldDescription className="text-xs text-destructive">{errorAt(`responses.${row}.output`)}</FieldDescription>}
            </Field>
            <div className="flex flex-wrap items-center gap-4 md:col-span-2">
              <Label className="font-normal">
                <Checkbox checked={response.isError} onCheckedChange={(checked) => onChange({ responses: tool.responses.map((r, i) => (i === row ? { ...r, isError: checked === true } : r)) })} /> Is an error
              </Label>
              <Label className="font-normal">
                <Checkbox checked={response.textMatch === 'loose'} onCheckedChange={(checked) => onChange({ responses: tool.responses.map((r, i) => (i === row ? { ...r, textMatch: checked === true ? 'loose' : 'exact' } : r)) })} /> Loose text matching (case and spacing ignored)
              </Label>
              <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Remove response ${row + 1} of ${tool.name}`} onClick={() => onChange({ responses: tool.responses.filter((_, i) => i !== row) })}>
                <Trash2 aria-hidden /> Remove
              </Button>
            </div>
          </div>
        ))}
        <Button size="sm" variant="outline" disabled={tool.responses.length >= T.responsesPerTool} onClick={() => onChange({ responses: [...tool.responses, { when: {}, textMatch: 'loose', output: '', isError: false }] })}>
          <Plus aria-hidden /> Add a response ({tool.responses.length}/{T.responsesPerTool})
        </Button>
        <div className="grid gap-3 md:grid-cols-2">
          <Field className="gap-1.5">
            <FieldLabel htmlFor={id('default')}>Default response (no row matched)</FieldLabel>
            <Textarea id={id('default')} rows={2} className="font-mono text-xs" value={tool.defaultResponse.output} onChange={(event) => onChange({ defaultResponse: { ...tool.defaultResponse, output: event.target.value } })} />
            <Label className="font-normal">
              <Checkbox checked={tool.defaultResponse.isError} onCheckedChange={(checked) => onChange({ defaultResponse: { ...tool.defaultResponse, isError: checked === true } })} /> Is an error
            </Label>
            {errorAt('defaultResponse') && <FieldDescription className="text-xs text-destructive">{errorAt('defaultResponse')}</FieldDescription>}
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor={id('error')}>Error response (arguments didn’t fit the schema)</FieldLabel>
            <Textarea id={id('error')} rows={2} className="font-mono text-xs" value={tool.errorResponse.output} onChange={(event) => onChange({ errorResponse: { output: event.target.value } })} />
            {errorAt('errorResponse') && <FieldDescription className="text-xs text-destructive">{errorAt('errorResponse')}</FieldDescription>}
          </Field>
        </div>
      </div>
    </section>
  )
}

function Expectations({ fields, names, id, errorAt, onChange }: { fields: ToolsFields; names: string[]; id: (field: string) => string; errorAt: (suffix: string) => string | undefined; onChange: (next: ToolsFields['expect']) => void }) {
  const expect = fields.expect
  return (
    <section aria-label="What should happen" className="space-y-3 rounded-md border border-dashed border-border p-4">
      <p className="court-label">
        What should happen <Plain>never sent to the models; checked for free after each answer</Plain>
      </p>
      <div className="space-y-2">
        <p className="text-sm font-medium">Required calls</p>
        {expect.requiredCalls.map((call, row) => (
          <div key={row} className="grid gap-2 md:grid-cols-[12rem_1fr_auto] md:items-start">
            <Select value={names.includes(call.tool) ? call.tool : NONE} onValueChange={(tool) => onChange({ ...expect, requiredCalls: expect.requiredCalls.map((c, i) => (i === row ? { ...c, tool: String(tool) } : c)) })}>
              <SelectTrigger aria-label={`Required call ${row + 1}: tool`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {names.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <JsonField id={id(`required-${row}`)} label="With these arguments (optional)" rows={2} value={call.withArguments} error={errorAt(`expect.requiredCalls.${row}`)} onChange={(withArguments) => onChange({ ...expect, requiredCalls: expect.requiredCalls.map((c, i) => (i === row ? { tool: c.tool, ...(withArguments ? { withArguments } : {}) } : c)) })} />
            <Button size="icon-sm" variant="ghost" aria-label={`Remove required call ${row + 1}`} onClick={() => onChange({ ...expect, requiredCalls: expect.requiredCalls.filter((_, i) => i !== row) })}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-4">
          <Button size="sm" variant="outline" disabled={expect.requiredCalls.length >= T.requiredCalls || names.length === 0} onClick={() => onChange({ ...expect, requiredCalls: [...expect.requiredCalls, { tool: names[0] }] })}>
            <Plus aria-hidden /> Add a required call
          </Button>
          <Label className="font-normal">
            <Checkbox checked={expect.requireOrder} onCheckedChange={(checked) => onChange({ ...expect, requireOrder: checked === true })} /> Order matters
          </Label>
        </div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">Forbidden tools</legend>
        <div className="flex flex-wrap gap-4">
          {names.map((name) => (
            <Label key={name} className="font-mono text-sm font-normal">
              <Checkbox
                checked={expect.forbiddenTools.includes(name)}
                onCheckedChange={(checked) => onChange({ ...expect, forbiddenTools: checked === true ? [...expect.forbiddenTools, name] : expect.forbiddenTools.filter((other) => other !== name) })}
              />{' '}
              {name}
            </Label>
          ))}
        </div>
        {errorAt('expect.forbiddenTools') && <p className="text-xs text-destructive">{errorAt('expect.forbiddenTools')}</p>}
      </fieldset>
      <div className="grid gap-3 md:grid-cols-[12rem_10rem_1fr]">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('target')}>Target number of calls</FieldLabel>
          <Select value={expect.targetSteps === undefined ? NONE : String(expect.targetSteps)} onValueChange={(value) => onChange({ ...expect, targetSteps: value === NONE ? undefined : Number(value) })}>
            <SelectTrigger id={id('target')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No target</SelectItem>
              {Array.from({ length: fields.maxSteps }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('answer-mode')}>Final answer</FieldLabel>
          <Select value={expect.finalAnswer?.mode ?? NONE} onValueChange={(value) => onChange({ ...expect, finalAnswer: value === NONE ? undefined : { mode: value as 'exact' | 'contains', value: expect.finalAnswer?.value ?? '' } })}>
            <SelectTrigger id={id('answer-mode')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Not checked</SelectItem>
              <SelectItem value="contains">Contains</SelectItem>
              <SelectItem value="exact">Equals</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {expect.finalAnswer && (
          <Field className="gap-1.5">
            <FieldLabel htmlFor={id('answer-value')}>Expected text</FieldLabel>
            <Input id={id('answer-value')} value={expect.finalAnswer.value} maxLength={T.expectedAnswer.max} onChange={(event) => onChange({ ...expect, finalAnswer: { mode: expect.finalAnswer!.mode, value: event.target.value } })} />
            {errorAt('expect.finalAnswer') && <FieldDescription className="text-xs text-destructive">{errorAt('expect.finalAnswer')}</FieldDescription>}
          </Field>
        )}
      </div>
      {errorAt('expect.targetSteps') && <p className="text-xs text-destructive">{errorAt('expect.targetSteps')}</p>}
    </section>
  )
}

/** Spec 06 §3: which response a party would get and why. Pure, in the browser; nothing is sent. */
function TryACall({ fields, id }: { fields: ToolsFields; id: (field: string) => string }) {
  const [tool, setTool] = useState(fields.tools[0]?.name ?? '')
  const [args, setArgs] = useState('{}')
  const [shown, setShown] = useState<ReturnType<typeof answerCall> | null>(null)
  const name = fields.tools.some((candidate) => candidate.name === tool) ? tool : (fields.tools[0]?.name ?? '')
  return (
    <section aria-label="Try a call" className="space-y-3 rounded-md bg-slip p-4">
      <p className="court-label">
        Try a call <Plain>runs here in your browser; nothing is sent</Plain>
      </p>
      <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto] md:items-end">
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('try-tool')}>Tool</FieldLabel>
          <Select value={name} onValueChange={(value) => setTool(String(value))}>
            <SelectTrigger id={id('try-tool')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fields.tools.map((candidate) => (
                <SelectItem key={candidate.name} value={candidate.name}>
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field className="gap-1.5">
          <FieldLabel htmlFor={id('try-args')}>Arguments</FieldLabel>
          <Textarea id={id('try-args')} rows={2} className="font-mono text-xs" spellCheck={false} value={args} onChange={(event) => setArgs(event.target.value)} />
        </Field>
        <Button variant="outline" onClick={() => setShown(answerCall(fields, { name, argumentsRaw: args, argumentsParsed: parseArguments(args) }, { inStep: 0, inTrace: 0 }))}>
          Try it
        </Button>
      </div>
      {shown && (
        <div role="status" className="space-y-1 text-sm">
          <p className="text-muted-foreground">{describeAnswer(shown)}</p>
          <p className={cn('court-label', shown.isError && 'text-destructive')}>{shown.isError ? 'Error result' : 'Result'}</p>
          <pre className="rounded-md bg-background px-3 py-2 font-mono text-xs whitespace-pre-wrap break-words">{shown.output}</pre>
        </div>
      )}
    </section>
  )
}
