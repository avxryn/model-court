/** Page frame, page heading and breadcrumbs, shared by every signed-in screen. */

import { Fragment, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { cn } from '@/lib/utils'

export function Page({ children, width = 'default' }: { children: ReactNode; width?: 'default' | 'wide' | 'narrow' }) {
  return <div className={cn('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 xl:px-10', width === 'wide' ? 'max-w-7xl' : width === 'narrow' ? 'max-w-2xl' : 'max-w-4xl')}>{children}</div>
}

export interface Crumb {
  label: ReactNode
  to?: string
}

/** Where this page sits: Your cases › the case › the hearing. The last crumb is the current page. */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  return (
    <Breadcrumb aria-label="Breadcrumb" className={cn('mb-3 min-w-0 print:hidden', className)}>
      <BreadcrumbList className="min-w-0 gap-x-1.5 gap-y-1">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <Fragment key={index}>
              {index > 0 && (
                <BreadcrumbSeparator className="text-mark">
                  <ChevronRight />
                </BreadcrumbSeparator>
              )}
              <BreadcrumbItem className="min-w-0">
                {item.to && !last ? (
                  <BreadcrumbLink render={<Link to={item.to} />} className="max-w-[16rem] truncate rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                    {item.label}
                  </BreadcrumbLink>
                ) : last ? (
                  <BreadcrumbPage className="max-w-[20rem] truncate">{item.label}</BreadcrumbPage>
                ) : (
                  <span className="max-w-[20rem] truncate">{item.label}</span>
                )}
              </BreadcrumbItem>
            </Fragment>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/**
 * The heading of every page that is not a case file: breadcrumbs, a court
 * label, one title size, a short description, and the page's actions.
 */
export function PageHeader({ crumbs, eyebrow, title, description, actions }: { crumbs?: Crumb[]; eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <div className="text-sm font-medium text-muted-foreground">{eyebrow}</div>}
          <h1 className="font-display text-3xl leading-tight font-medium tracking-tight text-foreground">{title}</h1>
          {description && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}
