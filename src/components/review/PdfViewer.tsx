/**
 * A juror's view of a PDF source (spec 04 §8.5, D-90): fetched with the caller's own auth (bearer
 * or guest cookie) as bytes, never as a URL the browser renders; drawn by pdf.js on a canvas,
 * one page at a time with a page strip, a selectable text layer and zoom up to 200%. Nothing
 * animates and nothing is cached between sessions.
 */

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Button } from '@/components/ui/button'
import { apiDownload, describeError } from '@/lib/api-client'
import { MAX_PAGES, openPdf, renderPage } from '@/lib/pdf'
import { cn } from '@/lib/utils'

const ZOOMS = [0.75, 1, 1.25, 1.5, 2] as const

export function PdfViewer({ runId, caseKey, pageCount }: { runId: string; caseKey: string; pageCount: number | null }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1)
  const canvas = useRef<HTMLCanvasElement>(null)
  const text = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    let opened: PDFDocumentProxy | null = null
    setDoc(null)
    setError(null)
    setPage(1)
    apiDownload(`/runs/${runId}/documents/${caseKey}`)
      .then(async ({ blob }) => {
        opened = await openPdf(await blob.arrayBuffer())
        if (live) setDoc(opened)
        else void opened.loadingTask.destroy()
      })
      .catch((caught: unknown) => live && setError(caught instanceof Error && 'reason' in caught ? caught.message : describeError(caught)))
    return () => {
      live = false
      void opened?.loadingTask.destroy()
    }
  }, [runId, caseKey])

  useEffect(() => {
    if (!doc || !canvas.current || !text.current) return
    // D-91: a page or zoom change cancels the render still in progress instead of fighting it for the canvas.
    const controller = new AbortController()
    renderPage(doc, page, canvas.current, text.current, zoom, controller.signal).catch((caught: unknown) => {
      if (!controller.signal.aborted && (caught as { name?: string }).name !== 'RenderingCancelledException') setError(caught instanceof Error && 'reason' in caught ? caught.message : 'This page could not be drawn.')
    })
    return () => controller.abort()
  }, [doc, page, zoom])

  // D-91: never more than the 20-page limit of buttons, whatever the file claims.
  const pages = Math.min(doc?.numPages ?? pageCount ?? 1, MAX_PAGES)
  const truncated = (doc?.numPages ?? 0) > MAX_PAGES
  if (error) return <p className="px-4 py-3 text-sm text-destructive">{error}</p>
  return (
    <div className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-2 px-4">
        <nav aria-label="PDF pages" className="flex flex-wrap gap-1">
          {Array.from({ length: pages }, (_, index) => (
            <Button key={index} size="xs" variant={page === index + 1 ? 'secondary' : 'ghost'} aria-current={page === index + 1 ? 'page' : undefined} aria-label={`Page ${index + 1} of ${pages}`} onClick={() => setPage(index + 1)}>
              {index + 1}
            </Button>
          ))}
        </nav>
        {truncated && <span className="text-xs text-muted-foreground">Showing the first {MAX_PAGES} pages; the file has {doc?.numPages}.</span>}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          Zoom
          <select className="rounded-sm border border-border bg-background px-1 py-0.5 text-xs" value={zoom} onChange={(event) => setZoom(Number(event.target.value) as (typeof ZOOMS)[number])}>
            {ZOOMS.map((value) => (
              <option key={value} value={value}>
                {Math.round(value * 100)}%
              </option>
            ))}
          </select>
        </label>
      </div>
      <div role="region" aria-label={`Source PDF, page ${page} of ${pages}`} tabIndex={0} className="max-h-[36rem] overflow-auto px-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {!doc && <p className="py-3 text-sm text-muted-foreground">Loading the PDF…</p>}
        <div className={cn('pdf-page relative inline-block bg-white shadow-sm', !doc && 'hidden')}>
          <canvas ref={canvas} aria-hidden />
          <div ref={text} className="textLayer absolute inset-0" />
        </div>
      </div>
    </div>
  )
}
