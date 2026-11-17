import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** Designed empty state: what is empty, why, and the next step. */
export function EmptyState({ icon: Icon, title, children, actions }: { icon: LucideIcon; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="paper rounded-sm px-6 py-14 text-center">
      <span aria-hidden className="mx-auto grid size-12 place-items-center rounded-full bg-accent text-accent-foreground ring-1 ring-brass/25">
        <Icon className="size-5" />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
