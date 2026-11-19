// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import { loadPdfjs, PdfReadError, readPdf } from './pdf'

// pdf.js 6 uses Uint8Array#toHex (ES2025), which current browsers ship and Node 24 does not yet: test-only polyfill.
const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string }
proto.toHex ??= function (this: Uint8Array) {
  return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// The fixture is the one the PDF smoke mode sends (tests/fixtures/extraction/invoice-1p.pdf). The app's types
// have no Node modules, so the reader is imported by a computed name.
async function fixture(name: string): Promise<ArrayBuffer> {
  const url = new URL(`../../tests/fixtures/extraction/${name}`, import.meta.url)
  const fsModule = 'node:fs/promises'
  const { readFile } = (await import(/* @vite-ignore */ fsModule)) as { readFile: (path: URL) => Promise<Uint8Array> }
  const bytes = await readFile(url)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('readPdf (pdf.js in the browser; here in Node)', () => {
  beforeAll(async () => {
    // In the browser the worker is the app's own bundled file; in Node, point pdf.js at the package's copy.
    const pdfjs = await loadPdfjs()
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href
  })

  it('counts pages and extracts the text layer', async () => {
    const facts = await readPdf(await fixture('invoice-1p.pdf'))
    expect(facts.pageCount).toBe(1)
    expect(facts.hasTextLayer).toBe(true)
    expect(facts.text).toContain('INVOICE NW-2291')
    expect(facts.text).toContain('Total due: USD 412.50')
  })

  it('refuses bytes that are not a PDF', async () => {
    await expect(readPdf(new TextEncoder().encode('not a pdf').buffer as ArrayBuffer)).rejects.toBeInstanceOf(PdfReadError)
  })
})
