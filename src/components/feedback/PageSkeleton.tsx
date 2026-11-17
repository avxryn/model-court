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
      <div className="folder-back rounded-lg bg-manila pt-2 pr-1.5 pb-1.5 pl-2.5 sm:pt-5 sm:pr-5 sm:pb-6 sm:pl-8">
        <div className="mb-px flex gap-1">
          {[24, 20, 22].map((w, i) => (
            <div key={i} className="h-8 rounded-t-md bg-tab-idle" style={{ width: `${w * 4}px` }} />
          ))}
        </div>
        <div className="paper rounded-sm px-5 pt-7 pb-10 sm:px-8 sm:pl-16">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <div className="mt-5 grid gap-6 border-y border-paper-rule py-5 sm:grid-cols-[3fr_2fr]">
            <div className="space-y-3">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-7 w-64 max-w-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="space-y-2.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-48 max-w-full" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          </div>
          <div className="mt-6 space-y-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </div>
    </>
  )
}
