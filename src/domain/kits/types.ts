/**
 * The task-kit contract (spec 03 §3.3, D-75). Pure and browser-safe.
 *
 * A kit is an immutable, versioned definition of a task shape: what a question holds, what a
 * party must return, which message template and default rubric a hearing records, and which
 * free, deterministic checks run on every accepted testimony. Specs 04–06 extend it by adding
 * kit versions, `Testimony` variants and field kinds; they never change existing members.
 */

import type { z } from 'zod'
import type { CaseInput } from '../contracts'
import type { PromptSource } from '../grounded/sources'
import type { MessageTemplateVersion } from '../messages'
import type { RubricVersion } from '../rubric'

export type KitFamily = 'general' | 'summarization' | 'classification' | 'extraction' | 'grounded' | 'tools'

/** What a question holds. v1 kits use 'text' (and general also 'conversation'). */
export type InputKind = 'text' | 'conversation' | 'document' | 'sources' | 'tools'

/** What a party must return. v1 uses 'text' and 'label'; 'json' and 'toolTrace' are reserved for items 4 and 6. */
export type OutputContract =
  | { kind: 'text' }
  /** "Label: <label>" on the first line, reasoning after. */
  | { kind: 'label'; format: 'first-line-v1' }
  /** Item 4 defines. */
  | { kind: 'json'; schemaSource: 'kit-settings' }
  /** Item 6 defines. */
  | { kind: 'toolTrace' }

/**
 * The finished testimony a check sees: its content and nothing else. Items 4 and 6 add variants
 * ({ kind: 'json'; text; parsed } and { kind: 'toolTrace'; trace }). Never provider metadata.
 */
export type Testimony = { kind: 'text'; text: string }

/** The question as a check sees it: the snapshot case, including reviewer-only answer keys. */
export type CheckCase = Pick<CaseInput, 'key' | 'input' | 'reference' | 'expectedBehavior' | 'kitFields'>

/**
 * Frozen per-question materials a kit's checks read beside the question (spec 05 §8, D-92): the
 * grounded kit's numbered sources, without their origin notes. Identical for every party.
 */
export interface CheckMaterials {
  sources?: ReadonlyArray<PromptSource>
}

/**
 * Everything a check may read. Deliberately no tokens, timing, finish reason, truncation,
 * provider, model, party label or key, attempt number or imported-ness (the blinding rule, §9).
 */
export interface CheckContext<S, F> {
  testimony: Testimony
  testCase: CheckCase
  /** The case's own kit fields, already narrowed to this kit's kind (or undefined when the question has none). */
  fields: F | undefined
  settings: S
  /** The question's frozen materials; absent for kits that have none. */
  materials?: CheckMaterials
}

export type CheckStatus = 'pass' | 'fail' | 'na' | 'error'

export type CheckDetail = Record<string, string | number | boolean | null | Array<string | number>>

export interface CheckOutcome {
  /** A check never returns 'error'; the runner assigns it when a check throws. */
  status: Exclude<CheckStatus, 'error'>
  /** Plain words, one sentence, ≤ 300 code points after normalization. May quote ≤ 60 characters of the testimony. */
  reason: string
  /** Small machine-readable facts for metrics and the export (≤ 1 KiB as JSON): counts, labels, indices. */
  detail?: CheckDetail
}

export interface CheckDefinition<S, F> {
  /** Stable within the kit version; kebab-case; never reused for a different meaning. */
  id: string
  /** Display: "Length within limit". */
  label: string
  /** One sentence for the record and the start dialog: what it checks and its known blind spots. */
  description: string
  run(ctx: CheckContext<S, F>): CheckOutcome
}

export interface CheckResult {
  checkId: string
  status: CheckStatus
  reason: string
  detail: CheckDetail
}

export interface CheckRow {
  caseKey: string
  configurationKey: string
  results: CheckResult[]
}

/** A kit-level number shown on the record, per party, e.g. accuracy. Computed only from check results. */
export interface KitMetric {
  id: string
  label: string
  /** Per configuration key; null when the metric has no denominator for that party. */
  byConfiguration: Record<string, { numerator: number; denominator: number } | null>
  /** A plain value per party instead of a fraction (e.g. median length); null when there is nothing to measure. */
  values?: Record<string, number | null>
  /** The unit of `values`, e.g. "words". */
  unit?: string
  /** Shown under the metric, e.g. the small-sample caveat. */
  caveat: string | null
}

