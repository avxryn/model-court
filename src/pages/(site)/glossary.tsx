/**
 * The courtroom terms in plain words (D-25), grouped by what they name. Inside
 * the public site layout; no data hooks, no API requests.
 */

import { Link } from 'react-router-dom'
import { Page, PageHeader } from '@/components/layout/Page'
import { Panel } from '@/components/court/Paper'
import { Sheet } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
import { CASE_STEPS, TERMS, type TermKey } from '@/lib/court'

const GROUPS: Array<{ id: string; title: string; keys: TermKey[] }> = [
  { id: 'people', title: 'People', keys: ['judge', 'juror', 'parties'] },
  { id: 'case', title: 'The case', keys: ['case', 'docket', 'question', 'exhibit', 'instructions'] },
  { id: 'proceedings', title: 'Proceedings', keys: ['hearing', 'testimony', 'summons', 'worksheet', 'file', 'unseal'] },
  { id: 'outcome', title: 'The outcome', keys: ['findings', 'checks', 'record', 'judgment', 'certified'] },
]

export default function GlossaryPage() {
  return (
    <Page>
      <PageHeader
        eyebrow="Glossary"
        title="The words of the court, in plain terms"
        description="Model Court borrows courtroom words to make the steps easy to follow. Anything about your API keys, costs, consent, or deleting data is always written in plain words."
        actions={
          <Button variant="outline" render={<Link to="/sample" />} nativeButton={false}>
            Try the sample case
          </Button>
        }
      />
      <Sheet>
        <div className="space-y-10 px-5 pt-7 pb-10 sm:px-8">
          <section aria-labelledby="steps">
            <h2 id="steps" className="court-label">
              How a case proceeds
            </h2>
            <ol className="mt-3 grid gap-2 sm:grid-cols-5">
              {CASE_STEPS.map((step, index) => (
                <Panel as="li" key={step.key} className="px-3 py-2.5">
                  <div className="typewriter text-caption font-medium text-muted-foreground">STEP {index + 1}</div>
                  <div className="font-heading font-bold">{step.name}</div>
                  <div className="text-xs text-muted-foreground">{step.plain}</div>
                </Panel>
              ))}
            </ol>
          </section>
          {GROUPS.map((group) => (
            <section key={group.id} aria-labelledby={`terms-${group.id}`}>
              <h2 id={`terms-${group.id}`} className="court-label">
                {group.title}
              </h2>
              <dl className="mt-2 divide-y divide-paper-rule">
                {group.keys.map((key) => {
                  const entry = TERMS[key]
                  return (
                    <div key={key} id={`term-${key}`} className="grid scroll-mt-20 gap-1 py-3.5 sm:grid-cols-[12rem_1fr] sm:gap-6">
                      <dt>
                        <span className="font-heading text-base font-bold">{entry.term}</span>
                        <span className="block text-xs text-muted-foreground">{entry.plain}</span>
                      </dt>
                      <dd className="font-heading text-reading leading-relaxed">{entry.explain}</dd>
                    </div>
                  )
                })}
              </dl>
            </section>
          ))}
        </div>
      </Sheet>
    </Page>
  )
}
