/**
 * Compare hearings of one case (spec 02 §6.4, D-70). Owner only, unsealed
 * hearings only. Each hearing is loaded and scored by the same code as its
 * record (`loadScoredRun`), then the pure `compareHearings` lines them up
 * without pooling anything.
 */

import { DIMENSIONS } from '../../domain/rubric'
import { LIMITS } from '../../domain/limits'
import { compareHearings, type CompareHearingInput } from '../../domain/scenario-compare'
import { questionHashes, scenarioHash, scenarioSourceOfSnapshot } from '../../domain/scenario'
import { isImportedSnapshot } from '../../domain/snapshot'
import type { RunRow } from '../access'
import type { Deps } from '../deps'
import { ApiError, notFound, stateConflict } from '../http'
import { loadScoredRun, runSetupMetrics } from './results'
import { caseVersions, hearingParties, isUnsealedStatus, loadOwnedEvaluation } from './scenarios'
import { parseStoredDraft } from './evaluations'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseRunIds(value: string | undefined): string[] {
  const ids = [...new Set((value ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
  if (ids.length < 2 || ids.length > LIMITS.compareHearingsMax || !ids.every((id) => UUID.test(id))) {
    throw new ApiError(422, 'VALIDATION_FAILED', `Choose 2 to ${LIMITS.compareHearingsMax} different hearings of this case.`, { fields: [{ path: 'runIds', message: `2 to ${LIMITS.compareHearingsMax} hearing ids` }] })
  }
  return ids
}

export async function getComparison(deps: Deps, userId: string, evaluationId: string, runIds: readonly string[]) {
  const evaluation = await loadOwnedEvaluation(deps.db, evaluationId, userId)
  const db = deps.db
  // Every run of the case, for version numbers and for repeat jurors on earlier hearings.
  const caseRuns = (await db.prepare('SELECT * FROM runs WHERE evaluation_id = ?').bind(evaluationId).all<RunRow>()).results
  const selected = runIds.map((id) => caseRuns.find((run) => run.id === id))
  if (selected.some((run) => !run)) throw notFound()
  const sealed = (selected as RunRow[]).find((run) => !isUnsealedStatus(run.status))
  if (sealed) throw stateConflict('Only unsealed hearings can be compared.', { sealedRunId: sealed.id })
  const versions = await caseVersions(caseRuns, parseStoredDraft(evaluation))

  // Signed-in jurors of each unsealed hearing, and when it was unsealed: a juror seated after
  // seeing an unsealed record that shares a party with a later hearing may not be blind there (Q1).
  const unsealedRuns = caseRuns.filter((run) => isUnsealedStatus(run.status) && run.revealed_at !== null)
  const seats = (
    await db
      .prepare(`SELECT s.run_id, s.reviewer_user_id FROM review_sessions s JOIN runs r ON r.id = s.run_id WHERE r.evaluation_id = ? AND s.context_type = 'invited' AND s.status <> 'revoked'`)
      .bind(evaluationId)
      .all<{ run_id: string; reviewer_user_id: string }>()
  ).results
  const printsByRun = new Map<string, Set<string>>()
  for (const run of unsealedRuns) {
    const parties = await hearingParties(JSON.parse(run.snapshot_json))
    printsByRun.set(run.id, new Set(parties.map((party) => party.fingerprint)))
  }

  const inputs: CompareHearingInput[] = []
  const setup: Record<string, ReturnType<typeof runSetupMetrics>['metrics']> = {}
  for (const run of selected as RunRow[]) {
    const loaded = await loadScoredRun(deps, run)
    setup[run.id] = runSetupMetrics(deps, run, loaded).metrics
    const { snapshot, manifest, labelled, scored } = loaded
    const parties = await hearingParties(snapshot)
    const prints = new Set(parties.map((party) => party.fingerprint))
    const hashes = await questionHashes(snapshot.cases)
    const isRepeat = (accountId: string, joinedAt: number) =>
      unsealedRuns.some(
        (earlier) =>
          earlier.id !== run.id &&
          earlier.revealed_at! <= joinedAt &&
          seats.some((seat) => seat.run_id === earlier.id && seat.reviewer_user_id === accountId) &&
          [...(printsByRun.get(earlier.id) ?? [])].some((fingerprint) => prints.has(fingerprint)),
      )
    inputs.push({
      runId: run.id,
      createdAt: run.created_at,
      revealedAt: run.revealed_at,
      scenarioHash: await scenarioHash(scenarioSourceOfSnapshot(snapshot)),
      scenarioVersion: versions.byRun.get(run.id)!.scenarioVersion,
      rubricVersion: snapshot.rubricVersion,
      messageTemplateVersion: snapshot.messageTemplateVersion,
      parties: parties.map((party) => {
        const frozen = snapshot.configurations.find((c) => c.key === party.key)!
        return { ...party, adapterVersion: isImportedSnapshot(frozen) ? null : frozen.adapterVersion }
      }),
      questions: snapshot.cases.map((testCase) => ({ caseKey: testCase.key, questionHash: hashes.get(testCase.key)!, title: testCase.title, eligible: manifest.caseKeys.includes(testCase.key) })),
      sessions: labelled.map(({ row }, index) => {
        const session = scored[index]
        const guest = row.reviewer_user_id.startsWith('mcj_')
        const ratingById = new Map(session.ratings.map((rating) => [rating.responseId, rating]))
        return {
          contextType: row.context_type,
          // Guest principals are per hearing (D-41), so they can never be matched across hearings.
          accountId: row.context_type === 'invited' && !guest ? row.reviewer_user_id : null,
          identityClueFlag: row.identity_clue_flag === 1,
          repeatJuror: row.context_type === 'invited' && !guest && isRepeat(row.reviewer_user_id, row.joined_at),
          scores: session.responses
            .filter((response) => manifest.caseKeys.includes(response.caseKey))
            .flatMap((response) => {
              const rating = ratingById.get(response.responseId)
              return rating ? [{ caseKey: response.caseKey, configurationKey: response.configurationKey, points: DIMENSIONS.reduce((sum, d) => sum + rating[d], 0) }] : []
            }),
        }
      }),
    })
  }
  const comparison = compareHearings(inputs)
  return {
    evaluationId,
    evaluationTitle: evaluation.title,
    ...comparison,
    // Item 1's per-party cost and speed, one hearing at a time (never summed across hearings).
    setupMetrics: setup,
  }
}
