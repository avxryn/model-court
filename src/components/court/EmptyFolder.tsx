/**
 * An empty manila folder, drawn from the palette: the back panel with its
 * tab, a single blank sheet inside, and the front flap. Decorative.
 */
export function EmptyFolder({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 160 112" className={className} fill="none">
      {/* Back panel with its label tab. */}
      <path className="fill-manila stroke-paper-edge" strokeWidth="1.25" d="M8 22a4 4 0 0 1 4-4h38l8-8h36a4 4 0 0 1 4 4v4h50a4 4 0 0 1 4 4v80a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z" />
      {/* One blank sheet, ruled, with the red margin. */}
      <g transform="rotate(-3 80 56)">
        <rect className="fill-paper stroke-paper-edge" strokeWidth="1" x="30" y="16" width="100" height="74" rx="1.5" />
        <path className="stroke-margin-rule" strokeWidth="1" d="M42 17v72M44.5 17v72" />
        <path className="stroke-paper-rule" strokeWidth="1.5" strokeLinecap="round" d="M52 32h60M52 42h52M52 52h56M52 62h40" />
      </g>
      {/* Front flap, a shade deeper so the folder reads as open. */}
      <path className="fill-tab-idle stroke-paper-edge" strokeWidth="1.25" d="M4 52a4 4 0 0 1 4-4h144a4 4 0 0 1 4 4.6l-6.3 50A4 4 0 0 1 145.7 106H14.3a4 4 0 0 1-4-3.4l-6.3-50z" />
      <path className="stroke-paper-edge" strokeWidth="1" strokeLinecap="round" d="M60 72h40" opacity="0.7" />
    </svg>
  )
}
