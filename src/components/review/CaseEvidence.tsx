/**
 * Question material and one anonymous testimony. Consumes only anonymous
 * fields (title, input, reference, guide, label, text) — never a generation
 * object. Model text renders as plain text in its own scrollable, labelled region.
 */

import { Plain } from '@/components/common'
import type { ReactNode } from 'react'
import { ConversationSoFar, Exhibit, JuryInstructions, Term, Testimony } from '@/components/court/CaseFile'

export function CaseMaterial({ title, input, reference, expectedBehavior, number, total, messages = [] }: { title: string; input: string; reference: string; expectedBehavior: string; number?: number; total?: number; messages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> }) {
  return (
    <section aria-label="Question presented" className="space-y-6">
      <div>
        <h2 className="court-label text-wrap">
          <Term name="question" plain={false} />
          {number !== undefined && total !== undefined && (
            <span className="typewriter ml-2 font-normal tracking-normal whitespace-nowrap">
              · {number} OF {total}
            </span>
          )}
           <Plain>test case</Plain>
        </h2>
        <p className="mt-2 font-heading text-sm text-muted-foreground italic">{title}</p>
        {messages.length > 0 && (
          <div className="mt-3">
            <ConversationSoFar messages={messages} />
            <p className="typewriter mt-3 text-xs font-bold text-stamp">THE USER’S NEXT MESSAGE</p>
          </div>
        )}
        <p className="mt-1 font-heading text-lg leading-relaxed break-words whitespace-pre-wrap">{input}</p>
        {messages.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Each testimony is that party’s reply to this message.</p>}
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
