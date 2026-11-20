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

/** A file or text size in plain units: "under 1 KB", "12 KB", "3.2 MB" (1 KB = 1,024 bytes). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return 'under 1 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`
  return `${(bytes / 1024 / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} MB`
}
