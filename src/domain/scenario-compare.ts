/**
 * Comparing hearings of one case (spec 02 §6.4, D-70). Pure.
 *
 * Nothing is pooled across hearings. Each hearing is scored on its own,
 * exactly like the record's headline (D-60): a party's points on a question
 * are its three rubric lines summed (0–6), averaged over the raters of that
 * hearing's rater source (the jury when any juror filed, else the judge's own
 * review; never both). The only bridge between hearings is an anchor party,
 * a setup with the same fingerprint in every selected hearing: other parties
 * are compared with it inside their own hearing, on the questions every
 * hearing shares.
 */

const EPSILON = 1e-9

export interface CompareParty {
  key: string
  label: string
  fingerprint: string
  source: 'model' | 'imported'
  provider: string | null
  modelId: string | null
  adapterVersion: string | null
}

export interface CompareSession {
  contextType: 'invited' | 'owner'
  /** A signed-in juror's account, for overlap counts only (never returned); null for guests. */
  accountId: string | null
  identityClueFlag: boolean
  /** This juror saw an earlier unsealed record that shares a party with this hearing (Q1: labeled, not refused). */
  repeatJuror: boolean
  /** Rubric lines summed (0–6), one entry per scored response. */
  scores: Array<{ caseKey: string; configurationKey: string; points: number }>
}

export interface CompareHearingInput {
  runId: string
  createdAt: number
  revealedAt: number | null
  scenarioHash: string
  scenarioVersion: number
  rubricVersion: string
  messageTemplateVersion: string
  parties: CompareParty[]
  /** Every question of the snapshot, with its content hash and whether it was eligible. */
  questions: Array<{ caseKey: string; questionHash: string; title: string; eligible: boolean }>
  /** Submitted sessions of the reveal cohort only. */
  sessions: CompareSession[]
}

export type ComparisonCaveat = 'different_juries' | 'few_raters' | 'questions_partial' | 'rubric_differs' | 'template_differs' | 'rater_source_differs' | 'adapter_changed' | 'no_anchor' | 'repeat_jurors'

export const FEW_RATERS = 3

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

function raterSourceOf(hearing: CompareHearingInput): 'jury' | 'judge' {
  return hearing.sessions.some((session) => session.contextType === 'invited') ? 'jury' : 'judge'
}

/** Points per party per case for one hearing, from its rater source only. Missing scores leave the cell out. */
function pointsByCase(hearing: CompareHearingInput, caseKeys: ReadonlySet<string>): Map<string, Map<string, number>> {
  const source = raterSourceOf(hearing) === 'jury' ? 'invited' : 'owner'
  const sessions = hearing.sessions.filter((session) => session.contextType === source)
  const result = new Map<string, Map<string, number>>()
  for (const party of hearing.parties) {
    const byCase = new Map<string, number>()
    for (const caseKey of caseKeys) {
      const points = sessions.flatMap((session) => session.scores.filter((score) => score.caseKey === caseKey && score.configurationKey === party.key).map((score) => score.points))
      const value = mean(points)
      if (value !== null) byCase.set(caseKey, value)
    }
    result.set(party.key, byCase)
  }
  return result
}

