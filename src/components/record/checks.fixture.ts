/**
 * A revealed classification hearing's kit results, for render tests and the D-79 screenshots.
 * Fictitious; shaped like `GET /runs/:id/results` after spec 03.
 */

import type { CheckResult } from '@/domain/kits/types'
import type { ResultsView } from '@/lib/dto'

const LABELS = ['Billing', 'Bug', 'Account access', 'Feature request', 'Other']
const EXPECTED = ['Billing', 'Bug', 'Account access', 'Feature request', 'Other']
const SAID: Record<string, Array<string | null>> = {
  'cfg-a': ['Billing', 'Bug', 'Account access', 'Bug', 'Other'],
  'cfg-b': ['Billing', 'Billing', null, 'Feature request', 'Other'],
}

function results(expected: string, predicted: string | null, words: number): CheckResult[] {
  return [
    predicted
      ? { checkId: 'label-format', status: 'pass', reason: `Names ${predicted}.`, detail: { predicted } }
      : { checkId: 'label-format', status: 'fail', reason: "The first line, 'Probably an account thing', names no allowed label.", detail: { predicted: null } },
    !predicted
      ? { checkId: 'label-correct', status: 'fail', reason: `No allowed label, so it cannot match ${expected}.`, detail: { expected, predicted: null } }
      : predicted === expected
        ? { checkId: 'label-correct', status: 'pass', reason: `Said ${predicted}, the expected label.`, detail: { expected, predicted } }
        : { checkId: 'label-correct', status: 'fail', reason: `Said ${predicted}; the expected label is ${expected}.`, detail: { expected, predicted } },
    words >= 5 ? { checkId: 'reasoning-given', status: 'pass', reason: `${words} words of reasoning.`, detail: { words } } : { checkId: 'reasoning-given', status: 'fail', reason: `${words} words of reasoning; at least 5 expected.`, detail: { words } },
  ]
}

const counts = (pass: number, fail: number, na = 0, error = 0) => ({ pass, fail, na, error })

export const CHECKS_FIXTURE = {
  kit: { version: 'classification-v1', name: 'Classification', settings: { labels: LABELS, minReasoningWords: 5 } },
  eligibleCaseKeys: ['q1', 'q2', 'q3', 'q4', 'q5'],
  configurations: [
    { key: 'cfg-a', label: 'Terse prompt' },
    { key: 'cfg-b', label: 'Policy-first prompt' },
  ],
  checks: {
    kitVersion: 'classification-v1',
    definitions: [
      { id: 'label-format', label: 'Names one allowed label', description: 'The first line must name exactly one allowed label, as "Label: <label>" or the label alone (case, quotes, emphasis and a final period ignored).' },
      { id: 'label-correct', label: 'Matches the expected label', description: "Compares the label on the first line with the judge's answer key and any other accepted labels." },
      { id: 'reasoning-given', label: 'Gives reasoning', description: 'Counts the words after the label line. It measures that reasoning is there, not that it is sound: that is for the jury.' },
    ],
    byConfiguration: {
      'cfg-a': { 'label-format': counts(5, 0), 'label-correct': counts(4, 1), 'reasoning-given': counts(4, 0, 0, 1) },
      'cfg-b': { 'label-format': counts(4, 1), 'label-correct': counts(3, 2), 'reasoning-given': counts(5, 0) },
    },
    metrics: [
      { id: 'accuracy', label: 'Matched the expected label', byConfiguration: { 'cfg-a': { numerator: 4, denominator: 5 }, 'cfg-b': { numerator: 3, denominator: 5 } }, caveat: 'On 5 questions; one question moves this by 20 percentage points. A small sample, not a benchmark.' },
      { id: 'invalid-labels', label: 'Answers without an allowed label', byConfiguration: { 'cfg-a': { numerator: 0, denominator: 5 }, 'cfg-b': { numerator: 1, denominator: 5 } }, caveat: null },
    ],
    allPassed: { 'cfg-a': { numerator: 3, denominator: 5 }, 'cfg-b': { numerator: 3, denominator: 5 } },
    allPassedSamples: null,
  },
  cases: EXPECTED.map((expected, index) => ({
    key: `q${index + 1}`,
    title: ['Charged after cancelling', 'Export button', 'Reset link', 'Dark mode', 'Parcel'][index],
    eligible: true,
    kitFields: { kind: 'classification', expectedLabel: expected },
    responses: (['cfg-a', 'cfg-b'] as const).map((key) => {
      const set = results(expected, SAID[key][index], key === 'cfg-a' && index === 3 ? 3 : 12)
      // One check that could not run, to show the fourth status.
      if (key === 'cfg-a' && index === 3) set[2] = { checkId: 'reasoning-given', status: 'error', reason: 'This check could not run. That is a fault in Model Court, not in the answer.', detail: {} }
      return { configurationKey: key, status: 'succeeded', checks: set }
    }),
  })),
} as unknown as ResultsView
