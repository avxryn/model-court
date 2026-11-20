import type { ReactNode } from 'react'

/** The judge's signature line with a note under it, and the stamp beside it. */
export function JudgeSignature({ note, stamp }: { note: ReactNode; stamp?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-56">
        <div className="border-b border-foreground pb-1 font-display text-xl italic">The judge</div>
        <div className="mt-1 text-caption text-muted-foreground">{note}</div>
      </div>
      {stamp}
    </div>
  )
}
