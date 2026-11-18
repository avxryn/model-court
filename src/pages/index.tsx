/**
 * Static landing page (scaffold contract: no providers, no data or auth hooks,
 * deterministic for prerendering). The account chip reads a local display
 * hint after hydration, never the session (src/lib/account-hint.ts).
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, EyeOff, KeyRound, Lock, Trash2, type LucideIcon } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { DocketSpread } from '@/components/landing/DocketSpread'
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

const DATA_HANDLING: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: KeyRound, title: 'Your key, your provider bill', text: 'Live hearings require your own OpenAI and/or Anthropic API key. The selected providers receive each case’s input, reference, and the system instructions, and bill your account.' },
  { icon: EyeOff, title: 'Kept from models', text: 'Scoring guides, ratings, juror identities, invitations, and verdicts are never sent to models.' },
  { icon: Lock, title: 'Keys at rest', text: 'Keys are encrypted at rest and never shown again; the trusted deployment operator still holds the decryption root. Jurors never need a key.' },
  { icon: Trash2, title: 'Deleting a case', text: 'Deleting a case removes it from Model Court within 24 hours; it cannot delete data a provider already received. Use synthetic or permitted information only.' },
]

/** Same width and gutters as the app's wide pages (src/components/layout/Page.tsx). */
const CONTAINER = 'mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10'

const NAV_LINK = 'rounded-md px-1 py-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50'

export default function Landing() {
  // Read after hydration so the prerendered HTML (always "Sign in") matches the first client render.
  const [hint, setHint] = useState<AccountHint | null>(null)
  useEffect(() => setHint(readAccountHint()), [])
  return (
    <div data-testid="static-landing" className="flex min-h-screen flex-col bg-background text-foreground">
      <Seo {...seo} path="/" />
      <header className="border-b border-border bg-background">
        <div className={cn(CONTAINER, 'flex h-16 items-center gap-7')}>
          <Link to="/" className="flex rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandMark />
          </Link>
          <nav aria-label="Public" className="hidden items-center gap-5 md:flex">
            <a href="#how" className={NAV_LINK}>
              How it works
            </a>
            <Link to="/sample" className={NAV_LINK}>
              Sample case
            </Link>
            <Link to="/glossary" className={NAV_LINK}>
              Glossary
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2.5">
            <AccountChip hint={hint} />
            <Button size="sm" className="hidden sm:inline-flex" render={<Link to="/sample" />} nativeButton={false}>
              Try the sample
            </Button>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section className={cn(CONTAINER, 'grid items-center gap-12 pt-14 pb-16 sm:pt-20 sm:pb-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14')}>
          <div>
            <p className="font-mono text-xs font-medium tracking-[0.06em] text-stamp uppercase">Blind review for AI answers</p>
            <h1 className="mt-5 font-display text-[2.75rem] leading-[1.04] font-medium tracking-[-0.02em] text-balance sm:text-6xl sm:leading-[1.02]">
              Put AI on trial. <em className="text-stamp italic">Let the record decide.</em>
            </h1>
            <p className="mt-5 max-w-[30em] text-[1.0625rem] leading-relaxed text-muted-foreground">
              Compare two AI setups on your own questions. Jurors score the answers without knowing which model wrote them, and the record unseals only when you say so.
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              <Button size="lg" className="h-10 px-4" render={<Link to="/sample" />} nativeButton={false}>
                Try the sample case <ArrowRight data-icon="inline-end" aria-hidden />
              </Button>
              <Button size="lg" variant="outline" className="h-10 px-4" render={<Link to="/evaluations" />} nativeButton={false}>
                Open your own case
              </Button>
            </div>
            <p className="mt-4 text-small text-muted-foreground">No account needed for the sample, and it sends nothing to any AI provider. Live hearings use your own OpenAI or Anthropic key.</p>
          </div>
          <DocketSpread />
        </section>

        <section id="how" aria-labelledby="how-title" className="scroll-mt-6 border-t border-border">
          <div className={cn(CONTAINER, 'py-16 sm:py-20')}>
            <h2 id="how-title" className="font-display text-3xl font-medium tracking-[-0.02em]">
              How a case proceeds
            </h2>
            <ol className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
              {STEPS.map(({ title, plain, text }, index) => (
                <li key={title}>
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full border border-input bg-card font-mono text-xs font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    {index < STEPS.length - 1 && <span aria-hidden className="hidden h-px flex-1 bg-border lg:block" />}
                  </div>
                  <h3 className="mt-4 font-display text-xl leading-snug font-medium tracking-[-0.01em]">
                    <span className="sr-only">{index + 1}. </span>
                    {title}
                  </h3>
                  <div className="mt-0.5 text-small text-muted-foreground">{plain}</div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ol>
            <p className="mt-10 text-sm text-muted-foreground">
              New to the terms?{' '}
              <Link to="/glossary" className="text-foreground underline underline-offset-4 hover:text-primary">
                Read the glossary
              </Link>
              .
            </p>
          </div>
        </section>

        <section aria-labelledby="data" className={cn(CONTAINER, 'pb-16 sm:pb-20')}>
          <div className="grid gap-8 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-[var(--paper-shadow)] sm:p-8 lg:grid-cols-3 lg:gap-12">
            <div>
              <h2 id="data" className="font-display text-3xl font-medium tracking-[-0.02em]">
                What goes where
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">What leaves Model Court, what never does, and who pays for it.</p>
            </div>
            <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:col-span-2">
              {DATA_HANDLING.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    {title}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className={cn(CONTAINER, 'flex flex-col items-start justify-between gap-3 py-6 text-small text-muted-foreground sm:flex-row sm:items-center')}>
          <BrandMark />
          <div className="space-y-1.5 sm:text-right">
            <p>A decision aid, not a benchmark or certification. Not affiliated with or endorsed by OpenAI or Anthropic.</p>
            <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1 sm:justify-end">
              <Link to="/privacy" className={NAV_LINK}>
                Privacy
              </Link>
              <Link to="/terms" className={NAV_LINK}>
                Terms
              </Link>
              <Link to="/accessibility" className={NAV_LINK}>
                Accessibility
              </Link>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  )
}
