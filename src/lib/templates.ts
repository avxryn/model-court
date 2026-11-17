/**
 * Starter cases ("Start from a template", D-25). Original, fictitious material
 * written for Model Court; not advice about real policies. Applied in the
 * browser by saving a draft over the server's seeded example, so no API
 * change is needed.
 */

import { DEFAULT_SYSTEM_PROMPT, EXAMPLE_CASES, EXAMPLE_POLICY } from '@/domain/example'
import { isImported, type DraftInput, type ModelConfiguration } from '@/domain/contracts'

export interface CaseTemplate {
  id: string
  name: string
  useCase: string
  title: string
  task: string
  /** Turns the server's seeded draft into this template's draft; null keeps the seed. */
  apply: ((seed: DraftInput, newId: () => string) => DraftInput) | null
}

const HR_HANDBOOK =
  'Full-time employees accrue 1.5 days of paid leave per month, up to 30 days. Leave requests need manager approval at least 10 working days in advance, except for illness. Unused leave above 10 days is forfeited on January 1. Part-time leave is pro-rated; the handbook does not give the formula.'

const HR_QUESTIONS = [
  { title: 'Accrual', input: 'I have worked here full-time for 8 months. How much paid leave have I earned?', expectedBehavior: 'Gives 12 days (1.5 × 8) without inventing other caps or rules.' },
  { title: 'Short notice', input: 'Can I take next Monday off? I am asking on Thursday.', expectedBehavior: 'Explains the 10-working-day notice rule and the illness exception; does not promise approval.' },
  { title: 'Carry-over', input: 'I have 14 days left in December. What happens on January 1?', expectedBehavior: 'Says the 4 days above the 10-day limit are forfeited.' },
  { title: 'Policy is silent', input: 'I work part-time, three days a week. Exactly how many days do I get?', expectedBehavior: 'Says leave is pro-rated but the handbook gives no formula; suggests asking HR. Does not make up a number.' },
]

export const CASE_TEMPLATES: CaseTemplate[] = [
  {
    id: 'returns',
    name: 'Choose a model for a support bot',
    useCase: 'Model selection before launch: two models, same instructions, five return-policy questions.',
    title: 'Support policy answers',
    task: 'Which model answers return-policy questions accurately from the supplied policy?',
    apply: null,
  },
  {
    id: 'prompt-regression',
    name: 'Check a prompt change',
    useCase: 'Prompt regression: the same model with the current and a revised system prompt.',
    title: 'Support prompt regression',
    task: 'Does the revised support prompt stay grounded while sounding friendlier?',
    apply: (seed, newId) => {
      // The server seeds two model parties; templates only rewrite those.
      const [first, second] = seed.configurations.filter((c): c is ModelConfiguration => !isImported(c))
      const modelKey = first.modelKey
      return {
        comparisonMode: 'configuration',
        cases: EXAMPLE_CASES.map((c) => ({ key: newId(), title: c.title, input: c.input, reference: EXAMPLE_POLICY, expectedBehavior: c.expectedBehavior })),
        configurations: [
          { ...first, key: newId(), label: 'Current prompt', modelKey, systemPrompt: DEFAULT_SYSTEM_PROMPT },
          { ...second, key: newId(), label: 'Revised prompt', modelKey, systemPrompt: `${DEFAULT_SYSTEM_PROMPT} Use a warm, friendly tone and thank the customer for asking.` },
        ],
      }
    },
  },
  {
    id: 'hr-policy',
    name: 'Test a policy assistant',
    useCase: 'Knowledge-base assistant: leave questions answered from an employee handbook.',
    title: 'HR leave policy assistant',
    task: 'Which model answers leave questions accurately from the handbook, and says so when the handbook is silent?',
    apply: (seed, newId) => ({
      comparisonMode: 'model',
      cases: HR_QUESTIONS.map((q) => ({ key: newId(), title: q.title, input: q.input, reference: HR_HANDBOOK, expectedBehavior: q.expectedBehavior })),
      configurations: seed.configurations.map((c) => isImported(c) ? c : ({
        ...c,
        systemPrompt:
          'You are an HR assistant. Answer only from the supplied handbook. If the handbook does not cover the question, say so plainly and suggest contacting HR. Do not invent rules or numbers. Keep the answer under 120 words.',
      })),
    }),
  },
]
