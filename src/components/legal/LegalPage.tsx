/** Shared frame for the privacy, terms and accessibility pages: header, draft notice, one sheet of sections. */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sheet } from '@/components/court/CaseFile'
import { Page, PageHeader } from '@/components/layout/Page'
import { LEGAL } from '@/lib/legal'

export function LegalPage({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Page>
      <PageHeader eyebrow={`Effective ${LEGAL.effective}`} title={title} description={description} />
      {LEGAL.draft && (
        <p role="note" className="mb-5 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          Draft for review: this text has not had a legal review yet, and the bracketed details are placeholders.
        </p>
      )}
      <Sheet className="px-5 py-2 sm:px-8">{children}</Sheet>
      <nav aria-label="Legal" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
        <Link to="/privacy" className="underline-offset-4 hover:text-foreground hover:underline">
          Privacy
        </Link>
        <Link to="/terms" className="underline-offset-4 hover:text-foreground hover:underline">
          Terms
        </Link>
        <Link to="/accessibility" className="underline-offset-4 hover:text-foreground hover:underline">
          Accessibility
        </Link>
      </nav>
    </Page>
  )
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-b border-border py-6 last:border-b-0">
      <h2 id={id} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      <div className="max-w-[68ch] space-y-3 text-sm leading-relaxed text-foreground/90 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{children}</div>
    </section>
  )
}

/** The contact address, as plain text (mail links are unreliable in some browsers). */
export function Contact() {
  return <span className="font-medium text-foreground">{LEGAL.contact}</span>
}
