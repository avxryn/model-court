/**
 * Public glossary of the courtroom terms (D-25). Static tier: no auth, no
 * data hooks, no network requests.
 */

import { Link } from 'react-router-dom'
import { BrandMark } from '@/components/BrandMark'
import { Sheet } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
import { CASE_STEPS, TERMS } from '@/lib/court'

const ORDER = ['case', 'judge', 'juror', 'parties', 'question', 'exhibit', 'instructions', 'hearing', 'testimony', 'summons', 'worksheet', 'file', 'unseal', 'findings', 'record', 'judgment', 'certified', 'docket'] as const

export default function GlossaryPage() {
  return (
    <div className="min-h-screen bg-desk">
      <header className="border-b border-paper-edge/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandMark />
          </Link>
          <Button size="sm" variant="outline" render={<Link to="/sample" />} nativeButton={false}>
            Try the sample case
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
        <Sheet>
          <div className="px-5 pt-8 pb-10 sm:px-8">
            <div className="court-label">Glossary</div>
            <h1 className="mt-1.5 font-heading text-3xl leading-tight font-bold">The words of the court, in plain terms</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Model Court borrows courtroom words to make the steps easy to follow. Anything about your API keys, costs, consent, or deleting data is always written in plain words.
            </p>

            <h2 className="court-label mt-8">How a case proceeds</h2>
            <ol className="mt-3 grid gap-2 sm:grid-cols-5">
              {CASE_STEPS.map((step, index) => (
                <li key={step.key} className="rounded-[2px] bg-white px-3 py-2.5 ring-1 ring-exhibit-edge">
                  <div className="typewriter text-[0.6875rem] font-bold text-stamp">STEP {index + 1}</div>
                  <div className="font-heading font-bold">{step.name}</div>
                  <div className="text-xs text-muted-foreground">{step.plain}</div>
                </li>
              ))}
            </ol>

            <h2 className="court-label mt-10">Terms</h2>
            <dl className="mt-3 divide-y divide-paper-rule">
              {ORDER.map((key) => {
                const entry = TERMS[key]
                return (
                  <div key={key} className="grid gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                    <dt>
                      <span className="font-heading text-base font-bold">{entry.term}</span>
                      <span className="block text-xs text-muted-foreground">{entry.plain}</span>
                    </dt>
                    <dd className="font-heading text-[0.9375rem] leading-relaxed">{entry.explain}</dd>
                  </div>
                )
              })}
            </dl>
          </div>
        </Sheet>
      </main>
    </div>
  )
}
