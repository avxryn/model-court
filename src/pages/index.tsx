/**
 * Static landing page (scaffold contract: no providers, no data or auth hooks,
 * deterministic for prerendering).
 */

import { Link } from 'react-router-dom'
import { ArrowRight, EyeOff, Gavel, KeyRound, ListChecks, Lock } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Seo } from '@/components/Seo'
import { seo } from '@/seo'
import { Button } from '@/components/ui/button'
import { SAMPLE_CASES } from '@/sample/fixture'
import { cn } from '@/lib/utils'

const STEPS = [
  { icon: ListChecks, title: 'Build the case file', text: 'Up to five questions with reference evidence and a scoring guide only the judge and jurors see. Two configurations, one fixed rubric.' },
  { icon: KeyRound, title: 'Generate with your keys', text: 'Responses come from OpenAI and Anthropic using your own API keys, billed to your provider accounts. No platform credits.' },
  { icon: EyeOff, title: 'Review blind', text: 'You, the judge, and up to three jurors score shuffled, unlabeled responses. Nobody sees others’ ratings early.' },
  { icon: Gavel, title: 'Reveal and decide', text: 'See the mapping, the jury’s findings, failures, and disagreements — then record a verdict with your reasons.' },
]

const DATA_HANDLING = [
  'Live runs require your own OpenAI and/or Anthropic API key. The selected providers receive each case’s input, reference, and the system instructions, and bill your account.',
  'Scoring guides, ratings, juror identities, invitations, and verdicts are never sent to models.',
  'Keys are encrypted at rest and never shown again; the trusted deployment operator still holds the decryption root. Jurors never need a key.',
  'Deleting an evaluation removes it from Model Court within 24 hours; it cannot delete data a provider already received. Use synthetic or permitted information only.',
]

export default function Landing() {
  return (
    <div data-testid="static-landing" className="min-h-screen bg-background">
      <Seo {...seo} path="/" />
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandMark />
          <Button variant="ghost" size="sm" render={<Link to="/evaluations" />} nativeButton={false}>
            Sign in
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-14 pb-16 sm:pt-20 sm:pb-20">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.16em] text-accent-foreground uppercase">
            <span aria-hidden className="h-px w-8 bg-brass" />
            Put AI to the test
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl leading-tight font-semibold tracking-tight sm:text-5xl sm:leading-tight">Compare AI configurations through blind human review — and record a decision you can defend.</h1>
          <div className="mt-10 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                Model Court keeps the inputs, hides which model wrote what, and preserves every rating and failure, so the verdict rests on the actual responses rather than a few impressive demos.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" className="h-10 px-4" render={<Link to="/sample" />} nativeButton={false}>
                  Explore the sample <ArrowRight data-icon="inline-end" aria-hidden />
                </Button>
                <Button size="lg" variant="outline" className="h-10 px-4" render={<Link to="/evaluations" />} nativeButton={false}>
                  Create an evaluation
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">The sample needs no account or keys and sends nothing to any AI provider.</p>
            </div>
            <Specimen />
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-border py-16">
          <h2 id="how" className="text-2xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="border-t border-foreground/15 pt-5">
                <div aria-hidden className="flex items-center justify-between">
                  <span className="font-heading text-3xl text-accent-foreground tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  <Icon className="size-5 text-muted-foreground" />
                </div>
                <h3 className="mt-4 text-lg font-semibold">
                  <span className="sr-only">{index + 1}. </span>
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="data" className="mb-16 grid gap-8 rounded-2xl bg-secondary/70 p-6 ring-1 ring-foreground/5 sm:mb-20 sm:p-10 lg:grid-cols-3 lg:gap-12">
          <div>
            <h2 id="data" className="text-2xl font-semibold tracking-tight">
              What goes where
            </h2>
            <span aria-hidden className="mt-4 block h-px w-8 bg-brass" />
          </div>
          <ul className="divide-y divide-foreground/10 text-sm leading-relaxed text-foreground/80 lg:col-span-2">
            {DATA_HANDLING.map((item) => (
              <li key={item} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brass" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <BrandMark />
          <p>Model Court · a decision aid, not a benchmark or certification.</p>
        </div>
      </footer>
    </div>
  )
}

/**
 * A static picture of one blind case from the illustrative sample: two
 * unlabeled responses, each scored on the fixed rubric, identities sealed.
 * Exposed to assistive tech as a single image with a text description.
 */
const SPECIMEN_CASE = SAMPLE_CASES[1]
const SPECIMEN_SCORES: Record<'A' | 'B', [number, number, number]> = { A: [2, 2, 2], B: [0, 1, 0] }

function Specimen() {
  return (
    <div
      role="img"
      aria-label="Illustration from the sample: two anonymous responses to one case, each scored 0 to 2 on correctness, completeness, and grounding, with model identities hidden until reveal."
      className="surface relative overflow-hidden p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="eyebrow">Case 2 of 5</div>
          <div className="mt-1 font-heading text-lg leading-snug font-semibold">{SPECIMEN_CASE.title}</div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground ring-1 ring-brass/25">
          <Lock className="size-3" />
          Identities sealed
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {SPECIMEN_CASE.responses.map((response) => (
          <div key={response.responseId} className="rounded-lg bg-secondary/70 p-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="grid size-6 place-items-center rounded-full bg-primary text-xs text-primary-foreground">{response.label}</span>
              Response {response.label}
            </div>
            <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-foreground/80">{response.text}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
              {(['Correctness', 'Completeness', 'Grounding'] as const).map((dimension, i) => (
                <div key={dimension}>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{dimension}</span>
                    <span className="hidden font-medium text-foreground tabular-nums sm:inline">{SPECIMEN_SCORES[response.label][i]}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {[1, 2].map((step) => (
                      <span key={step} className={cn('h-1 flex-1 rounded-full', step <= SPECIMEN_SCORES[response.label][i] ? 'bg-primary' : 'bg-foreground/10')} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
