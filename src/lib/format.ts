/** Display formatting shared by every screen. */

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ms)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** "1 question", "3 questions"; pass `many` for irregular plurals. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
