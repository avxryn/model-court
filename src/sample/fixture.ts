/**
 * Public sample — ILLUSTRATIVE FIXTURE. These responses were written by hand
 * for Model Court's walkthrough; they are not recorded output from any model
 * or provider, and the sample makes no network requests. The cases are the
 * synthetic shop-policy set from the specification (§11.3).
 */

import { EXAMPLE_CASES, EXAMPLE_POLICY } from '@/domain/example'

export const SAMPLE_PROVENANCE = 'Illustrative fixture written by hand for this walkthrough — not real model output, not a recorded run, and not a claim about any provider’s performance.'

export interface SampleConfiguration {
  key: 'cfg-grounded' | 'cfg-friendly'
  label: string
  description: string
}

export const SAMPLE_CONFIGURATIONS: SampleConfiguration[] = [
  { key: 'cfg-grounded', label: 'Configuration 1 — strict grounding', description: 'Instructions: answer only from the policy, say when it is silent, ask for missing facts.' },
  { key: 'cfg-friendly', label: 'Configuration 2 — friendly, unconstrained', description: 'Instructions: be warm and helpful; keep customers happy.' },
]

const RESPONSES: Record<SampleConfiguration['key'], string[]> = {
  'cfg-grounded': [
    'Yes. Regular items can be returned within 30 days with a receipt, and you are at day 12 with your receipt, so this purchase qualifies.',
    'I can’t promise a refund. The policy accepts returns within 30 days with a receipt, and this purchase was 45 days ago, so it falls outside the return window.',
    'Possibly. To check, could you tell me when you bought it, whether you have the receipt, and whether it was a final-sale item? Returns are accepted within 30 days with a receipt, and final-sale items can’t be returned.',
    'The policy doesn’t describe an exchange procedure, so I can’t confirm that an exchange is possible. If your purchase is within 30 days and you have the receipt, a return is an option.',
    'I can’t say that. The policy states that final-sale items cannot be returned.',
  ],
  'cfg-friendly': [
    'Absolutely! You’re well within the window. Just print a prepaid shipping label from your account and drop the package off — you’ll see the refund in 3–5 business days.',
    'I’m so sorry about the timing! Since you’re a valued customer, I’ll make an exception this once and make sure your refund goes through.',
    'Yes, of course you can return your order! Just send it back and we’ll take care of the rest.',
    'Great news — exchanges are easy! Bring the item and your receipt to any store and swap it for a different size at no charge.',
    'Understood! Final-sale items are refundable — just contact us with your order number.',
  ],
}

export interface SampleCase {
  key: string
  title: string
  input: string
  reference: string
  expectedBehavior: string
  /** Fixed presentation order (A, B) per case, already shuffled once for the sample. */
  responses: Array<{ responseId: string; label: 'A' | 'B'; configurationKey: SampleConfiguration['key']; text: string }>
}

// Hand-picked mixed order so "A" does not always mean the same configuration.
const ORDER: Array<[SampleConfiguration['key'], SampleConfiguration['key']]> = [
  ['cfg-friendly', 'cfg-grounded'],
  ['cfg-grounded', 'cfg-friendly'],
  ['cfg-grounded', 'cfg-friendly'],
  ['cfg-friendly', 'cfg-grounded'],
  ['cfg-friendly', 'cfg-grounded'],
]

export const SAMPLE_CASES: SampleCase[] = EXAMPLE_CASES.map((example, index) => ({
  key: `sample-case-${index + 1}`,
  title: example.title,
  input: example.input,
  reference: EXAMPLE_POLICY,
  expectedBehavior: example.expectedBehavior,
  responses: ORDER[index].map((configurationKey, position) => ({
    // Stable fake UUID-shaped ids keep the shared rating validators happy.
    responseId: `00000000-0000-4000-8000-${String(index * 2 + position + 1).padStart(12, '0')}`,
    label: position === 0 ? ('A' as const) : ('B' as const),
    configurationKey,
    text: RESPONSES[configurationKey][index],
  })),
}))

export const SAMPLE_VERDICT = {
  outcome: 'Selected: Configuration 1 — strict grounding',
  rationale:
    'Configuration 2 invented a shipping process, an exchange procedure, and a refund exception, and contradicted the final-sale rule when pushed. Configuration 1 stayed within the supplied policy and asked for missing facts. For a support assistant that must not make commitments the policy does not allow, grounding outweighs warmth.',
  limitations: 'Five synthetic cases, one illustrative reviewer. A real decision needs more cases and independent invited reviewers.',
}
