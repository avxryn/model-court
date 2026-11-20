import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { SheetSection, Term } from '@/components/court/CaseFile'
import { Button } from '@/components/ui/button'
import { api, apiDownload, describeError, saveBlob } from '@/lib/api-client'

/** Judge-only download of the certified record (D-28, D-29). Each export is logged in the audit trail. */
export function CertifiedRecord({ runId, className }: { runId: string; className?: string }) {
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null)
  const [hash, setHash] = useState<string | null>(null)
  const download = async (format: 'json' | 'csv') => {
    setBusy(format)
    try {
      if (format === 'json') {
        const record = await api<{ certification: { contentSha256: string } }>('GET', `/runs/${runId}/export?format=json`)
        setHash(record.certification.contentSha256)
        saveBlob(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }), `model-court-record-${runId}.json`)
      } else {
        const { blob, filename } = await apiDownload(`/runs/${runId}/export?format=csv`)
        saveBlob(blob, filename ?? `model-court-record-${runId}.csv`)
      }
      toast.success('Certified record downloaded')
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(null)
    }
  }
  return (
    <SheetSection id="certified-record" label={<Term name="certified" />} className={className}>
      <p className="max-w-2xl text-small leading-relaxed text-muted-foreground">
        A copy of this hearing’s record for your files: questions, testimony, every rating, findings, failures, and judgments. It never includes API keys, invitation links, or account ids. Only you, the judge, can download it, and each download is logged.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void download('json')}>
          <Download aria-hidden /> {busy === 'json' ? 'Preparing…' : 'Download record (JSON)'}
        </Button>
        <Button variant="outline" disabled={busy !== null} onClick={() => void download('csv')}>
          <Download aria-hidden /> {busy === 'csv' ? 'Preparing…' : 'Download ratings (CSV)'}
        </Button>
      </div>
      {hash && (
        <p className="mt-3 text-caption break-all text-muted-foreground">
          Content fingerprint (SHA-256): <span className="typewriter text-foreground">{hash}</span>. Two copies of the same record have the same fingerprint. It is not a signature.
        </p>
      )}
    </SheetSection>
  )
}
