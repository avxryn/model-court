/**
 * Lets a page tell the shell which case and hearing it shows, so the sidebar
 * can open that case's folder and highlight the hearing. Pages call
 * useShellFocus once they have loaded; the focus clears when they unmount.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface ShellFocus {
  caseId?: string
  runId?: string
}

const Ctx = createContext<{ focus: ShellFocus; setFocus: (focus: ShellFocus) => void } | null>(null)

export function ShellProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<ShellFocus>({})
  const value = useMemo(() => ({ focus, setFocus }), [focus])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useShellFocusValue(): ShellFocus {
  return useContext(Ctx)?.focus ?? {}
}

export function useShellFocus(caseId: string | undefined, runId?: string): void {
  const setFocus = useContext(Ctx)?.setFocus
  useEffect(() => {
    if (!setFocus) return
    setFocus({ caseId, runId })
    return () => setFocus({})
  }, [setFocus, caseId, runId])
}
