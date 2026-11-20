import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { codePointLength } from '@/domain/text'
import { cn } from '@/lib/utils'

/** A labelled text field with a hint or error and a character count against the limit. */
export function CountedField({ id, label, value, onChange, error, max, multiline, rows = 3, hint, className, inputClassName }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; max: number; multiline?: boolean; rows?: number; hint?: string; className?: string; inputClassName?: string }) {
  const count = codePointLength(value)
  const describedBy = `${id}-help`
  const props = { id, value, className: inputClassName, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy }
  return (
    <Field className={cn('gap-1.5', className)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? <Textarea {...props} rows={rows} onChange={(e) => onChange(e.target.value)} /> : <Input {...props} onChange={(e) => onChange(e.target.value)} />}
      <FieldDescription id={describedBy} className={cn('flex justify-between gap-4 text-caption', error && 'text-destructive')}>
        <span>{error ?? hint}</span>
        <span className={cn('tabular-nums', count > max && 'text-destructive')}>
          {count.toLocaleString()}/{max.toLocaleString()}
        </span>
      </FieldDescription>
    </Field>
  )
}
