/** Wordmark: the scales, drawn to read at 16 px (the same drawing as public/favicon.svg). Decorative; the text names the app. */
export function BrandMark({ size = 'sm', textClassName }: { size?: 'sm' | 'lg'; textClassName?: string }) {
  const box = size === 'lg' ? 'size-9' : 'size-7'
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`${box} grid place-items-center rounded-md bg-primary text-primary-foreground`}>
        <svg viewBox="0 0 24 24" className="size-[82%]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4.5v14M7.5 19h9M4 7.5h16" strokeWidth="2.2" />
          <path d="M6 7.5v5M18 7.5v5" strokeWidth="1.4" />
          <path d="M2.5 12.5h7a3.5 3.5 0 0 1-7 0zM14.5 12.5h7a3.5 3.5 0 0 1-7 0z" fill="currentColor" strokeWidth="1" />
          <circle cx="12" cy="4" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      </span>
      <span className={`font-display font-medium tracking-[-0.01em] ${size === 'lg' ? 'text-2xl' : 'text-lg'} ${textClassName ?? ''}`}>Model Court</span>
    </span>
  )
}
