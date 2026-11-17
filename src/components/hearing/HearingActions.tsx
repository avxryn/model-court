import { useState } from 'react'
import { Ban, MoreHorizontal } from 'lucide-react'
import type { Act } from '@/components/hearing/use-hearing-action'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api-client'
import type { OwnerRunView } from '@/lib/dto'

/** The hearing's ⋯ menu beside the breadcrumbs. Cancelling is only possible before deliberation opens. */
export function HearingActions({ run, busy, act }: { run: OwnerRunView; busy: boolean; act: Act }) {
  const [canceling, setCanceling] = useState(false)
  if (run.status !== 'generating' && run.status !== 'ready') return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="-mt-1 shrink-0" aria-label="Hearing actions" />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => setCanceling(true)}>
            <Ban aria-hidden /> Cancel hearing…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={canceling} onOpenChange={setCanceling}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this hearing?</AlertDialogTitle>
            <AlertDialogDescription>Queued requests are not sent. A request already in flight may still be charged; its output will be discarded. Successful responses stay in the record. You can start a new hearing afterward.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep going</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void act(() => api('POST', `/runs/${run.runId}/cancel`, { body: {}, revision: run.revision }), 'Hearing canceled')}>
              Cancel hearing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