export function compareHearings(input: readonly CompareHearingInput[]) {
  const hearings = [...input].sort((a, b) => a.createdAt - b.createdAt || (a.runId < b.runId ? -1 : 1))
  // Common questions: eligible in every hearing, matched by content.
  const eligibleHashes = hearings.map((hearing) => new Set(hearing.questions.filter((q) => q.eligible).map((q) => q.questionHash)))
  const common = new Set([...(eligibleHashes[0] ?? [])].filter((hash) => eligibleHashes.every((set) => set.has(hash))))
  const commonCases = new Map(hearings.map((hearing) => [hearing.runId, new Set(hearing.questions.filter((q) => q.eligible && common.has(q.questionHash)).map((q) => q.caseKey))]))
  const points = new Map(hearings.map((hearing) => [hearing.runId, pointsByCase(hearing, commonCases.get(hearing.runId)!)]))

  const allHashes = new Map<string, { title: string; presentIn: string[] }>()
  for (const hearing of hearings) {
    for (const question of hearing.questions) {
      const entry = allHashes.get(question.questionHash) ?? { title: question.title, presentIn: [] }
      entry.title = question.title // the newest hearing's title wins
      if (!entry.presentIn.includes(hearing.runId)) entry.presentIn.push(hearing.runId)
      allHashes.set(question.questionHash, entry)
    }
  }

  const raterCount = (hearing: CompareHearingInput) => hearing.sessions.filter((session) => session.contextType === (raterSourceOf(hearing) === 'jury' ? 'invited' : 'owner')).length
  const partyMean = (hearing: CompareHearingInput, key: string) => {
    const byCase = points.get(hearing.runId)!.get(key)!
    return { meanPoints: mean([...byCase.values()]), questions: byCase.size }
  }

  const questionSets = hearings.map((hearing) => [...new Set(hearing.questions.map((q) => q.questionHash))].sort().join(','))
  const comparable = {
    sameQuestions: new Set(questionSets).size <= 1,
    sameRubric: new Set(hearings.map((h) => h.rubricVersion)).size <= 1,
    sameTemplate: new Set(hearings.map((h) => h.messageTemplateVersion)).size <= 1,
    sameRaterSource: new Set(hearings.map(raterSourceOf)).size <= 1,
    // The same setup sent in a different request format (an app upgrade, D-48).
    adapterChanged: [...new Set(hearings.flatMap((h) => h.parties.map((p) => p.fingerprint)))].some(
      (fingerprint) => new Set(hearings.flatMap((h) => h.parties.filter((p) => p.fingerprint === fingerprint && p.adapterVersion !== null).map((p) => p.adapterVersion))).size > 1,
    ),
  }

  // Juror overlap per pair: signed-in jurors only; guests are per hearing and cannot be matched.
  const jurorOverlap: Array<{ runIds: [string, string]; shared: number; knowable: number; guests: number }> = []
  for (let i = 0; i < hearings.length; i++) {
    for (let j = i + 1; j < hearings.length; j++) {
      const accounts = (h: CompareHearingInput) => new Set(h.sessions.filter((s) => s.contextType === 'invited' && s.accountId !== null).map((s) => s.accountId!))
      const a = accounts(hearings[i])
      const b = accounts(hearings[j])
      const guests = [hearings[i], hearings[j]].reduce((sum, h) => sum + h.sessions.filter((s) => s.contextType === 'invited' && s.accountId === null).length, 0)
      jurorOverlap.push({ runIds: [hearings[i].runId, hearings[j].runId], shared: [...a].filter((id) => b.has(id)).length, knowable: Math.min(a.size, b.size), guests })
    }
  }

  // Anchors: the same setup in every selected hearing.
  const anchorPrints = hearings.length ? [...new Set(hearings[0].parties.map((p) => p.fingerprint))].filter((fingerprint) => hearings.every((h) => h.parties.some((p) => p.fingerprint === fingerprint))) : []
  const anchors = anchorPrints.map((fingerprint) => ({
    fingerprint,
    label: [...hearings].reverse().map((h) => h.parties.find((p) => p.fingerprint === fingerprint)!.label)[0],
    byHearing: Object.fromEntries(
      hearings.map((hearing) => {
        const party = hearing.parties.find((p) => p.fingerprint === fingerprint)!
        return [hearing.runId, { configurationKey: party.key, ...partyMean(hearing, party.key), raters: raterCount(hearing) }]
      }),
    ) as Record<string, { configurationKey: string; meanPoints: number | null; questions: number; raters: number }>,
  }))

  const relative = anchors.flatMap((anchor) =>
    hearings.flatMap((hearing) => {
      const anchorKey = anchor.byHearing[hearing.runId].configurationKey
      const anchorPoints = points.get(hearing.runId)!.get(anchorKey)!
      return hearing.parties
        .filter((party) => !anchorPrints.includes(party.fingerprint))
        .map((party) => {
          const partyPoints = points.get(hearing.runId)!.get(party.key)!
          const diffs = [...partyPoints.entries()].filter(([caseKey]) => anchorPoints.has(caseKey)).map(([caseKey, value]) => value - anchorPoints.get(caseKey)!)
          return {
            runId: hearing.runId,
            configurationKey: party.key,
            label: party.label,
            anchorFingerprint: anchor.fingerprint,
            meanDiff: mean(diffs),
            better: diffs.filter((d) => d > EPSILON).length,
            worse: diffs.filter((d) => d < -EPSILON).length,
            tied: diffs.filter((d) => Math.abs(d) <= EPSILON).length,
            questions: diffs.length,
            raters: raterCount(hearing),
          }
        })
    }),
  )

  const caveats = new Set<ComparisonCaveat>()
  if (hearings.some((h) => raterSourceOf(h) === 'jury')) caveats.add('different_juries')
  if (hearings.some((h) => raterCount(h) < FEW_RATERS)) caveats.add('few_raters')
  if (!comparable.sameQuestions) caveats.add('questions_partial')
  if (!comparable.sameRubric) caveats.add('rubric_differs')
  if (!comparable.sameTemplate) caveats.add('template_differs')
  if (!comparable.sameRaterSource) caveats.add('rater_source_differs')
  if (comparable.adapterChanged) caveats.add('adapter_changed')
  if (anchors.length === 0) caveats.add('no_anchor')
  if (hearings.some((h) => h.sessions.some((s) => s.repeatJuror))) caveats.add('repeat_jurors')

  return {
    hearings: hearings.map((hearing) => ({
      runId: hearing.runId,
      createdAt: hearing.createdAt,
      revealedAt: hearing.revealedAt,
      scenarioHash: hearing.scenarioHash,
      scenarioVersion: hearing.scenarioVersion,
      rubricVersion: hearing.rubricVersion,
      messageTemplateVersion: hearing.messageTemplateVersion,
      raterSource: raterSourceOf(hearing),
      raterCount: raterCount(hearing),
      guestRaterCount: hearing.sessions.filter((s) => s.contextType === 'invited' && s.accountId === null).length,
      // Like identity clues (D-60's cohort count), never part of the hearing's own scored results.
      potentiallyUnblindedCount: hearing.sessions.filter((s) => s.contextType === 'invited' && (s.identityClueFlag || s.repeatJuror)).length,
      repeatJurorCount: hearing.sessions.filter((s) => s.contextType === 'invited' && s.repeatJuror).length,
      parties: hearing.parties.map((party) => ({ key: party.key, label: party.label, fingerprint: party.fingerprint, source: party.source, provider: party.provider, modelId: party.modelId, ...partyMean(hearing, party.key) })),
    })),
    questions: [...allHashes.entries()].map(([questionHash, entry]) => ({ questionHash, title: entry.title, presentIn: entry.presentIn })),
    commonQuestionCount: common.size,
    comparable,
    jurorOverlap,
    anchors,
    relative,
    caveats: [...caveats],
  }
}

export type Comparison = ReturnType<typeof compareHearings>
