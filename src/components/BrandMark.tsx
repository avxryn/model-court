/** Wordmark: a small gavel-less "scales" glyph drawn with two pans. Decorative; the text names the app. */
export function BrandMark({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const box = size === 'lg' ? 'size-9' : 'size-7'
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`${box} grid place-items-center rounded-md bg-primary text-primary-foreground`}>
        <svg viewBox="0 0 24 24" className="size-[70%]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v16M7 20h10M5 7h14" />
          <path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0L5 7zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7z" />
        </svg>
      </span>
      <span className={`font-heading font-semibold tracking-tight ${size === 'lg' ? 'text-xl' : 'text-base'}`}>Model Court</span>
    </span>
  )
}
