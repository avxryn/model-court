/**
 * Question material and one anonymous testimony. Consumes only anonymous
 * fields (title, input, reference, guide, label, text) — never a generation
 * object. Model text renders as plain text in its own scrollable, labelled region.
 */

import type { ReactNode } from 'react'
import { Exhibit, JuryInstructions, Term, Testimony } from '@/components/court/CaseFile'

export function CaseMaterial({ title, input, reference, expectedBehavior, number, total }: { title: string; input: string; reference: string; expectedBehavior: string; number?: number; total?: number }) {
  return (
    <section aria-label="Question presented" className="space-y-6">
      <div>
        <h2 className="court-label">
          <Term name="question" plain={false} />
          {number !== undefined && total !== undefined && (
            <span className="typewriter ml-2 font-normal tracking-normal">
              · {number} OF {total}
            </span>
          )}
          <span className="ml-2 font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">(test case)</span>
        </h2>
        <p className="mt-2 font-heading text-sm text-muted-foreground italic">{title}</p>
        <p className="mt-1 font-heading text-lg leading-relaxed break-words whitespace-pre-wrap">{input}</p>
      </div>
      <Exhibit number={1}>{reference || <span className="text-muted-foreground italic">No exhibit was entered. Declining to answer may be correct.</span>}</Exhibit>
      <JuryInstructions>{expectedBehavior}</JuryInstructions>
    </section>
  )
}

export function ResponseCard({ label, text, children }: { label: string; text: string; children?: ReactNode }) {
  return (
    <Testimony label={label} text={text}>
      {children}
    </Testimony>
  )
}
