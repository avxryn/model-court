import { Skeleton } from '@/components/ui/skeleton'

export function PageSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-label={label}>
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
    </div>
  )
}
