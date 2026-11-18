import { describe, expect, it } from 'vitest'
import { clearNewCaseDraft, draftKey, isEmptyDraft, readNewCaseDraft, writeNewCaseDraft } from './new-case-draft'

function memoryStorage() {
  const items = new Map<string, string>()
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  }
}

const throwing = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('quota')
  },
  removeItem: () => {
    throw new Error('blocked')
  },
}

describe('new-case draft', () => {
  it('round-trips per user and clears', () => {
    const storage = memoryStorage()
    writeNewCaseDraft('u1', { templateId: 'support', title: 'Refunds', task: 'Pick a bot' }, storage)
    expect(readNewCaseDraft('u1', storage)).toEqual({ templateId: 'support', title: 'Refunds', task: 'Pick a bot' })
    expect(readNewCaseDraft('u2', storage)).toBeNull()
    clearNewCaseDraft('u1', storage)
    expect(readNewCaseDraft('u1', storage)).toBeNull()
  })

  it('stores only the three form fields under a per-user key', () => {
    const storage = memoryStorage()
    writeNewCaseDraft('u1', { templateId: 't', title: 'x', task: 'y', apiKey: 'sk-should-not-be-here' } as never, storage)
    expect([...storage.items.keys()]).toEqual([draftKey('u1')])
    expect(JSON.parse(storage.items.get(draftKey('u1'))!)).toEqual({ templateId: 't', title: 'x', task: 'y' })
  })

  it('does nothing without a signed-in user', () => {
    const storage = memoryStorage()
    writeNewCaseDraft(null, { templateId: 't', title: 'x', task: 'y' }, storage)
    expect(storage.items.size).toBe(0)
    expect(readNewCaseDraft(null, storage)).toBeNull()
  })

  it('ignores malformed drafts and survives blocked storage', () => {
    const storage = memoryStorage()
    storage.setItem(draftKey('u1'), '{"title": 3}')
    expect(readNewCaseDraft('u1', storage)).toBeNull()
    storage.setItem(draftKey('u1'), 'not json')
    expect(readNewCaseDraft('u1', storage)).toBeNull()
    expect(readNewCaseDraft('u1', throwing)).toBeNull()
    expect(() => writeNewCaseDraft('u1', { templateId: 't', title: 'x', task: 'y' }, throwing)).not.toThrow()
    expect(() => clearNewCaseDraft('u1', throwing)).not.toThrow()
  })

  it('treats the untouched default form as empty', () => {
    expect(isEmptyDraft({ templateId: 'a', title: ' ', task: '' }, 'a')).toBe(true)
    expect(isEmptyDraft({ templateId: 'b', title: '', task: '' }, 'a')).toBe(false)
    expect(isEmptyDraft({ templateId: 'a', title: 'x', task: '' }, 'a')).toBe(false)
  })
})
