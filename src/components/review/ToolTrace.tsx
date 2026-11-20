/**
 * A tool-use testimony (spec 06 §3, D-103): numbered steps, each step's text, every call with its
 * arguments in one uniform JSON format and the result the tool returned, then the final answer or
 * why the loop stopped. Before unsealing it renders only the juror projection (`JurorToolTrace`),
 * identical in shape for every party and provider. After unsealing (`full`) it adds which canned
 * response answered each call and per-step tokens and time. All text renders as escaped React text.
 */

import type { ReactNode } from 'react'
import type { JurorToolTrace, ToolTrace as FullTrace, TraceCall } from '@/domain/tools/trace'
import type { StepUsage } from '@/lib/dto'
import { cn } from '@/lib/utils'

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** After unsealing: which response answered a call, in plain words. */
export function describeSource(call: Pick<TraceCall, 'source' | 'responseIndex' | 'issues'>): string {
  switch (call.source) {
    case 'match':
      return `Answered by response ${(call.responseIndex ?? 0) + 1}`
    case 'default':
      return 'No response matched: the default response'
    case 'invalid_arguments':
      return `Arguments didn’t fit: the error response${call.issues[0] ? ` (${call.issues[0].message.replace(/\.$/u, '')})` : ''}`
    case 'unknown_tool':
      return 'Not a defined tool: the fixed error'
    case 'over_cap':
      return 'Over the call limit: the fixed error'
    default:
      return 'Not answered'
  }
}

function endLine(trace: Pick<JurorToolTrace, 'ended' | 'steps'>, maxSteps?: number): string {
  if (trace.ended === 'truncated') return 'Stopped: the reply was cut off at the output limit.'
  const used = trace.steps.length
  return `Stopped: step cap reached (${used} of ${maxSteps ?? used} ${maxSteps === 1 ? 'call' : 'calls'}).`
}

