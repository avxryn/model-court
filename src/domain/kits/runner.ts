/**
 * The check runner (spec 03 §3.6, D-75). Pure and synchronous: no I/O, clock or randomness, so
 * the same inputs give the same results. It never throws: a check that throws becomes an
 * `error` result, so a bug in Model Court never reads as the party failing.
 *
 * Inputs are content only. A check sees the testimony content, the snapshot question (with its
 * answer keys) and the kit settings; never tokens, timing, finish reason, truncation, provider,
 * model, party label or key, attempt number or whether the party is imported.
 */

import type { CaseInput } from '../contracts'
import { LIMITS } from '../limits'
import { utf8ByteLength } from '../text'
import type { CheckCase, CheckContext, CheckDetail, CheckMaterials, CheckResult, CheckStatus, TaskKit, Testimony } from './types'

export const CHECK_ERROR_REASON = 'This check could not run. That is a fault in Model Court, not in the answer.'
/** The check id of the single result a runner-level fault yields. */
export const RUNNER_CHECK_ID = '_runner'

const STATUSES: ReadonlySet<CheckStatus> = new Set(['pass', 'fail', 'na'])
// Control characters (C0, DEL, C1), line and paragraph separators: replaced by a space.
const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/gu

/** Trim, replace control characters, collapse spaces, cap at 300 code points. */
export function normalizeReason(reason: unknown, max: number = LIMITS.kits.checkReasonChars): string {
  const text = typeof reason === 'string' ? reason.replace(CONTROL, ' ').replace(/ {2,}/gu, ' ').trim() : ''
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

function isDetailValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return Array.isArray(value) && value.every((item) => typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)))
}

/** Keep only well-typed detail; anything over 1 KiB as JSON becomes `{}`. */
export function normalizeDetail(detail: unknown): CheckDetail {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {}
  const out: CheckDetail = {}
  for (const [key, value] of Object.entries(detail)) if (isDetailValue(value)) out[key] = value as CheckDetail[string]
  return utf8ByteLength(JSON.stringify(out)) <= LIMITS.kits.checkDetailBytes ? out : {}
}

/** Fit a result set under the 16 KiB cap: drop details first, then shorten reasons. */
export function capResults(results: CheckResult[]): CheckResult[] {
  const capped = results.slice(0, LIMITS.kits.checksPerTestimony)
  const fits = (set: CheckResult[]) => utf8ByteLength(JSON.stringify(set)) <= LIMITS.kits.checkResultsJsonBytes
  if (fits(capped)) return capped
  const withoutDetail = capped.map((result) => ({ ...result, detail: {} }))
  if (fits(withoutDetail)) return withoutDetail
  return withoutDetail.map((result) => ({ ...result, reason: normalizeReason(result.reason, 120) }))
}

/** The question exactly as a check may see it: no title, conversation or language. */
export function checkCaseOf(testCase: CaseInput | CheckCase): CheckCase {
  return {
    key: testCase.key,
    input: testCase.input,
    reference: testCase.reference,
    expectedBehavior: testCase.expectedBehavior,
    ...(testCase.kitFields !== undefined ? { kitFields: testCase.kitFields } : {}),
  }
}

export function runChecks(kit: TaskKit<unknown, unknown>, settings: unknown, testCase: CaseInput | CheckCase, testimony: Testimony, materials?: CheckMaterials): { kitVersion: string; results: CheckResult[] } {
  try {
    const checkCase = checkCaseOf(testCase)
    const raw = checkCase.kitFields as { kind?: string } | undefined
    const ctx: CheckContext<unknown, unknown> = {
      testimony: { kind: testimony.kind, text: testimony.text },
      testCase: checkCase,
      fields: raw && raw.kind === kit.family ? raw : undefined,
      settings,
      // Spec 05 (D-92): origin notes are not part of a check's view of a source.
      ...(materials?.sources ? { materials: { sources: materials.sources.map((source) => ({ number: source.number, title: source.title, text: source.text })) } } : {}),
    }
    const results = kit.checks.map((check): CheckResult => {
      try {
        const outcome = check.run(ctx)
        if (!outcome || !STATUSES.has(outcome.status)) throw new Error('invalid outcome')
        return { checkId: check.id, status: outcome.status, reason: normalizeReason(outcome.reason), detail: normalizeDetail(outcome.detail) }
      } catch {
        return { checkId: check.id, status: 'error', reason: CHECK_ERROR_REASON, detail: {} }
      }
    })
    return { kitVersion: kit.version, results: capResults(results) }
  } catch {
    return { kitVersion: kit.version, results: [{ checkId: RUNNER_CHECK_ID, status: 'error', reason: CHECK_ERROR_REASON, detail: {} }] }
  }
}
