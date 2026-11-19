/**
 * Choosing a task kit on a draft (spec 03 §4.2, D-79). Pure, so the picker and its tests share it.
 * Switching kits clears what the new kit cannot carry; the picker names it first.
 */

import type { CaseInput, DraftInput } from '@/domain/contracts'
import { GROUNDED_DEFAULT_FIELDS } from '@/domain/kits/grounded'
import { blankToolTask } from '@/domain/tools/task'
import { DEFAULT_KIT_VERSION, inputKindOf, kitFor } from '@/domain/kits/registry'
import type { TaskKit } from '@/domain/kits/types'
import { plural } from '@/lib/format'

export interface KitSwitch {
  draft: DraftInput
  /** Plain sentences naming what the switch removes; empty when nothing is lost. */
  removals: string[]
}

function fieldsName(kind: string): string {
  return kind === 'summarization' ? 'required points and phrases to avoid' : kind === 'classification' ? 'answer keys' : kind === 'grounded' ? 'grounding keys' : kind === 'tools' ? 'tools and expectations' : 'task-kit fields'
}

/** The draft after choosing `version`, and what that removes. Choosing General answers removes `kit` and every `kitFields`. */
export function switchKit(draft: DraftInput, version: string): KitSwitch {
  const kit = kitFor(version) as TaskKit<unknown, unknown>
  const general = kit.version === DEFAULT_KIT_VERSION
  const current = (draft as { kit?: { version: string; settings: unknown } }).kit
  if ((current?.version ?? DEFAULT_KIT_VERSION) === kit.version) return { draft, removals: [] }

  const otherFields = draft.cases.filter((testCase) => testCase.kitFields && (testCase.kitFields as { kind: string }).kind !== kit.family)
  // A document or sources kit's question is plain text plus material stored beside it (specs 04, 05).
  const beside = kit.inputKinds.includes('document') || kit.inputKinds.includes('sources')
  // Spec 06: a tools kit's question is plain text (its exhibit kept as context) plus its tool task.
  const takes = (testCase: CaseInput) => kit.inputKinds.includes(inputKindOf(testCase)) || (inputKindOf(testCase) === 'text' && (beside || kit.inputKinds.includes('tools')))
  const conversations = draft.cases.filter((testCase) => !takes(testCase))
  const removals: string[] = []
  const kinds = [...new Set(otherFields.map((testCase) => (testCase.kitFields as { kind: string }).kind))]
  for (const kind of kinds) {
    const count = otherFields.filter((testCase) => (testCase.kitFields as { kind: string }).kind === kind).length
    removals.push(`Switching to ${kit.name} removes ${fieldsName(kind)} from ${plural(count, 'question')}.`)
  }
  // Spec 04: a document kit's question keeps its source as an uploaded document, not in the exhibit.
  const exhibits = beside ? draft.cases.filter((testCase) => testCase.reference !== '') : []
  if (exhibits.length > 0 && kit.inputKinds.includes('document')) removals.push(`${kit.name} keeps each question's source as a document, so switching clears the exhibit of ${plural(exhibits.length, 'question')}. Paste it as the document afterwards.`)
  // Spec 05 (D-95): a sources kit keeps its evidence as numbered sources.
  if (exhibits.length > 0 && kit.inputKinds.includes('sources')) removals.push(`${kit.name} keeps each question's evidence as numbered sources, so switching clears the exhibit of ${plural(exhibits.length, 'question')}. Paste it as a source afterwards.`)
  if (conversations.length > 0) removals.push(`${kit.name} questions can't carry a conversation yet, so switching removes the earlier conversation from ${plural(conversations.length, 'question')}.`)

  const cases = draft.cases.map((testCase): CaseInput => {
    let next: CaseInput = testCase
    if (next.kitFields && (next.kitFields as { kind: string }).kind !== kit.family) {
      const { kitFields: _removed, ...rest } = next
      next = rest
    }
    if (!takes(next)) {
      const { messages: _removed, ...rest } = next
      next = rest
    }
    if (beside && next.reference !== '') next = { ...next, reference: '' }
    // Spec 05: every grounded question starts with the default key (the sources answer it, none required).
    if (kit.family === 'grounded' && !next.kitFields) next = { ...next, kitFields: { ...GROUNDED_DEFAULT_FIELDS } }
    // Spec 06: every tool-use question starts with one blank tool the judge fills in.
    if (kit.family === 'tools' && !next.kitFields) next = { ...next, kitFields: blankToolTask() }
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
