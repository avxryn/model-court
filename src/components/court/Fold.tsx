/**
 * A folded part of a sheet: a quiet summary line with a chevron that opens
 * the rest in place. Built on the shadcn Collapsible; the chevron turns only
 * when motion is allowed.
 */

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function Fold({ summary, children, defaultOpen, open, onOpenChange, className, triggerClassName, contentClassName }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; className?: string; triggerClassName?: string; contentClassName?: string }) {
  return (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger
        className={cn(
          'group/fold inline-flex min-h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-sm py-1 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
          triggerClassName,
        )}
      >
        <ChevronRight aria-hidden className="size-3.5 shrink-0 group-data-[panel-open]/fold:rotate-90 motion-safe:transition-transform motion-safe:duration-150" />
        {summary}
      </CollapsibleTrigger>
      <CollapsibleContent className={cn('mt-3', contentClassName)}>{children}</CollapsibleContent>
    </Collapsible>
  )
}
