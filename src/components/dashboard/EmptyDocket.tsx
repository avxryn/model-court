import type { ReactNode } from 'react'
import { FolderPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/** No cases at all: one headline, one sentence, start a case or walk through the sample. */
export function EmptyDocket({ newCase }: { newCase: ReactNode }) {
  return (
    <section aria-labelledby="docket-empty" className="paper px-6 py-12 text-center sm:py-16">
      <span aria-hidden className="mx-auto grid size-10 place-items-center rounded-md bg-accent text-accent-foreground">
        <FolderPlus className="size-5" />
      </span>
      <h2 id="docket-empty" className="mt-4 font-display text-2xl font-medium tracking-[-0.02em] text-foreground">
        Open your first case
      </h2>
      <p className="mx-auto mt-2 max-w-md text-small leading-relaxed text-muted-foreground">Start from a template and edit the questions, or walk through the sample case, which needs no keys.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {newCase}
        <Button variant="outline" size="lg" render={<Link to="/sample" />} nativeButton={false}>
          Try the sample case
        </Button>
      </div>
    </section>
  )
}
