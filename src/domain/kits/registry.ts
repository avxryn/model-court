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
import { CLASSIFICATION_V1, classificationFieldsSchema, classificationSettingsSchema } from './classification'
import { EXTRACTION_V1, extractionFieldsSchema, extractionSettingsSchema } from './extraction'
import { GENERAL_V1 } from './general'
import { SUMMARIZATION_V1, summarizationFieldsSchema, summarizationSettingsSchema } from './summarization'
import type { InputKind, KitJurorCaseView, KitReadinessIssue, TaskKit } from './types'

export const KITS = {
  'general-v1': GENERAL_V1,
  'summarization-v1': SUMMARIZATION_V1,
  'classification-v1': CLASSIFICATION_V1,
  'extraction-v1': EXTRACTION_V1,
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
export const kitChoiceSchema = z.discriminatedUnion('version', [
  z.strictObject({ version: z.literal('summarization-v1'), settings: summarizationSettingsSchema }),
  z.strictObject({ version: z.literal('classification-v1'), settings: classificationSettingsSchema }),
  z.strictObject({ version: z.literal('extraction-v1'), settings: extractionSettingsSchema }),
  // Items 5–6 append their versions here.
])

/** A question's kit fields, discriminated on `kind` (= family), so a v2 kit of a family reuses the shape. */
export const kitFieldsSchema = z.discriminatedUnion('kind', [summarizationFieldsSchema, classificationFieldsSchema, extractionFieldsSchema])

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
    // A document kit's question is plain text plus a document stored beside the draft (spec 04 §4.2).
    const accepted = kit.inputKinds.includes(inputKind) || (inputKind === 'text' && kit.inputKinds.includes('document'))
    return accepted ? [] : [{ kind: 'kit_input_unsupported' as const, caseKey: testCase.key, inputKind, kitVersion: kit.version }]
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

/** The kit a hearing names, for pickers and headers; null for general-v1. Carries no check result. */
export function kitNameOf(holder: { kit?: { version: string } | undefined }): { version: string; name: string } | null {
  return holder.kit ? { version: holder.kit.version, name: kitFor(holder.kit.version).name } : null
}

/**
 * What jurors see of a question's kit fields (spec 03 §4.3): identical for every party, read from
 * the settings and the question only, never from a testimony. Null for general-v1.
 */
export function jurorKitView(holder: { kit?: { version: string; settings: unknown } | undefined }, testCase: Pick<CaseInput, 'kitFields'>): KitJurorCaseView | null {
  if (!holder.kit) return null
  const kit = kitFor(holder.kit.version)
  const raw = testCase.kitFields as { kind?: string } | undefined
  return kit.jurorCaseView?.(holder.kit.settings, raw && raw.kind === kit.family ? raw : undefined) ?? null
}
