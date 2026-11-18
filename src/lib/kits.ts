/**
 * Choosing a task kit on a draft (spec 03 §4.2, D-79). Pure, so the picker and its tests share it.
 * Switching kits clears what the new kit cannot carry; the picker names it first.
 */

import type { CaseInput, DraftInput } from '@/domain/contracts'
import { DEFAULT_KIT_VERSION, inputKindOf, kitFor } from '@/domain/kits/registry'
import type { TaskKit } from '@/domain/kits/types'
import { plural } from '@/lib/format'

export interface KitSwitch {
  draft: DraftInput
  /** Plain sentences naming what the switch removes; empty when nothing is lost. */
  removals: string[]
}

function fieldsName(kind: string): string {
  return kind === 'summarization' ? 'required points and phrases to avoid' : kind === 'classification' ? 'answer keys' : 'task-kit fields'
}

/** The draft after choosing `version`, and what that removes. Choosing General answers removes `kit` and every `kitFields`. */
export function switchKit(draft: DraftInput, version: string): KitSwitch {
  const kit = kitFor(version) as TaskKit<unknown, unknown>
  const general = kit.version === DEFAULT_KIT_VERSION
  const current = (draft as { kit?: { version: string; settings: unknown } }).kit
  if ((current?.version ?? DEFAULT_KIT_VERSION) === kit.version) return { draft, removals: [] }

  const otherFields = draft.cases.filter((testCase) => testCase.kitFields && (testCase.kitFields as { kind: string }).kind !== kit.family)
  const conversations = draft.cases.filter((testCase) => !kit.inputKinds.includes(inputKindOf(testCase)))
  const removals: string[] = []
  const kinds = [...new Set(otherFields.map((testCase) => (testCase.kitFields as { kind: string }).kind))]
  for (const kind of kinds) {
    const count = otherFields.filter((testCase) => (testCase.kitFields as { kind: string }).kind === kind).length
    removals.push(`Switching to ${kit.name} removes ${fieldsName(kind)} from ${plural(count, 'question')}.`)
  }
  if (conversations.length > 0) removals.push(`${kit.name} questions can't carry a conversation yet, so switching removes the earlier conversation from ${plural(conversations.length, 'question')}.`)

  const cases = draft.cases.map((testCase): CaseInput => {
    let next: CaseInput = testCase
    if (next.kitFields && (next.kitFields as { kind: string }).kind !== kit.family) {
      const { kitFields: _removed, ...rest } = next
      next = rest
    }
    if (!kit.inputKinds.includes(inputKindOf(next))) {
      const { messages: _removed, ...rest } = next
      next = rest
    }
    return next
  })
  // A rubric the judge never chose (absent, or the previous kit's default) follows the kit.
  const autoRubric = draft.rubricVersion === undefined || draft.rubricVersion === kitFor(current?.version).defaultRubricVersion
  const { kit: _previous, rubricVersion: _rubric, ...rest } = draft as DraftInput & { kit?: unknown }
  const rubricPart = autoRubric ? (general ? {} : { rubricVersion: kit.defaultRubricVersion }) : { rubricVersion: draft.rubricVersion }
  const nextDraft = { ...rest, ...rubricPart, cases, ...(general ? {} : { kit: { version: kit.version, settings: kit.defaultSettings } }) }
  return { draft: nextDraft as DraftInput, removals }
}

/** The draft's kit (general-v1 when absent). */
export function draftKit(draft: DraftInput): TaskKit<unknown, unknown> {
  return kitFor((draft as { kit?: { version: string } }).kit?.version) as TaskKit<unknown, unknown>
}

export function draftKitSettings<S>(draft: DraftInput): S {
  return (draft as { kit?: { settings: S } }).kit?.settings as S
}

/** Replace the kit settings, keeping the version. */
export function withKitSettings(draft: DraftInput, settings: unknown): DraftInput {
  const kit = (draft as { kit?: { version: string } }).kit
  return kit ? ({ ...draft, kit: { version: kit.version, settings } } as DraftInput) : draft
}
