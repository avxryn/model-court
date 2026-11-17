/**
 * Revealed results and verdicts (F14, F15; spec §2.6). Results are computed on
 * demand from the frozen manifest and the cohort captured at reveal.
 */

import { z } from 'zod'
import type { DraftRating } from '../../domain/contracts'
import { verdictSchema } from '../../domain/contracts'
import { findDisagreements, scoreCohort, type CompleteRating, type ScoredSession } from '../../domain/rubric'
import { canRun, type RunStatus } from '../../domain/transitions'
import { loadRunAccess, requireOwner, type SessionRow } from '../access'
import { all, auditStatement, cond, GuardFailed, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, revisionConflict, stateConflict } from '../http'
import { idempotent, requestHash } from '../receipts'
import { notifyRun } from './generation'
import { loadGenerations, parseSnapshot, type AssignmentCase, type EligibleManifest } from './runs'

interface AttemptRow {
  id: string
  generation_id: string
  attempt_no: number
  status: string
  output_text: string | null
  finish_reason: string | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number | null
  error_code: string | null
  truncated: number
  observed_model: string | null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

export async function getResults(deps: Deps, userId: string, runId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  const { run } = access
  if (run.status !== 'revealed' && run.status !== 'decided') throw stateConflict('Results are available after the judge reveals the models.')
  const db = deps.db
  const snapshot = parseSnapshot(run.snapshot_json)
  const manifest = JSON.parse(run.eligible_manifest_json ?? '{"caseKeys":[],"excludedCaseKeys":[],"entries":[]}') as EligibleManifest
  const cohortIds = JSON.parse(run.reveal_cohort_json ?? '[]') as string[]
  const generations = await loadGenerations(db, runId)
  const attempts = (
    await db
      .prepare(
        `SELECT a.id, a.generation_id, a.attempt_no, a.status, a.output_text, a.finish_reason, a.input_tokens, a.output_tokens, a.duration_ms, a.error_code, a.truncated, a.observed_model
         FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ? ORDER BY a.attempt_no`,
      )
      .bind(runId)
      .all<AttemptRow>()
  ).results
  const sessionRows = cohortIds.length
    ? (await db.prepare(`SELECT * FROM review_sessions WHERE id IN (${cohortIds.map(() => '?').join(',')})`).bind(...cohortIds).all<SessionRow>()).results
    : []
  // Stable, identity-free reviewer labels in cohort order.
  const ordered = cohortIds.map((id) => sessionRows.find((row) => row.id === id)).filter((row): row is SessionRow => !!row && row.status === 'submitted')
  let invitedNumber = 0
  const labelled = ordered.map((row) => ({ row, label: row.context_type === 'owner' ? 'Judge (context-aware)' : `Juror ${++invitedNumber}` }))

  const scored: ScoredSession[] = labelled.map(({ row }) => {
    const assignment = JSON.parse(row.assignment_json) as AssignmentCase[]
    return {
      sessionId: row.id,
      contextType: row.context_type,
      identityClueFlag: row.identity_clue_flag === 1,
      responses: assignment.flatMap((item) => item.responses.map((response) => ({ caseKey: item.caseKey, responseId: response.responseId, configurationKey: response.configurationKey }))),
      ratings: (JSON.parse(row.ratings_json) as DraftRating[]) as CompleteRating[],
    }
  })
  const configurationKeys = snapshot.configurations.map((configuration) => configuration.key)

  const coverage = Object.fromEntries(
    snapshot.configurations.map((configuration) => {
      const forConfig = generations.filter((generation) => generation.configuration_key === configuration.key)
      const configAttempts = attempts.filter((attempt) => forConfig.some((generation) => generation.id === attempt.generation_id))
      const succeeded = forConfig.filter((generation) => generation.status === 'succeeded').length
      return [
        configuration.key,
        {
          planned: forConfig.length,
          succeeded,
          failed: forConfig.filter((generation) => generation.status === 'failed').length,
          uncertain: forConfig.filter((generation) => generation.status === 'uncertain').length,
          canceled: forConfig.filter((generation) => generation.status === 'canceled').length,
          successRate: forConfig.length ? succeeded / forConfig.length : 0,
          attempts: configAttempts.length,
          failedAttempts: configAttempts.filter((attempt) => attempt.status === 'failed').length,
          uncertainAttempts: configAttempts.filter((attempt) => attempt.status === 'uncertain').length,
          medianLatencyMs: median(configAttempts.filter((attempt) => attempt.status === 'succeeded' && attempt.duration_ms !== null).map((attempt) => attempt.duration_ms!)),
          truncatedCount: configAttempts.filter((attempt) => attempt.status === 'succeeded' && attempt.truncated === 1).length,
        },
      ]
    }),
  )

  const cases = snapshot.cases.map((testCase) => {
    const eligible = manifest.caseKeys.includes(testCase.key)
    return {
      key: testCase.key,
      title: testCase.title,
      input: testCase.input,
      reference: testCase.reference,
      expectedBehavior: testCase.expectedBehavior,
      language: testCase.language ?? null,
      eligible,
      responses: snapshot.configurations.map((configuration) => {
        const generation = generations.find((g) => g.case_key === testCase.key && g.configuration_key === configuration.key)
        const accepted = attempts.find((attempt) => attempt.id === generation?.accepted_attempt_id)
        return {
          configurationKey: configuration.key,
          status: generation?.status ?? 'pending',
          errorCode: generation?.last_error_code ?? null,
          attemptCount: generation?.attempt_count ?? 0,
          text: accepted?.output_text ?? null,
          truncated: accepted?.truncated === 1,
          finishReason: accepted?.finish_reason ?? null,
          inputTokens: accepted?.input_tokens ?? null,
          outputTokens: accepted?.output_tokens ?? null,
          durationMs: accepted?.duration_ms ?? null,
          observedModel: accepted?.observed_model ?? null,
        }
      }),
      judgments: eligible
        ? labelled.flatMap(({ row, label }, index) => {
            const session = scored[index]
            return session.responses
              .filter((response) => response.caseKey === testCase.key)
              .map((response) => {
                const rating = session.ratings.find((r) => r.responseId === response.responseId)
                return {
                  reviewer: label,
                  contextType: row.context_type,
                  configurationKey: response.configurationKey,
                  correctness: rating?.correctness ?? null,
                  completeness: rating?.completeness ?? null,
                  grounding: rating?.grounding ?? null,
                  note: rating?.note ?? '',
                  suspectedIdentityClue: rating?.suspectedIdentityClue ?? false,
                }
              })
          })
        : [],
    }
  })

  const verdicts = (
    await db
      .prepare(`SELECT revision, outcome, selected_configuration_key, rationale, limitations, created_at FROM verdict_revisions WHERE run_id = ? ORDER BY revision`)
      .bind(runId)
      .all<{ revision: number; outcome: 'selected' | 'tie' | 'inconclusive'; selected_configuration_key: string | null; rationale: string; limitations: string; created_at: number }>()
  ).results

  return {
    runId,
    role: access.role,
    evaluationTitle: access.evaluation.title,
    status: run.status,
    revision: run.revision,
    revealedAt: run.revealed_at,
    createdAt: run.created_at,
    comparisonMode: snapshot.comparisonMode,
    snapshotHash: run.snapshot_hash,
    rubricVersion: snapshot.rubricVersion,
    messageTemplateVersion: snapshot.messageTemplateVersion,
    providerRegistryVersion: snapshot.providerRegistryVersion,
    appCommit: snapshot.appCommit,
    // Credential references are execution authorization, never evidence: not included.
    configurations: snapshot.configurations.map((c) => ({ key: c.key, label: c.label, provider: c.provider, modelId: c.modelId, systemPrompt: c.systemPrompt, maxOutputTokens: c.maxOutputTokens })),
    plannedCaseCount: snapshot.cases.length,
    eligibleCaseKeys: manifest.caseKeys,
    excludedCaseKeys: manifest.excludedCaseKeys,
    cohorts: {
      invited: scoreCohort('invited', manifest.caseKeys, configurationKeys, scored),
      owner: scoreCohort('owner', manifest.caseKeys, configurationKeys, scored),
    },
    disagreements: findDisagreements(scored),
    byLanguage: languageBreakdown(snapshot.cases, manifest.caseKeys, configurationKeys, scored),
    coverage,
    cases,
    verdicts: verdicts.map((verdict) => ({
      revision: verdict.revision,
      outcome: verdict.outcome,
      selectedConfigurationKey: verdict.selected_configuration_key,
      rationale: verdict.rationale,
      limitations: verdict.limitations,
      createdAt: verdict.created_at,
    })),
  }
}

/**
 * Findings per language tag (D-36), only when eligible questions carry at
 * least two distinct tags. Untagged questions form their own group. Each
 * group is scored exactly like the whole cohort, on its own questions.
 */
export function languageBreakdown(cases: ReadonlyArray<{ key: string; language?: string }>, eligibleCaseKeys: readonly string[], configurationKeys: readonly string[], scored: ScoredSession[]) {
  const eligible = cases.filter((testCase) => eligibleCaseKeys.includes(testCase.key))
  const tags = new Set(eligible.map((testCase) => testCase.language).filter((tag): tag is string => !!tag))
  if (tags.size < 2) return []
  const groups = new Map<string | null, string[]>()
  for (const testCase of eligible) {
    const tag = testCase.language ?? null
    groups.set(tag, [...(groups.get(tag) ?? []), testCase.key])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)))
    .map(([language, caseKeys]) => ({
      language,
      caseKeys,
      invited: scoreCohort('invited', caseKeys, configurationKeys, scored),
      owner: scoreCohort('owner', caseKeys, configurationKeys, scored),
    }))
}

