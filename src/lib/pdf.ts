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

/** Opens a PDF from bytes with the safe options. The caller destroys it. */
export async function openPdf(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs()
  try {
    return await pdfjs.getDocument({
      // pdf.js may transfer the buffer to its worker: give it a copy.
      data: new Uint8Array(bytes.slice(0)),
      enableXfa: false,
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

/** Renders one page on a canvas, annotations off, with a text layer for search and selection. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, textLayer: HTMLElement, scale: number): Promise<void> {
  const pdfjs = await loadPdfjs()
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const ratio = window.devicePixelRatio || 1
  canvas.width = Math.floor(viewport.width * ratio)
  canvas.height = Math.floor(viewport.height * ratio)
  canvas.style.width = `${Math.floor(viewport.width)}px`
  canvas.style.height = `${Math.floor(viewport.height)}px`
  const context = canvas.getContext('2d')
  if (!context) return
  await page.render({ canvas, canvasContext: context, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined, annotationMode: pdfjs.AnnotationMode.DISABLE }).promise
  textLayer.replaceChildren()
  textLayer.style.width = `${Math.floor(viewport.width)}px`
  textLayer.style.height = `${Math.floor(viewport.height)}px`
  textLayer.style.setProperty('--scale-factor', String(scale))
  await new pdfjs.TextLayer({ textContentSource: await page.getTextContent(), container: textLayer, viewport }).render()
  page.cleanup()
}
