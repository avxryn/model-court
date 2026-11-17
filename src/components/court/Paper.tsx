/** Small paper surfaces used inside a sheet: plain glosses, exhibit panels, quiet notes and dashed slips. */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A court term's plain meaning in brackets after a label: "Findings (scores)". */
export function Plain({ children }: { children: ReactNode }) {
  return <span className="inline-block font-sans text-xs font-normal tracking-normal text-muted-foreground normal-case">({children})</span>
}

/** A white exhibit-edged panel inside a sheet: lists, tables, side notes. */
export function Panel({ as: Tag = 'div', className, children }: { as?: 'div' | 'section' | 'article' | 'ul' | 'ol' | 'li'; className?: string; children: ReactNode }) {
  return <Tag className={cn('exhibit-panel', className)}>{children}</Tag>
}

/** A quiet note on a slip: empty lists and short explanations. */
export function Note({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('rounded-[2px] bg-slip px-5 py-4 text-sm text-muted-foreground', className)}>{children}</p>
}

/**
 * A dashed instruction slip with an optional court label: advice, jury
 * instructions, and lists of things still to do.
 */
export function Slip({ title, icon, className, children, ...rest }: { title?: ReactNode; icon?: ReactNode; className?: string; children: ReactNode } & Record<`aria-${string}`, string | undefined>) {
  return (
    <section {...rest} className={cn('rounded-[2px] border border-dashed border-slip-edge bg-slip px-5 py-4', className)}>
      {title && (
        <h3 className="flex items-center gap-2 font-heading text-sm font-bold">
          {icon}
          {title}
        </h3>
      )}
      <div className={cn('text-sm leading-relaxed text-foreground/80', title && 'mt-2')}>{children}</div>
    </section>
  )
}

/** A bulleted list on a slip, with stamp-red markers. */
export function SlipList({ items, className }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={cn('list-disc space-y-1 pl-5 marker:text-stamp', className)}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}
