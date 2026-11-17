/**
 * Static landing page (scaffold contract: no providers, no data or auth hooks,
 * deterministic for prerendering). The account chip reads a local display
 * hint after hydration, never the session (src/lib/account-hint.ts).
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { ExhibitSticker, Stamp } from '@/components/court/CaseFile'
import { Seo } from '@/components/Seo'
import { AccountChip } from '@/components/shell/AccountChip'
import { readAccountHint, type AccountHint } from '@/lib/account-hint'
import { seo } from '@/seo'
import { Button } from '@/components/ui/button'
import { SAMPLE_CASES } from '@/sample/fixture'
import { cn } from '@/lib/utils'

const STEPS = [
  { title: 'File the case', plain: 'Set up', text: 'Up to five questions, each with an exhibit (reference evidence) and jury instructions (a scoring guide only the judge and jurors see). Two parties, one fixed rubric.' },
  { title: 'Hear testimony', plain: 'Generate', text: 'Each party answers using your own OpenAI or Anthropic API key, billed to your provider account. No platform credits.' },
  { title: 'Deliberate', plain: 'Review blind', text: 'You and up to three jurors score shuffled, unlabeled answers. Nobody sees anyone else’s ratings early.' },
  { title: 'Unseal the record', plain: 'Reveal', text: 'See which party gave which testimony, the jury’s findings, failures, and disagreements.' },
  { title: 'Enter judgment', plain: 'Decide', text: 'Record your decision and your reasons. It may disagree with the numbers; say why.' },
]

const DATA_HANDLING = [
  'Live hearings require your own OpenAI and/or Anthropic API key. The selected providers receive each case’s input, reference, and the system instructions, and bill your account.',
  'Scoring guides, ratings, juror identities, invitations, and verdicts are never sent to models.',
  'Keys are encrypted at rest and never shown again; the trusted deployment operator still holds the decryption root. Jurors never need a key.',
  'Deleting a case removes it from Model Court within 24 hours; it cannot delete data a provider already received. Use synthetic or permitted information only.',
]

export default function Landing() {
  // Read after hydration so the prerendered HTML (always "Sign in") matches the first client render.
  const [hint, setHint] = useState<AccountHint | null>(null)
  useEffect(() => setHint(readAccountHint()), [])
  return (
    <div data-testid="static-landing" className="min-h-screen bg-desk">
      <Seo {...seo} path="/" />
      <header className="border-b border-drawer-edge bg-drawer">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <BrandMark />
          <nav aria-label="Public" className="hidden items-center gap-1 sm:flex">
            <Link to="/sample" className="rounded-md px-2.5 py-1.5 text-sm text-foreground/80 outline-none hover:bg-paper/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              Sample case
            </Link>
            <Link to="/glossary" className="rounded-md px-2.5 py-1.5 text-sm text-foreground/80 outline-none hover:bg-paper/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
              Glossary
            </Link>
          </nav>
          <div className="ml-auto">
            <AccountChip hint={hint} />
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-14 pb-16 sm:pt-20 sm:pb-20">
          <p className="typewriter flex items-center gap-3 text-xs font-bold text-stamp">
            <span aria-hidden className="h-px w-8 bg-stamp" />
            THE COURT IS NOW IN SESSION
          </p>
          <h1 className="mt-5 max-w-4xl font-heading text-4xl leading-tight font-bold sm:text-5xl sm:leading-tight">Put AI on trial. Let a blind jury weigh the testimony — and enter a judgment you can defend.</h1>
          <div className="mt-10 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                Model Court compares two AI setups on your own questions. It hides which model wrote what, keeps every rating and failure on the record, and lets the decision rest on the actual answers rather than a few impressive demos.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button size="lg" className="h-10 px-4" render={<Link to="/sample" />} nativeButton={false}>
                  Try the sample case <ArrowRight data-icon="inline-end" aria-hidden />
                </Button>
                <Button size="lg" variant="outline" className="h-10 px-4" render={<Link to="/evaluations" />} nativeButton={false}>
                  Open your own case
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">The sample needs no account or keys and sends nothing to any AI provider.</p>
            </div>
            <Specimen />
          </div>
        </section>

        <section aria-labelledby="how" className="border-t border-paper-edge/70 py-16">
          <h2 id="how" className="font-heading text-2xl font-bold">
            How a case proceeds
          </h2>
          <ol className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map(({ title, plain, text }, index) => (
              <li key={title} className="border-t-2 border-foreground pt-4">
                <div aria-hidden className="typewriter text-xs font-bold text-stamp">
                  STEP {index + 1}
                </div>
                <h3 className="mt-2 font-heading text-lg font-bold">
                  <span className="sr-only">{index + 1}. </span>
                  {title}
                </h3>
                <div className="text-xs text-muted-foreground">{plain}</div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-sm text-muted-foreground">
            New to the terms? <Link to="/glossary" className="underline underline-offset-4 hover:text-foreground">Read the glossary</Link>.
          </p>
        </section>

        <section aria-labelledby="data" className="paper mb-16 grid gap-8 rounded-[2px] p-6 sm:mb-20 sm:p-10 lg:grid-cols-3 lg:gap-12">
          <div>
            <h2 id="data" className="font-heading text-2xl font-bold">
              What goes where
            </h2>
            <span aria-hidden className="mt-4 block h-px w-8 bg-stamp" />
          </div>
          <ul className="divide-y divide-foreground/10 text-sm leading-relaxed text-foreground/80 lg:col-span-2">
            {DATA_HANDLING.map((item) => (
              <li key={item} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
                <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-stamp" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-paper-edge/70">
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
      aria-label="Illustration from the sample: two anonymous testimonies to one question, each scored 0 to 2 on correctness, completeness, and grounding, with the parties sealed until the record is unsealed."
      className="paper relative overflow-hidden rounded-[2px] p-5 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="court-label">
            Question presented <span className="typewriter font-normal tracking-normal whitespace-nowrap">· 2 OF 5</span>
          </div>
          <div className="mt-1 font-heading text-lg leading-snug font-bold">{SPECIMEN_CASE.title}</div>
        </div>
        <Stamp kind="sealed" size="sm" />
      </div>
      <div className="mt-5 space-y-3">
        {SPECIMEN_CASE.responses.map((response) => (
          <div key={response.responseId} className="rounded-[2px] bg-white p-4 ring-1 ring-exhibit-edge">
            <div className="flex items-center gap-2">
              <ExhibitSticker className="bg-foreground text-paper">TESTIMONY {response.label}</ExhibitSticker>
            </div>
            <p className="mt-2 line-clamp-2 font-heading text-[0.9375rem] leading-relaxed text-foreground/85">{response.text}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
              {(['Correctness', 'Completeness', 'Grounding'] as const).map((dimension, i) => (
                <div key={dimension}>
                  <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{dimension}</span>
                    <span className="hidden font-medium text-foreground tabular-nums sm:inline">{SPECIMEN_SCORES[response.label][i]}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {[1, 2].map((step) => (
                      <span key={step} className={cn('h-1 flex-1 rounded-full', step <= SPECIMEN_SCORES[response.label][i] ? 'bg-foreground' : 'bg-foreground/10')} />
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
