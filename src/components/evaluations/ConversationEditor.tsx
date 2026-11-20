import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { TranscriptMessage } from '@/domain/contracts'
import { LIMITS } from '@/domain/limits'
import { cn } from '@/lib/utils'

/**
 * The conversation so far for one question (D-39): earlier exchanges of a user
 * turn and an assistant reply. The question field stays the user's next message.
 */
export function ConversationEditor({ caseKey, messages, error, onChange }: { caseKey: string; messages: TranscriptMessage[]; error?: string; onChange: (next: TranscriptMessage[]) => void }) {
  const exchanges = messages.length / 2
  const canAdd = messages.length + 2 <= LIMITS.historyMessages
  const set = (index: number, content: string) => onChange(messages.map((message, i) => (i === index ? { ...message, content } : message)))
  return (
    <div className="space-y-3 rounded-md border border-border bg-slip/60 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-small font-medium">Conversation so far</div>
        <span className="text-caption text-muted-foreground">Every party sees the same earlier turns and writes the next reply.</span>
      </div>
      {messages.map((message, i) => (
        <div key={i} className="space-y-1">
          <Label htmlFor={`case-${caseKey}-msg-${i}`} className={cn('typewriter text-caption font-bold', message.role === 'user' ? 'text-muted-foreground' : 'text-primary')}>
            {message.role === 'user' ? 'USER' : 'ASSISTANT'} · TURN {Math.floor(i / 2) + 1}
          </Label>
          <Textarea id={`case-${caseKey}-msg-${i}`} rows={2} className="bg-exhibit" value={message.content} onChange={(e) => set(i, e.target.value)} />
        </div>
      ))}
      {error && <FieldError className="text-caption">{error}</FieldError>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={!canAdd} onClick={() => onChange([...messages, { role: 'user', content: '' }, { role: 'assistant', content: '' }])}>
          <Plus aria-hidden /> Add an earlier exchange
        </Button>
        {exchanges > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onChange(messages.slice(0, -2))}>
            Remove the last exchange
          </Button>
        )}
      </div>
      {exchanges > 0 && <p className="text-caption text-muted-foreground">The question above is the user’s next message after this conversation. A conversation needs a model that has passed a live multi-message check.</p>}
    </div>
  )
}
