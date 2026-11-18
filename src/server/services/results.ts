/**
 * Revealed results and verdicts (F14, F15; spec §2.6). Results are computed on
 * demand from the frozen manifest and the cohort captured at reveal.
 */

import { z } from 'zod'
import type { DraftRating } from '../../domain/contracts'
import { verdictSchema } from '../../domain/contracts'
import { priceTableFor } from '../../domain/prices'
import { findDisagreements, scoreCohort, type CompleteRating, type ScoredSession } from '../../domain/rubric'
import { median, setupMetrics, type AttemptStatus, type UsageRecord } from '../../domain/setup-metrics'
import { canRun, type RunStatus } from '../../domain/transitions'
import { loadRunAccess, requireOwner, type SessionRow } from '../access'
import { all, auditStatement, cond, GuardFailed, runGuarded } from '../db/sql'
import type { Deps } from '../deps'
import { ApiError, revisionConflict, stateConflict } from '../http'
import { idempotent, requestHash } from '../receipts'
import { notifyRun } from './generation'
import { isImportedSnapshot, samplesPerAnswer } from '../../domain/snapshot'
import { loadGenerations, parseSnapshot, primarySample, samplesFor, type AssignmentCase, type EligibleManifest } from './runs'

interface AttemptRow {
  id: string
  generation_id: string
  attempt_no: number
  status: string
  output_text: string | null
  finish_reason: string | null
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  reasoning_tokens: number | null
  duration_ms: number | null
  error_code: string | null
  truncated: number
  observed_model: string | null
}

