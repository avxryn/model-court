/**
 * Base64 and document byte rules (spec 04 §4.2, §8.3). Pure; works in Workers and browsers.
 * Documents are stored as base64 TEXT chunks of at most 512 KiB, each a multiple of 4 characters,
 * so chunks join back into one valid base64 string without re-encoding.
 */

export const CHUNK_BASE64_CHARS = 512 * 1024

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Splits base64 into chunks of `size` characters (a multiple of 4); the last may be shorter. */
export function chunkBase64(base64: string, size: number = CHUNK_BASE64_CHARS): string[] {
  if (size <= 0 || size % 4 !== 0) throw new Error('Chunk size must be a positive multiple of 4')
  const chunks: string[] = []
  for (let i = 0; i < base64.length; i += size) chunks.push(base64.slice(i, i + size))
  return chunks
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number, to: number): number {
  outer: for (let i = Math.max(0, from); i <= Math.min(haystack.length, to) - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

const ascii = (text: string) => new TextEncoder().encode(text)

export type PdfSniff = { ok: true } | { ok: false; reason: 'not_pdf' | 'truncated' | 'encrypted' | 'too_large' | 'empty' }

/**
 * The cheap byte checks the upload route makes (spec 04 §8.3). No parsing: `%PDF-1.` in the
 * first 1,024 bytes, `%%EOF` in the last 1,024, and no `/Encrypt` key in the last 64 KiB (a
 * heuristic: a miss only produces the provider's own refusal).
 */
export function sniffPdf(bytes: Uint8Array, maxBytes: number): PdfSniff {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > maxBytes) return { ok: false, reason: 'too_large' }
  if (indexOfBytes(bytes, ascii('%PDF-1.'), 0, 1024) < 0) return { ok: false, reason: 'not_pdf' }
  if (indexOfBytes(bytes, ascii('%%EOF'), bytes.length - 1024, bytes.length) < 0) return { ok: false, reason: 'truncated' }
  if (indexOfBytes(bytes, ascii('/Encrypt'), bytes.length - 64 * 1024, bytes.length) >= 0) return { ok: false, reason: 'encrypted' }
  return { ok: true }
}
