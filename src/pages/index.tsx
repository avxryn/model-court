/**
 * Static landing page (scaffold contract: no providers, no data or auth hooks,
 * deterministic for prerendering).
 */

import { Link } from 'react-router-dom'
import { EyeOff, Gavel, KeyRound, ListChecks } from 'lucide-react'
import { BrandMark } from '@/components/BrandMark'
import { Seo } from '@/components/Seo'
import { seo } from '@/seo'
import { Button } from '@/components/ui/button'

const STEPS = [
  { icon: ListChecks, title: 'Build the case file', text: 'Up to five questions with reference evidence and a reviewer-only guide. Two configurations, one fixed rubric.' },
  { icon: KeyRound, title: 'Generate with your keys', text: 'Responses come from OpenAI and Anthropic using your own API keys, billed to your provider accounts. No platform credits.' },
  { icon: EyeOff, title: 'Review blind', text: 'You and up to three invited reviewers score shuffled, unlabeled responses. Nobody sees others’ ratings early.' },
  { icon: Gavel, title: 'Reveal and decide', text: 'See the mapping, cohort means, failures, and disagreements — then record a verdict with your reasons.' },
]

export default function Landing() {
  return (
    <div data-testid="static-landing" className="min-h-screen bg-background">
      <Seo {...seo} path="/" />
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <BrandMark />
          <Button variant="ghost" size="sm" render={<Link to="/evaluations" />} nativeButton={false}>
            Sign in
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4">
        <section className="py-16 sm:py-24">
          <p className="text-sm font-medium uppercase tracking-widest text-brass">Put AI to the test</p>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">Compare AI configurations through blind human review — and record a decision you can defend.</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">
            Model Court keeps the inputs, hides which model wrote what, and preserves every rating and failure, so the verdict rests on the actual responses rather than a few impressive demos.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" render={<Link to="/sample" />} nativeButton={false}>
              Explore the sample
            </Button>
            <Button size="lg" variant="outline" render={<Link to="/evaluations" />} nativeButton={false}>
              Create an evaluation
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">The sample needs no account or keys and sends nothing to any AI provider.</p>
        </section>

        <section aria-labelledby="how" className="grid gap-6 border-t border-border py-12 sm:grid-cols-2">
          <h2 id="how" className="sr-only">
            How it works
          </h2>
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <div key={title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-md border border-border bg-card text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-base font-semibold">
                  <span className="text-muted-foreground tabular-nums">{index + 1}.</span> {title}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="data" className="border-t border-border py-12">
          <h2 id="data" className="text-lg font-semibold">
            What goes where
          </h2>
          <ul className="mt-3 max-w-3xl list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Live runs require your own OpenAI and/or Anthropic API key. The selected providers receive each case’s input, reference, and the system instructions, and bill your account.</li>
            <li>Reviewer guides, ratings, reviewer identities, invitations, and verdicts are never sent to models.</li>
            <li>Keys are encrypted at rest and never shown again; the trusted deployment operator still holds the decryption root. Invited reviewers never need a key.</li>
            <li>Deleting an evaluation removes it from Model Court within 24 hours; it cannot delete data a provider already received. Use synthetic or permitted information only.</li>
          </ul>
        </section>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">Model Court · a decision aid, not a benchmark or certification.</footer>
    </div>
  )
}
