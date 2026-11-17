import { useState } from 'react'
import { toast } from 'sonner'
import { describeError } from '@/lib/api-client'

export type Act = (fn: () => Promise<unknown>, success: string, onDone?: () => void) => Promise<void>

/** One hearing action at a time: toast the outcome, then reload the hearing either way. */
export function useHearingAction(reload: () => Promise<void>): { busy: boolean; act: Act } {
  const [busy, setBusy] = useState(false)
  const act: Act = async (fn, success, onDone) => {
    setBusy(true)
    try {
      await fn()
      toast.success(success)
      onDone?.()
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
      await reload()
    }
  }
  return { busy, act }
}
