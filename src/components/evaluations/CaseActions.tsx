import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Copy, FileDown, MoreHorizontal, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { api, describeError } from '@/lib/api-client'
import { DuplicateCaseDialog, ExportScenarioDialog, type CopySource } from './CaseCopy'

/** The case's ⋯ menu beside the breadcrumbs, and the typed-title delete confirmation it opens. */
export function CaseActions({ evaluationId, title, revision, runs = [], copyCount = 0, hasImported = false }: { evaluationId: string; title: string; revision: number; runs?: readonly CopySource[]; copyCount?: number; hasImported?: boolean }) {
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="-mt-1 shrink-0" aria-label="Case actions" />}>
          <MoreHorizontal aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={() => setCopying(true)}>
            <Copy aria-hidden /> Duplicate case…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setExporting(true)}>
            <FileDown aria-hidden /> Export scenario file…
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2 aria-hidden /> Delete case…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DeleteCaseDialog open={deleting} onOpenChange={setDeleting} evaluationId={evaluationId} title={title} revision={revision} copyCount={copyCount} />
      <DuplicateCaseDialog open={copying} onOpenChange={setCopying} evaluationId={evaluationId} title={title} runs={runs} hasImported={hasImported} />
      <ExportScenarioDialog open={exporting} onOpenChange={setExporting} evaluationId={evaluationId} runs={runs} />
    </>
  )
}

function DeleteCaseDialog({ open, onOpenChange, evaluationId, title, revision, copyCount }: { open: boolean; onOpenChange: (open: boolean) => void; evaluationId: string; title: string; revision: number; copyCount: number }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      await api('DELETE', `/evaluations/${evaluationId}`, { body: { confirmTitle: confirm }, revision })
      toast.success('Case deleted')
      navigate('/evaluations')
    } catch (caught) {
      toast.error(describeError(caught))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setConfirm('')
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            Access stops immediately for you and every juror. Hearings, responses, ratings, and judgments are permanently removed within 24 hours and cannot be recovered. A provider request already in flight may still be charged. Your saved API keys are not affected. Deleting here cannot remove data the providers already received.
            {copyCount > 0 && ` ${copyCount === 1 ? '1 copy of this case is' : `${copyCount} copies of this case are`} not deleted.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (confirm === title && !busy) void remove()
          }}
        >
          <Field className="gap-1.5">
            <FieldLabel htmlFor="confirm-title">Type the title to confirm: {title}</FieldLabel>
            <Input id="confirm-title" value={confirm} autoComplete="off" onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Keep the case
            </Button>
            <Button type="submit" variant="destructive" disabled={confirm !== title || busy}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
