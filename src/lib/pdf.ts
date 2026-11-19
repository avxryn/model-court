/**
 * pdf.js for extraction documents (spec 04 §8.3, decision 9, D-90). Loaded lazily, only on
 * screens that show or read a PDF, from the app's own origin (a same-origin worker, so the CSP
 * stays as it is). Configured to close the known classes of PDF attacks: no eval (pdf.js 6 has no
 * eval path left for font programs, the CVE-2024-4367 class), no XFA forms, no scripting, annotations not rendered (no links or
 * forms), no outline navigation. Never an iframe, an <object>, the browser's viewer or a blob URL.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let loading: Promise<typeof import('pdfjs-dist')> | null = null

export function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  loading ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })
  return loading
}

export class PdfReadError extends Error {
  constructor(
    readonly reason: 'encrypted' | 'unreadable',
    message: string,
  ) {
    super(message)
  }
}

/** About 33 million pixels per decoded image, and per drawn page (the pdf.js viewer's own order of magnitude). */
export const MAX_IMAGE_PIXELS = 2 ** 25
export const MAX_CANVAS_PIXELS = 2 ** 24
/** Pages a document may have (spec 04 §10.2); the server cannot count them, so the browser refuses more. */
export const MAX_PAGES = 20

/** Opens a PDF from bytes with the safe options. The caller destroys it. */
export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs()
  try {
    return await pdfjs.getDocument({
      // pdf.js may transfer the buffer to its worker: give it a copy.
      data: new Uint8Array(bytes.slice(0)),
      enableXfa: false,
      // D-91: bound what one hostile file can make a juror's tab decode or draw.
      maxImageSize: MAX_IMAGE_PIXELS,
      canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
      disableFontFace: false,
      useSystemFonts: false,
      stopAtErrors: false,
    }).promise
  } catch (error) {
    if ((error as { name?: string }).name === 'PasswordException') throw new PdfReadError('encrypted', 'This PDF is password-protected. Remove the protection and upload it again.')
    throw new PdfReadError('unreadable', "This file couldn't be opened as a PDF.")
  }
}

export interface PdfFacts {
  pageCount: number
  /** The text layer, pages separated by a blank line (for "Send the text only"). */
  text: string
  /** False when no page has text: probably a scan. */
  hasTextLayer: boolean
}

/** Counts pages and extracts the text layer, in the browser; nothing is uploaded. */
export async function readPdf(bytes: ArrayBuffer): Promise<PdfFacts> {
  const doc = await openPdf(bytes)
  try {
    // D-91: count before reading any text, so a file with thousands of pages costs nothing more.
    if (doc.numPages > MAX_PAGES) return { pageCount: doc.numPages, text: '', hasTextLayer: false }
    const pages: string[] = []
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        text += item.str
        if (item.hasEOL) text += '\n'
        else if (item.str !== '' && !text.endsWith(' ')) text += ' '
      }
      pages.push(text.replace(/[ \t]+\n/gu, '\n').trim())
      page.cleanup()
    }
    return { pageCount: doc.numPages, text: pages.join('\n\n').trim(), hasTextLayer: pages.some((page) => page.length > 0) }
  } finally {
    void doc.loadingTask.destroy()
  }
}

/**
 * Renders one page on a canvas, annotations off, with a text layer for search and selection.
 * The canvas is held under MAX_CANVAS_PIXELS (resolution drops, the layout size doesn't), and an
 * absurd page size is refused. `signal` cancels a render that a newer one replaces.
 */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, textLayer: HTMLElement, scale: number, signal?: AbortSignal): Promise<void> {
  const pdfjs = await loadPdfjs()
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  if (viewport.width > 20_000 || viewport.height > 20_000) throw new PdfReadError('unreadable', 'This page is too large to show.')
  const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, viewport.width * viewport.height)))
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  const context = canvas.getContext('2d')
  if (!context) return
  const task = page.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined, annotationMode: pdfjs.AnnotationMode.DISABLE })
  const cancel = () => task.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    await task.promise
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  if (signal?.aborted) return
  textLayer.replaceChildren()
  textLayer.style.width = `${Math.floor(viewport.width)}px`
  textLayer.style.height = `${Math.floor(viewport.height)}px`
  textLayer.style.setProperty('--scale-factor', String(scale))
  await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: textLayer, viewport }).render()
  page.cleanup()
}