/** Juror-safe per-question kit facts, identical for every party (shown as part of the jury instructions). */
export type KitJurorCaseView =
  | { kind: 'summarization'; lengthLimit: string; format: 'paragraph' | 'bullets' | null; requiredPoints: string[]; mustNotMention: string[] }
  | { kind: 'classification'; labels: string[]; expectedLabel: string | null; alsoAccept: string[] }
  /** Spec 04 (D-85): the field list's labels in schema order. Never the answer key (decision 1). */
  | { kind: 'extraction'; fields: Array<{ label: string; mustFill: boolean }> }
  /** Spec 05 §3 (D-92): the judge's grounding key, the same for every party. */
  | { kind: 'grounded'; answerable: 'yes' | 'partly' | 'no'; requiredSources: number[] }

export type KitReadinessIssue =
  | { kind: 'kit_input_unsupported'; caseKey: string; inputKind: InputKind; kitVersion: string }
  | { kind: 'kit_document_missing'; caseKey: string; kitVersion: string }
  | { kind: 'kit_unknown'; version: string }
  /** Spec 05 §4.4 (D-92): a grounded question without sources. */
  | { kind: 'kit_sources_missing'; caseKey: string; kitVersion: string }
  /** Spec 05 §4.4: a required source number the question no longer has. */
  | { kind: 'kit_required_source_unknown'; caseKey: string; kitVersion: string; number: number }

export interface KitMetricInput<S> {
  settings: S
  /** Eligible questions only. */
  cases: ReadonlyArray<CheckCase>
  /** Rows of the scored (primary) testimony on eligible questions. */
  rows: ReadonlyArray<CheckRow>
  configurationKeys: readonly string[]
}

export interface TaskKit<S = unknown, F = unknown> {
  version: string
  family: KitFamily
  /** Display name and one-line description for pickers, the record and the export. */
  name: string
  description: string
  /** An unlisted (superseded) version stays valid for drafts and hearings that use it; pickers stop offering it. */
  listed: boolean
  inputKinds: readonly InputKind[]
  outputContract: OutputContract
  /** Validates `draft.kit.settings`. general-v1 has none. */
  settingsSchema: z.ZodType<S> | null
  /** Validates each `case.kitFields` (its `kind` must equal `family`). null = kitFields must be absent. */
  caseFieldsSchema: z.ZodType<F> | null
  /** Default settings when the judge picks the kit. */
  defaultSettings: S
  /** Cross-field rules between settings and each case's fields (e.g. expected label ∈ labels). Returns issues for Zod. */
  draftIssues?(settings: S, cases: ReadonlyArray<CaseInput>): Array<{ path: (string | number)[]; message: string }>
  /** Start-time rules (incomplete but savable drafts), reported as readiness issues. */
  readinessIssues?(settings: S, cases: ReadonlyArray<CaseInput>): KitReadinessIssue[]
  /** The template a hearing records. general-v1 delegates to templateFor (qa-v1 or chat-v1). */
  selectTemplate(cases: ReadonlyArray<Pick<CaseInput, 'messages'>>): MessageTemplateVersion
  defaultRubricVersion: RubricVersion
  /** Prefill for a new question's jury instructions (`expectedBehavior`); the judge edits it. */
  defaultJuryInstructions: string | null
  checks: ReadonlyArray<CheckDefinition<S, F>>
  /** Kit metrics from stored results on eligible questions. Pure. */
  metrics?(input: KitMetricInput<S>): KitMetric[]
  /** What jurors see about a question's kit fields before unsealing. Must not depend on any party. */
  jurorCaseView?(settings: S, fields: F | undefined): KitJurorCaseView | null
  /**
   * Spec 01 §10: a key two samples of one party share when they reached the same result (the
   * label for classification). Read only after unsealing, from check results, never from text
   * a juror sees differently. null when this testimony has no comparable result.
   */
  consistencyKey?(results: readonly CheckResult[]): string | null
}