export function ToolTraceView({ label, trace, maxSteps, full, usage, children }: { label: string; trace: JurorToolTrace; maxSteps?: number; /** After unsealing only: the full trace with answer sources. */ full?: FullTrace; usage?: readonly StepUsage[]; children?: ReactNode }) {
  const fullCalls = new Map((full?.steps ?? []).flatMap((step) => step.calls.map((call) => [call.callNo, call] as const)))
  return (
    <article data-testimony className="min-w-0 exhibit-panel">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className="typewriter shrink-0 rounded-[4px] bg-foreground px-2 py-0.5 text-caption font-semibold tracking-[0.06em] whitespace-nowrap text-background">TESTIMONY {label}</h3>
        <span className="text-right text-caption leading-snug text-muted-foreground">{plural(trace.steps.length, 'step')} · {plural(trace.steps.reduce((sum, step) => sum + step.calls.length, 0), 'tool call')}</span>
      </header>
      <div role="region" aria-label={`Testimony ${label} trace`} tabIndex={0} className="max-h-[32rem] space-y-3 overflow-y-auto px-4 py-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <ol className="list-none space-y-3 p-0">
          {trace.steps.map((step) => {
            const stepUsage = usage?.find((item) => item.stepNo === step.stepNo)
            if (step.text === null && step.calls.length === 0 && !stepUsage) return null
            return (
              <li key={step.stepNo} className="space-y-2">
                <p className="court-label flex flex-wrap items-baseline justify-between gap-2">
                  <span>Step {step.stepNo}</span>
                  {stepUsage && (
                    <span className="typewriter text-caption font-normal tracking-normal normal-case text-muted-foreground tabular-nums">
                      {stepUsage.inputTokens ?? '—'} in · {stepUsage.outputTokens ?? '—'} out{stepUsage.durationMs !== null ? ` · ${(stepUsage.durationMs / 1000).toFixed(1)} s` : ''}
                      {stepUsage.truncated ? ' · cut off' : ''}
                    </span>
                  )}
                </p>
                {step.text !== null && <p className="text-reading leading-[1.65] break-words whitespace-pre-wrap">{step.text}</p>}
                {step.calls.map((call) => {
                  const detail = fullCalls.get(call.callNo)
                  const result = call.result
                  return (
                    <div key={call.callNo} className="rounded-md border border-border">
                      <p className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-3 py-1.5 text-small">
                        <span className="typewriter text-caption text-mark">#{call.callNo}</span>
                        <span>
                          Called <code className="font-mono text-[0.85em]">{call.tool}</code>
                        </span>
                        {!call.knownTool && <span className="text-caption text-muted-foreground">(not a defined tool)</span>}
                      </p>
                      <pre className="overflow-x-auto px-3 py-2 font-mono text-small leading-relaxed whitespace-pre-wrap break-words">{call.arguments}</pre>
                      <div className={cn('border-t border-border px-3 py-2 text-small', 'notSent' in result ? 'text-muted-foreground' : result.isError ? 'bg-destructive/5' : 'bg-muted/40')}>
                        {'notSent' in result ? (
                          <p className="italic">Not run: the loop ended before this call was answered.</p>
                        ) : (
                          <>
                            <p className={cn('court-label mb-1', result.isError && 'text-destructive')}>{result.isError ? 'Error result' : 'Result'}</p>
                            <pre className="font-mono text-small leading-relaxed whitespace-pre-wrap break-words">{result.text}</pre>
                          </>
                        )}
                        {detail && <p className="mt-1.5 text-caption text-muted-foreground">{describeSource(detail)}</p>}
                      </div>
                    </div>
                  )
                })}
              </li>
            )
          })}
        </ol>
        {trace.ended === 'answered' || trace.finalAnswer !== null ? (
          <section aria-label={`Testimony ${label} final answer`} className="space-y-1 border-t border-paper-rule pt-3">
            <p className="court-label">Final answer</p>
            <p className="text-reading leading-[1.65] break-words whitespace-pre-wrap">{trace.finalAnswer ?? ''}</p>
            {trace.ended === 'truncated' && <p className="text-caption text-muted-foreground">{endLine(trace, maxSteps)}</p>}
          </section>
        ) : (
          <p className="border-t border-paper-rule pt-3 text-small text-muted-foreground">{endLine(trace, maxSteps)} No final answer.</p>
        )}
      </div>
      {children && <div className="border-t border-border px-4 pt-3 pb-4">{children}</div>}
    </article>
  )
}

/** "order_id (text, required), qty (whole number)": a readable summary of a tool's arguments. */
export function argumentSummary(parameters: Record<string, unknown>): string {
  const properties = (parameters.properties ?? {}) as Record<string, { type?: unknown }>
  const required = new Set(Array.isArray(parameters.required) ? (parameters.required as string[]) : [])
  const words: Record<string, string> = { string: 'text', number: 'number', integer: 'whole number', boolean: 'true/false', object: 'object', array: 'list', null: 'null' }
  const names = Object.keys(properties)
  if (names.length === 0) return 'No arguments'
  return names
    .map((name) => {
      const type = properties[name]?.type
      const types = (Array.isArray(type) ? type : [type]).filter((item): item is string => typeof item === 'string').map((item) => words[item] ?? item)
      return `${name} (${[types.join(' or ') || 'any', required.has(name) ? 'required' : null].filter(Boolean).join(', ')})`
    })
    .join(', ')
}

/** The tools every party could call, shown once per question (spec 06 §3). */
export function ToolList({ tools, maxSteps }: { tools: ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }>; maxSteps: number }) {
  return (
    <div className="mt-2 space-y-2 text-muted-foreground">
      <p>
        Each party could call these tools, up to {plural(maxSteps, 'call')} to its model. Model Court answered every call from the judge’s canned responses; nothing real was run.
      </p>
      <ul className="space-y-1.5">
        {tools.map((tool) => (
          <li key={tool.name}>
            <code className="font-mono text-[0.85em] text-foreground">{tool.name}</code>: {tool.description}
            <span className="block text-caption">Arguments: {argumentSummary(tool.parameters)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
