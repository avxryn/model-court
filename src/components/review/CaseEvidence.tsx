/**
 * Case material and one anonymous response. Consumes only anonymous fields
 * (title, input, reference, guide, label, text) — never a generation object.
 * Model text renders as plain text in its own scrollable, labelled region.
 */

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function CaseMaterial({ title, input, reference, expectedBehavior }: { title: string; input: string; reference: string; expectedBehavior: string }) {
  return (
    <section aria-label="Case material" className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Block label="Request">{input}</Block>
      <Block label="Reference evidence">{reference || <span className="italic text-muted-foreground">No reference provided — abstention may be correct.</span>}</Block>
      <div className="rounded-md border border-brass/30 bg-accent/60 p-3">
        <div className="text-xs font-medium uppercase tracking-wider text-accent-foreground">Reviewer guide · never sent to models</div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-accent-foreground">{expectedBehavior}</p>
      </div>
    </section>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm">{children}</div>
    </div>
  )
}

export function ResponseCard({ label, text, children }: { label: string; text: string; children?: ReactNode }) {
  const regionId = `response-${label}`
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-heading text-lg">
          <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary text-sm text-primary-foreground">
            {label}
          </span>
          Response {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div id={regionId} role="region" aria-label={`Response ${label} text`} tabIndex={0} className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-secondary/60 p-3 text-[0.9375rem] leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          {text}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}
