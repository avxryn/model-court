/**
 * A radio group drawn as cards on paper: the chosen card is ruled in ink on a
 * slip. Used for the rubric, the comparison mode, case templates and the
 * judgment. Selection is styled from the radio's own `data-checked`, so a
 * card never needs to be told it is chosen.
 */

import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

export function ChoiceCardGroup({ value, onValueChange, className, children, ...rest }: { value: string | null; onValueChange: (value: string) => void; className?: string; children: ReactNode } & Record<`aria-${string}`, string | undefined>) {
  return (
    <RadioGroup {...rest} value={value} onValueChange={(next) => onValueChange(String(next))} className={cn('grid gap-2', className)}>
      {children}
    </RadioGroup>
  )
}

export function ChoiceCard({ id, value, title, description, disabled, className }: { id: string; value: string; title: ReactNode; description?: ReactNode; disabled?: boolean; className?: string }) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border border-paper-edge bg-exhibit px-3 py-2.5 font-normal transition-colors duration-150 hover:bg-slip/60',
        'has-[[data-checked]]:border-primary has-[[data-checked]]:bg-accent',
        // Unavailable: no hover, muted title, but the reason stays readable (no opacity fade).
        disabled && 'cursor-not-allowed border-paper-rule bg-transparent text-muted-foreground hover:bg-transparent',
        className,
      )}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" aria-labelledby={`${id}-text`} />
      <span id={`${id}-text`} className="leading-snug">
        <span className="block text-sm font-medium">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}
      </span>
    </Label>
  )
}
