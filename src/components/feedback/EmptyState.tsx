import type { ReactNode } from 'react'
import { EmptyFolder } from '@/components/court/EmptyFolder'

/** Designed empty state: an empty case folder, what is empty and why, and the next step. */
export function EmptyState({ title, children, actions }: { title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="paper rounded-sm px-6 py-12 text-center">
      <EmptyFolder className="mx-auto h-24 w-auto" />
      <h2 className="mt-5 text-xl font-semibold">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
