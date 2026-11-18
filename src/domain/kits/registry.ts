/**
 * The kit registry (spec 03 §3.2–3.4, D-75). Pure and browser-safe: pickers import it for labels
 * exactly as `RubricPicker` imports `RUBRICS`.
 *
 * Rules: never edit a published kit version (checks, ids, behaviour, settings schema, template or
 * default rubric); ship a new version instead and mark the old one `listed: false`. Specs 04–06
 * append their versions to `KITS` and `kitChoiceSchema`, and their families to `kitFieldsSchema`.
 */

import { z } from 'zod'
import type { CaseInput } from '../contracts'
import { GENERAL_V1 } from './general'
import type { InputKind, KitReadinessIssue, TaskKit } from './types'

export const KITS = {
  'general-v1': GENERAL_V1,
} as const satisfies Record<string, TaskKit<any, any>>

export type KitVersion = keyof typeof KITS
export const KIT_VERSIONS = Object.keys(KITS) as [KitVersion, ...KitVersion[]]
export const DEFAULT_KIT_VERSION = 'general-v1' as const satisfies KitVersion

/** A kit lookup table; services take one so integration tests can inject a kit (`deps.kits`). */
export type KitTable = Readonly<Record<string, TaskKit<any, any>>>

export function isKitVersion(version: string): version is KitVersion {
  return Object.hasOwn(KITS, version)
}

/** Unknown or absent versions fall back to general-v1 (as rubricLines does for rubrics). */
export function kitFor(version: string | null | undefined, kits: KitTable = KITS): TaskKit<unknown, unknown> {
  const kit = (version ? kits[version] : undefined) ?? kits[DEFAULT_KIT_VERSION] ?? GENERAL_V1
  return kit as unknown as TaskKit<unknown, unknown>
}

/**
 * The version a draft or snapshot uses, made explicit (`general-v1` when `kit` is absent). Item 2
 * hashes this into a scenario version, so two hearings under different kit versions differ.
 */
export function kitVersionOf(holder: { kit?: { version: string } | undefined }): string {
  return holder.kit?.version ?? DEFAULT_KIT_VERSION
}

/**
 * The chosen kit and its settings on a draft, discriminated on `version`. general-v1 is chosen by
 * omission and is not a member. Kit versions append their members here.
 */
export const kitChoiceSchema = z.never()

/** A question's kit fields, discriminated on `kind` (= family), so a v2 kit of a family reuses the shape. */
export const kitFieldsSchema = z.never()

/** A question with earlier turns is a conversation; otherwise it is plain text. */
export function inputKindOf(testCase: Pick<CaseInput, 'messages'>): InputKind {
  return (testCase.messages?.length ?? 0) > 0 ? 'conversation' : 'text'
}

/**
 * Start-time kit rules for a draft: the version must exist, every question's input kind must be
 * one the kit takes, plus the kit's own readiness rules.
 */
export function kitReadinessIssues(draft: { kit?: { version: string; settings?: unknown } | undefined; cases?: ReadonlyArray<CaseInput> }, kits: KitTable = KITS): KitReadinessIssue[] {
  if (!draft.kit) return []
  const kit = kits[draft.kit.version] as TaskKit<unknown, unknown> | undefined
  if (!kit) return [{ kind: 'kit_unknown', version: draft.kit.version }]
  const cases = draft.cases ?? []
  const issues: KitReadinessIssue[] = cases.flatMap((testCase) => {
    const inputKind = inputKindOf(testCase)
    return kit.inputKinds.includes(inputKind) ? [] : [{ kind: 'kit_input_unsupported' as const, caseKey: testCase.key, inputKind, kitVersion: kit.version }]
  })
  return [...issues, ...(kit.readinessIssues?.(draft.kit.settings, cases) ?? [])]
}

/**
 * Draft-level kit rules (spec 03 §3.4), run from `draftInputSchema.superRefine`: question fields
 * only with a kit, of that kit's family, and the kit's own cross-field rules.
 */
export function kitDraftIssues(draft: { kit?: { version: string; settings?: unknown } | undefined; cases: ReadonlyArray<CaseInput> }): Array<{ path: (string | number)[]; message: string }> {
  const issues: Array<{ path: (string | number)[]; message: string }> = []
  const kit = draft.kit ? kitFor(draft.kit.version) : null
  draft.cases.forEach((testCase, index) => {
    const fields = testCase.kitFields as { kind?: string } | undefined
    if (!fields) return
    if (!kit) issues.push({ path: ['cases', index, 'kitFields'], message: 'This question has task-kit fields, but the case uses General answers. Remove them or choose a task kit.' })
    else if (fields.kind !== kit.family) issues.push({ path: ['cases', index, 'kitFields', 'kind'], message: `These fields belong to another task kit than ${kit.name}.` })
  })
  if (kit && draft.kit) issues.push(...(kit.draftIssues?.(draft.kit.settings, draft.cases) ?? []))
  return issues
}
