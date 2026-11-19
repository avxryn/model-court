import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, CHUNK_BASE64_CHARS, chunkBase64, sniffPdf } from './bytes'

const minimal = (trailer = '') => new TextEncoder().encode(['%PDF-1.4', '1 0 obj << /Type /Catalog >> endobj', `trailer << /Root 1 0 R${trailer} >>`, '%%EOF', ''].join('\n'))
const fixture = (name: string) => (name === 'encrypted.pdf' ? minimal(' /Encrypt << /V 1 >>') : minimal())

describe('base64 chunks', () => {
  it('round-trips bytes, and chunks join back into the same base64', () => {
    const bytes = new Uint8Array(200_001).map((_, i) => (i * 31) % 256)
    const base64 = bytesToBase64(bytes)
    const chunks = chunkBase64(base64, 4 * 1000)
    expect(chunks.every((chunk, i) => i === chunks.length - 1 || chunk.length === 4000)).toBe(true)
    expect(chunks.every((chunk) => chunk.length % 4 === 0)).toBe(true)
    expect(chunks.join('')).toBe(base64)
    expect([...base64ToBytes(chunks.join(''))]).toEqual([...bytes])
    expect(CHUNK_BASE64_CHARS % 4).toBe(0)
    expect(() => chunkBase64(base64, 3)).toThrow()
  })

  it('a 4 MiB PDF fits in 16 chunks', () => {
    expect(Math.ceil(Math.ceil((4 * 1024 * 1024) / 3) * 4 / CHUNK_BASE64_CHARS)).toBeLessThanOrEqual(16)
  })
})

describe('sniffPdf', () => {
  it('accepts the fixture and refuses the encrypted one', () => {
    expect(sniffPdf(fixture('invoice-1p.pdf'), 4 * 1024 * 1024)).toEqual({ ok: true })
    expect(sniffPdf(fixture('encrypted.pdf'), 4 * 1024 * 1024)).toEqual({ ok: false, reason: 'encrypted' })
  })

  it('checks the header, the trailer and the size', () => {
    const pdf = fixture('invoice-1p.pdf')
    expect(sniffPdf(new TextEncoder().encode('hello %%EOF'), 1000)).toEqual({ ok: false, reason: 'not_pdf' })
    expect(sniffPdf(pdf.slice(0, pdf.length - 8), 1e6)).toEqual({ ok: false, reason: 'truncated' })
    expect(sniffPdf(pdf, pdf.length - 1)).toEqual({ ok: false, reason: 'too_large' })
    expect(sniffPdf(new Uint8Array(0), 10)).toEqual({ ok: false, reason: 'empty' })
  })
})
