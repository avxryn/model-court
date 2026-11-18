import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The theme's own type scale (styles.css @theme: caption, small, reading, title).
// Without this, tailwind-merge reads `text-small` as a colour and drops the
// real colour next to it (white text on small primary buttons, for one).
const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: ['caption', 'small', 'reading', 'title'] }] } },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