export async function recordVerdict(deps: Deps, userId: string, runId: string, input: z.output<typeof verdictSchema>, ifMatch: number, key: string, requestId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  requireOwner(access)
  const operation = `run.verdict:${runId}`
  const result = await idempotent(deps, { actorUserId: userId, idempotencyKey: key, operation, requestHash: await requestHash(operation, { ...input, ifMatch }) }, async (receipt) => {
    if (!canRun('verdict', access.run.status)) throw stateConflict('A verdict can be recorded after reveal.')
    if (access.run.revision !== ifMatch) throw revisionConflict()
    const snapshot = parseSnapshot(access.run.snapshot_json)
    if (input.selectedConfigurationKey && !snapshot.configurations.some((c) => c.key === input.selectedConfigurationKey)) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'Select one of this run’s configurations.')
    }
    const db = deps.db
    const now = deps.now()
    const verdictId = deps.newId()
    const current = await db.prepare('SELECT COALESCE(MAX(revision), 0) AS max FROM verdict_revisions WHERE run_id = ?').bind(runId).first<{ max: number }>()
    const verdictRevision = (current?.max ?? 0) + 1
    const response = { status: 201 as const, data: { runId, status: 'decided' as RunStatus, revision: ifMatch + 1, verdictRevision } }
    try {
      await runGuarded(
        db,
        'run.verdict',
        all(
          cond(`EXISTS (SELECT 1 FROM runs WHERE id = ? AND owner_user_id = ? AND revision = ? AND status IN ('revealed','decided'))`, runId, userId, ifMatch),
          cond('(SELECT COALESCE(MAX(revision), 0) FROM verdict_revisions WHERE run_id = ?) = ?', runId, verdictRevision - 1),
        ),
        [
          db
            .prepare(
              `INSERT INTO verdict_revisions (id, run_id, revision, outcome, selected_configuration_key, rationale, limitations, created_by, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(verdictId, runId, verdictRevision, input.outcome, input.selectedConfigurationKey ?? null, input.rationale, input.limitations, userId, now),
          db.prepare(`UPDATE runs SET status = 'decided', revision = revision + 1, updated_at = ? WHERE id = ?`).bind(now, runId),
          auditStatement(db, { eventType: 'verdict.record', requestId, outcome: input.outcome, actorUserId: userId, runId, evaluationId: access.run.evaluation_id, metadata: { verdictRevision } }, now),
          receipt(response, verdictId),
        ],
      )
    } catch (error) {
      if (error instanceof GuardFailed) throw revisionConflict()
      throw error
    }
    return response
  })
  if (!result.replayed) await notifyRun(deps, runId)
  return result
}