export async function getResults(deps: Deps, userId: string, runId: string) {
  const access = await loadRunAccess(deps.db, runId, userId)
  const { run } = access
  if (run.status !== 'revealed' && run.status !== 'decided') throw stateConflict('Results are available after the judge reveals the models.')
  const db = deps.db
  const snapshot = parseSnapshot(run.snapshot_json)
  const manifest = JSON.parse(run.eligible_manifest_json ?? '{"caseKeys":[],"excludedCaseKeys":[],"entries":[]}') as EligibleManifest
  const cohortIds = JSON.parse(run.reveal_cohort_json ?? '[]') as string[]
  const samples = samplesPerAnswer(snapshot)
  const generations = await loadGenerations(db, runId)
  const attempts = (
    await db
      .prepare(
        `SELECT a.id, a.generation_id, a.attempt_no, a.status, a.output_text, a.finish_reason, a.input_tokens, a.output_tokens, a.cached_input_tokens, a.reasoning_tokens, a.duration_ms, a.error_code, a.truncated, a.observed_model
         FROM generation_attempts a JOIN generations g ON g.id = a.generation_id WHERE g.run_id = ? ORDER BY a.attempt_no`,
      )
      .bind(runId)
      .all<AttemptRow>()
  ).results
  const importedOutputs = (
    await db
      .prepare('SELECT configuration_key, case_key, text, text_sha256, byte_length FROM run_imported_outputs WHERE run_id = ?')
      .bind(runId)
      .all<{ configuration_key: string; case_key: string; text: string; text_sha256: string; byte_length: number }>()
  ).results
  const sessionRows = cohortIds.length
    ? (await db.prepare(`SELECT * FROM review_sessions WHERE id IN (${cohortIds.map(() => '?').join(',')})`).bind(...cohortIds).all<SessionRow>()).results
    : []
  // Stable, identity-free reviewer labels in cohort order.
  const ordered = cohortIds.map((id) => sessionRows.find((row) => row.id === id)).filter((row): row is SessionRow => !!row && row.status === 'submitted')
  let invitedNumber = 0
  const labelled = ordered.map((row) => ({
    row,
    label: row.context_type === 'owner' ? 'Judge (context-aware)' : `Juror ${++invitedNumber}${row.reviewer_user_id.startsWith('mcj_') ? ' (guest, no account)' : ''}`,
  }))

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
      if (isImportedSnapshot(configuration)) {
        const count = importedOutputs.filter((output) => output.configuration_key === configuration.key).length
        return [
          configuration.key,
          { planned: snapshot.cases.length, succeeded: count, failed: 0, uncertain: 0, canceled: 0, successRate: snapshot.cases.length ? count / snapshot.cases.length : 0, attempts: 0, failedAttempts: 0, uncertainAttempts: 0, medianLatencyMs: null, truncatedCount: 0, source: 'imported' as const },
        ]
      }
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
      messages: testCase.messages ?? [],
      language: testCase.language ?? null,
      eligible,
      responses: snapshot.configurations.map((configuration) => {
        if (isImportedSnapshot(configuration)) {
          const output = importedOutputs.find((o) => o.case_key === testCase.key && o.configuration_key === configuration.key)
          return {
            configurationKey: configuration.key,
            status: 'imported' as const,
            errorCode: null,
            attemptCount: 0,
            text: output?.text ?? null,
            truncated: false,
            finishReason: null,
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            durationMs: null,
            observedModel: null,
            sha256: output?.text_sha256 ?? null,
          }
        }
        // The primary sample: the one the jury scored when eligible (D-65), else the lowest succeeded, else sample 1.
        const entry = manifest.entries.find((e) => e.caseKey === testCase.key && e.configurationKey === configuration.key)
        const slot = samplesFor(generations, testCase.key, configuration.key)
        const generation = (entry && slot.find((g) => g.id === entry.generationId)) ?? primarySample(generations, testCase.key, configuration.key) ?? slot[0]
        const accepted = attempts.find((attempt) => attempt.id === generation?.accepted_attempt_id)
        return {
          configurationKey: configuration.key,
          sampleNo: generation?.sample_no ?? 1,
          status: generation?.status ?? 'pending',
          errorCode: generation?.last_error_code ?? null,
          attemptCount: generation?.attempt_count ?? 0,
          text: accepted?.output_text ?? null,
          truncated: accepted?.truncated === 1,
          finishReason: accepted?.finish_reason ?? null,
          inputTokens: accepted?.input_tokens ?? null,
          outputTokens: accepted?.output_tokens ?? null,
          cachedInputTokens: accepted?.cached_input_tokens ?? null,
          reasoningTokens: accepted?.reasoning_tokens ?? null,
          durationMs: accepted?.duration_ms ?? null,
          observedModel: accepted?.observed_model ?? null,
          // Every sample side by side, only when the judge asked for repeats (D-65). After reveal only, like everything here.
          ...(samples > 1
            ? {
                samples: slot.map((g) => {
                  const ok = attempts.find((attempt) => attempt.id === g.accepted_attempt_id)
                  return {
                    sampleNo: g.sample_no,
                    primary: g.id === generation?.id,
                    status: g.status,
                    errorCode: g.last_error_code,
                    attemptCount: g.attempt_count,
                    text: ok?.output_text ?? null,
                    truncated: ok?.truncated === 1,
                    inputTokens: ok?.input_tokens ?? null,
                    outputTokens: ok?.output_tokens ?? null,
                    cachedInputTokens: ok?.cached_input_tokens ?? null,
                    reasoningTokens: ok?.reasoning_tokens ?? null,
                    durationMs: ok?.duration_ms ?? null,
                  }
                }),
              }
            : {}),
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

  // Cost and speed (D-63): computed on read from recorded usage and the dated price table for the
  // hearing's creation day. No provider call; only after reveal, like everything else here.
  const prices = priceTableFor(run.created_at, deps.priceTables)
  const usageRecords: UsageRecord[] = generations.map((generation) => ({
    caseKey: generation.case_key,
    configurationKey: generation.configuration_key,
    sampleNo: generation.sample_no,
    status: generation.status,
    attempts: attempts
      .filter((attempt) => attempt.generation_id === generation.id)
      .map((attempt) => ({
        attemptNo: attempt.attempt_no,
        status: attempt.status as AttemptStatus,
        errorCode: attempt.error_code,
        definite: attempt.status === 'failed' ? true : attempt.status === 'uncertain' ? false : null,
        inputTokens: attempt.input_tokens,
        outputTokens: attempt.output_tokens,
        cachedInputTokens: attempt.cached_input_tokens,
        reasoningTokens: attempt.reasoning_tokens,
        durationMs: attempt.duration_ms,
      })),
  }))
  const metrics = setupMetrics(
    {
      parties: snapshot.configurations.map((c) =>
        isImportedSnapshot(c) ? { key: c.key, source: 'imported' as const, provider: null, routeKey: null } : { key: c.key, source: 'generated' as const, provider: c.provider, routeKey: c.modelKey },
      ),
      eligibleCaseKeys: manifest.caseKeys,
      records: usageRecords,
    },
    prices.table,
    Object.fromEntries(
      snapshot.configurations.filter(isImportedSnapshot).map((c) => [c.key, { planned: snapshot.cases.length, present: importedOutputs.filter((output) => output.configuration_key === c.key).length }]),
    ),
  )

  const verdicts = (
    await db
      .prepare(`SELECT revision, outcome, selected_configuration_key, rationale, limitations, created_at FROM verdict_revisions WHERE run_id = ? ORDER BY revision`)
      .bind(runId)
      .all<{ revision: number; outcome: 'selected' | 'tie' | 'inconclusive'; selected_configuration_key: string | null; rationale: string; limitations: string; created_at: number }>()
  ).results

  return {
    runId,
    role: access.role,
    // Same case reference the run view already gives both roles; used for breadcrumbs.
    evaluationId: access.evaluation.id,
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
    samplesPerAnswer: samples,
    // Credential references are execution authorization, never evidence: not included.
    // Imported parties carry their provenance instead of a model; generated parties keep their earlier shape.
    configurations: snapshot.configurations.map((c) =>
      isImportedSnapshot(c)
        ? { key: c.key, label: c.label, provider: null, modelId: null, systemPrompt: null, maxOutputTokens: null, source: 'imported' as const, provenance: c.provenance }
        : { key: c.key, label: c.label, provider: c.provider, modelId: c.modelId, systemPrompt: c.systemPrompt, maxOutputTokens: c.maxOutputTokens },
    ),
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
    priceTable: { version: prices.table.version, readOn: prices.table.readOn, sources: prices.table.sources, predates: prices.predates },
    setupMetrics: metrics,
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
