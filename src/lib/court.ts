/**
 * Courtroom vocabulary (D-24, D-25). Display strings only: API fields, enum
 * values, and error codes keep their original names. Keys, cost, consent,
 * and deletion are never given court names.
 */

export interface CourtTerm {
  term: string
  /** Plain meaning, shown beside the term on first appearance and in the glossary. */
  plain: string
  /** One-sentence explanation for the glossary page. */
  explain: string
}

export const TERMS = {
  case: { term: 'Case', plain: 'evaluation', explain: 'One comparison you set up: the questions, the evidence, and the two parties being compared.' },
  docket: { term: 'Docket', plain: 'your evaluations', explain: 'The list of every case you judge or sit on as a juror.' },
  judge: { term: 'Judge', plain: 'evaluation owner', explain: 'The person who opens the case, supplies the provider keys, unseals the record, and enters judgment.' },
  juror: { term: 'Juror', plain: 'invited reviewer', explain: 'Someone you summon to score the testimony blind. Jurors never need an API key.' },
  question: { term: 'Question presented', plain: 'test case', explain: 'One question put to both parties. A case has up to five.' },
  exhibit: { term: 'Exhibit', plain: 'reference evidence, sent to the models', explain: 'The source material each party should rely on when answering.' },
  instructions: { term: 'Jury instructions', plain: 'scoring guide, never sent to the models', explain: 'What a good answer looks like. Only the judge and jurors see it.' },
  parties: { term: 'Parties', plain: 'the configurations being compared', explain: 'The two model and prompt setups. Their names stay sealed until the record is unsealed.' },
  hearing: { term: 'Hearing', plain: 'run', explain: 'One round of generation and review, frozen when it starts so later edits never change it.' },
  testimony: { term: 'Testimony', plain: 'a response, shuffled and unlabeled', explain: 'What a party answered. Labels A and B are shuffled for every question and every juror.' },
  summons: { term: 'Jury summons', plain: 'invitation link', explain: 'A single-use link, valid for 24 hours, that seats one juror.' },
  worksheet: { term: 'Juror’s worksheet', plain: 'your ratings', explain: 'Where each juror scores every testimony on correctness, completeness, and grounding.' },
  file: { term: 'File findings', plain: 'submit your ratings', explain: 'Hands your worksheet to the clerk. Filed findings can’t be changed.' },
  unseal: { term: 'Unseal the record', plain: 'reveal the models', explain: 'Shows which party gave which testimony and closes the jury.' },
  findings: { term: 'The jury’s findings', plain: 'invited reviewers’ scores', explain: 'Scores from jurors only. The judge’s own review is always reported separately.' },
  record: { term: 'The record', plain: 'results', explain: 'Everything the hearing produced: testimony, findings, failures, and disagreements.' },
  judgment: { term: 'Judgment', plain: 'your verdict', explain: 'Your recorded decision and reasons. It may disagree with the numbers; say why.' },
  checks: { term: 'Automatic checks', plain: 'free tests on every answer', explain: 'Free tests Model Court runs on every answer, such as length or whether a label matches your answer key. Shown after unsealing, next to the jury’s findings and never mixed into them.' },
  scenario: { term: 'Scenario version', plain: 'the same questions', explain: 'Hearings that asked exactly the same questions, exhibits and jury instructions share a version (v1, v2…), so they can be compared. Fixing a question’s title keeps the version.' },
  anchor: { term: 'Anchor party', plain: 'a setup heard in both hearings', explain: 'The same model and instructions heard in two hearings. Other parties are compared with it inside their own hearing, never by adding scores across hearings.' },
  certified: { term: 'Certified record', plain: 'download', explain: 'A downloadable copy of a hearing’s record, with a fingerprint so two copies can be compared. Only the judge can download it.' },
} as const satisfies Record<string, CourtTerm>

export type TermKey = keyof typeof TERMS

/**
 * Display-only docket number from the evaluation id, the same on every page.
 * Never used as an identifier or in a URL.
 */
export function docketNumber(evaluationId: string): string {
  const hex = evaluationId.replace(/[^0-9a-f]/gi, '').toUpperCase().padEnd(8, '0')
  return `MC-${hex.slice(0, 4)}-${hex.slice(4, 8)}`
}

/** The caption stamp for a hearing's status. */
export function recordStamp(runStatus: string | null | undefined): 'sealed' | 'unsealed' | 'entered' | null {
  if (runStatus === 'revealed') return 'unsealed'
  if (runStatus === 'decided') return 'entered'
  if (runStatus === 'generating' || runStatus === 'ready' || runStatus === 'reviewing') return 'sealed'
  return null
}

export const CASE_STEPS = [
  { key: 'file', name: 'File', plain: 'Set up the case' },
  { key: 'hear', name: 'Hear', plain: 'Generate testimony' },
  { key: 'deliberate', name: 'Deliberate', plain: 'Review blind' },
  { key: 'unseal', name: 'Unseal', plain: 'Reveal the parties' },
  { key: 'judgment', name: 'Judgment', plain: 'Record your verdict' },
] as const

export type CaseStep = (typeof CASE_STEPS)[number]['key']

/** Where a case stands, from its latest hearing's status (or none yet). */
export function caseStep(runStatus: string | null | undefined): { step: CaseStep; complete: boolean } {
  switch (runStatus) {
    case null:
    case undefined:
      return { step: 'file', complete: false }
    case 'generating':
    case 'canceled':
      return { step: 'hear', complete: false }
    case 'ready':
    case 'reviewing':
      return { step: 'deliberate', complete: false }
    case 'revealed':
      return { step: 'judgment', complete: false }
    case 'decided':
      return { step: 'judgment', complete: true }
    default:
      return { step: 'hear', complete: false }
  }
}
