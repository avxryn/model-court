import { Skeleton } from '@/components/ui/skeleton'

/**
 * Placeholders shaped like what is loading, never a spinner. `list`: a page
 * heading and rows of a paper list. `sheet`: breadcrumbs, the folder's
 * divider row, and a case sheet with its court heading and caption box.
 */
export function PageSkeleton({ label = 'Loading', variant = 'list' }: { label?: string; variant?: 'list' | 'sheet' }) {
  return (
    <div aria-busy="true" aria-label={label} role="status">
      {variant === 'sheet' ? <SheetShape /> : <ListShape />}
    </div>
  )
}

function ListShape() {
  return (
    <>
      <div className="mb-8 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-md max-w-full" />
      </div>
      <div className="paper divide-y divide-paper-rule overflow-hidden rounded-sm">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 px-5 py-4">
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </>
  )
}

function SheetShape() {
  return (
    <>
      <Skeleton className="mb-3 h-4 w-56 max-w-full" />
      <div className="mb-5 flex gap-2 border-b border-border pb-2">
        {[24, 20, 22].map((w, i) => (
          <Skeleton key={i} className="h-6" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="paper px-5 pt-6 pb-10 sm:px-8">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-3">
            <Skeleton className="h-8 w-72 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-6 w-28" />
            </div>
          </div>
          <div className="space-y-2.5 md:border-l md:border-border md:pl-6">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-48 max-w-full" />
            <Skeleton className="h-1.5 w-40" />
          </div>
        </div>
        <div className="mt-8 space-y-3 border-t border-border pt-6">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    </>
  )
}
