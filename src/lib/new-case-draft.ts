/**
 * The unsent "Open a new case" form, kept in this browser so closing the
 * dialog or reloading loses nothing. One draft per signed-in user (the key
 * carries the user id, which is not a secret). It holds only the template,
 * title and decision text the judge typed: never keys, tokens or anything
 * from the server. Every storage access is guarded, because storage can be
 * blocked or full; the form works the same without it.
 */

const PREFIX = 'mc.new-case-draft:'
const MAX_TITLE = 120
const MAX_TASK = 2000

export interface NewCaseDraft {
  templateId: string
  title: string
  task: string
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): DraftStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function draftKey(userId: string): string {
  return `${PREFIX}${userId}`
}

/** True when nothing worth keeping was typed (the default template alone is not a draft). */
export function isEmptyDraft(draft: NewCaseDraft, defaultTemplateId: string): boolean {
  return draft.title.trim() === '' && draft.task.trim() === '' && draft.templateId === defaultTemplateId
}

export function readNewCaseDraft(userId: string | null, storage: DraftStorage | null = browserStorage()): NewCaseDraft | null {
  if (!userId || !storage) return null
  try {
    const raw = storage.getItem(draftKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NewCaseDraft>
    if (typeof parsed.templateId !== 'string' || typeof parsed.title !== 'string' || typeof parsed.task !== 'string') return null
    return { templateId: parsed.templateId, title: parsed.title.slice(0, MAX_TITLE), task: parsed.task.slice(0, MAX_TASK) }
  } catch {
    return null
  }
}

export function writeNewCaseDraft(userId: string | null, draft: NewCaseDraft, storage: DraftStorage | null = browserStorage()): void {
  if (!userId || !storage) return
  try {
    storage.setItem(draftKey(userId), JSON.stringify({ templateId: draft.templateId, title: draft.title.slice(0, MAX_TITLE), task: draft.task.slice(0, MAX_TASK) }))
  } catch {
    // Storage blocked or full: the draft lives only as long as the dialog.
  }
}

export function clearNewCaseDraft(userId: string | null, storage: DraftStorage | null = browserStorage()): void {
  if (!userId || !storage) return
  try {
    storage.removeItem(draftKey(userId))
  } catch {
    // Nothing to clear.
  }
}
