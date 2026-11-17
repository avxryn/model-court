/**
 * Case material and one anonymous response. Consumes only anonymous fields
 * (title, input, reference, guide, label, text) — never a generation object.
 * Model text renders as plain text in its own scrollable, labelled region.
 */

import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function CaseMaterial({ title, input, reference, expectedBehavior }: { title: string; input: string; reference: string; expectedBehavior: string }) {
  return (
    <section aria-label="Case material" className="surface space-y-5 p-5 sm:p-6">
      <h2 className="text-xl leading-snug font-semibold tracking-tight">{title}</h2>
      <Block label="Request">{input}</Block>
      <Block label="Reference evidence">{reference || <span className="italic text-muted-foreground">No reference provided — abstention may be correct.</span>}</Block>
      <div className="rounded-r-lg border-l-2 border-brass bg-accent/70 px-4 py-3">
        <div className="eyebrow text-accent-foreground">Reviewer guide · never sent to models</div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-accent-foreground">{expectedBehavior}</p>
      </div>
    </section>
  )
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed">{children}</div>
    </div>
  )
}

export function ResponseCard({ label, text, children }: { label: string; text: string; children?: ReactNode }) {
  const regionId = `response-${label}`
  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 font-heading text-lg font-semibold">
          <span aria-hidden className="grid size-7 place-items-center rounded-full bg-primary font-sans text-sm font-medium text-primary-foreground">
            {label}
          </span>
          Response {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div id={regionId} role="region" aria-label={`Response ${label} text`} tabIndex={0} className="max-h-80 overflow-y-auto rounded-lg bg-secondary/70 px-4 py-3.5 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap ring-1 ring-foreground/5 outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring/50">
          {text}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}
