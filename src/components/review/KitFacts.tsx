/**
 * A question's task-kit facts on the worksheet (spec 03 §4.3, D-79): part of the jury
 * instructions and identical for every party. Never a check result, parsed label or word count.
 */

import { Plain } from '@/components/court/Paper'
import { groundingKeyText } from '@/domain/grounded/sources'
import type { KitJurorCaseView } from '@/domain/kits/types'

export function KitFacts({ view, kitName }: { view: KitJurorCaseView; kitName: string }) {
  return (
    <section aria-label={`${kitName}: what the judge set`} className="rounded-lg border border-border px-4 py-3.5 text-sm">
      <h3 className="court-label">
        {kitName}: what the judge set <Plain>part of the jury instructions</Plain>
      </h3>
      {view.kind === 'summarization' ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-foreground">Length</dt>
          <dd>{view.lengthLimit}</dd>
          {view.format && (
            <>
              <dt className="font-medium text-foreground">Format</dt>
              <dd>{view.format === 'bullets' ? 'Bullet points' : 'A paragraph, no bullet points'}</dd>
            </>
          )}
          {view.requiredPoints.length > 0 && (
            <>
              <dt className="font-medium text-foreground">Must cover</dt>
              <dd>
                <ol className="list-decimal space-y-0.5 pl-5">
                  {view.requiredPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ol>
              </dd>
            </>
          )}
          {view.mustNotMention.length > 0 && (
            <>
              <dt className="font-medium text-foreground">Must not mention</dt>
              <dd>{view.mustNotMention.join(' · ')}</dd>
            </>
          )}
        </dl>
      ) : view.kind === 'grounded' ? (
        <p className="mt-2 text-muted-foreground">{groundingKeyText(view)}</p>
      ) : view.kind === 'tools' ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-foreground">Tools</dt>
          <dd>{view.tools.map((tool) => tool.name).join(' · ')}</dd>
          <dt className="font-medium text-foreground">Step cap</dt>
          <dd>Up to {view.maxSteps} {view.maxSteps === 1 ? 'call' : 'calls'} to its model per party</dd>
        </dl>
      ) : view.kind === 'extraction' ? (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-foreground">Fields</dt>
          <dd>{view.fields.map((field) => (field.mustFill ? field.label : `${field.label} (may be empty)`)).join(' · ')}</dd>
        </dl>
      ) : (
        <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-muted-foreground sm:grid-cols-[auto_1fr]">
          <dt className="font-medium text-foreground">Allowed labels</dt>
          <dd>{view.labels.join(' · ')}</dd>
          <dt className="font-medium text-foreground">Expected label</dt>
          <dd>{view.expectedLabel ? <span className="text-foreground">{view.expectedLabel}</span> : 'No answer key for this question'}</dd>
          {view.alsoAccept.length > 0 && (
            <>
              <dt className="font-medium text-foreground">Also accepted</dt>
              <dd>{view.alsoAccept.join(' · ')}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
