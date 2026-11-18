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

// Spec 03 (D-79): fictitious material for the two kit starters.
const SUMMARY_THREADS = [
  {
    title: 'Broken lamp',
    document:
      'Customer (Nov 3): My desk lamp arrived with a cracked base. Order 58213. I want a replacement, not a refund.\nAgent (Nov 3): Sorry about that. Please send a photo of the damage and the box label.\nCustomer (Nov 4): Photos attached.\nAgent (Nov 5): Thanks. A replacement ships within 5 business days. Keep the broken lamp until the courier collects it.',
    points: [
      { text: 'The customer wants a replacement, not a refund', anyOf: ['replacement'] },
      { text: 'The replacement ships within 5 business days', anyOf: ['5 business days', 'five business days'] },
    ],
    avoid: ['refund issued'],
  },
  {
    title: 'Double charge',
    document:
      'Customer (Nov 10): I was charged twice for my November plan, 2 × 19.00 EUR.\nAgent (Nov 10): I can see both charges. The second one is a duplicate. I have started a refund of 19.00 EUR.\nAgent (Nov 10): Refunds reach the card in 3 to 7 days. No action needed from you.',
    points: [
      { text: 'One of the two charges was a duplicate', anyOf: ['duplicate', 'charged twice'] },
      { text: 'The refund takes 3 to 7 days', anyOf: ['3 to 7 days', '3-7 days'] },
    ],
    avoid: [],
  },
  {
    title: 'Locked account',
    document:
      'Customer (Nov 12): I am locked out after too many password attempts. My name is Priya Raman.\nAgent (Nov 12): The lock lifts by itself after 30 minutes. If it does not, reply here and we will reset it manually.\nCustomer (Nov 12): Still locked after an hour.\nAgent (Nov 12): Escalated to the account team for a manual reset today.',
    points: [
      { text: 'The automatic unlock did not work', anyOf: ['still locked', 'did not unlock', 'still cannot'] },
      { text: 'It was escalated for a manual reset', anyOf: ['manual reset', 'escalated'] },
    ],
    avoid: ['Priya Raman'],
  },
]

const ROUTING_LABELS = ['Billing', 'Bug', 'Account access', 'Feature request', 'Other'] as const

const ROUTING_POLICY =
  'Billing: charges, refunds, invoices and plans. Bug: something in the app does not work as documented. Account access: sign-in, passwords, locked or deleted accounts. Feature request: asks for something the app does not do yet. Other: anything else, including shipping questions.'

const ROUTING_TICKETS: Array<{ title: string; text: string; label: (typeof ROUTING_LABELS)[number] }> = [
  { title: 'Charged after cancelling', text: 'I cancelled my plan last week but was charged again today. Please fix this.', label: 'Billing' },
  { title: 'Export button', text: 'When I press Export on the reports page, nothing happens. It worked yesterday.', label: 'Bug' },
  { title: 'Reset link', text: 'The password reset email never arrives, so I cannot sign in.', label: 'Account access' },
  { title: 'Dark mode', text: 'Could you add a dark mode to the mobile app? My eyes hurt at night.', label: 'Feature request' },
  { title: 'Parcel', text: 'Where is my parcel? The tracking page has not changed for four days.', label: 'Other' },
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
  {
    id: 'summaries',
    name: 'Compare summaries',
    useCase: 'Summarization kit (D-79): three support threads, a 100-word limit, and free checks for length, required points and invented numbers.',
    title: 'Support thread summaries',
    task: 'Which setup writes the most faithful, useful hand-over summary of a support thread?',
    apply: (seed, newId) => ({
      comparisonMode: 'model',
      rubricVersion: 'summary-v1',
      kit: { version: 'summarization-v1', settings: { lengthUnit: 'words', maxLength: 100, format: 'any', checkNumbers: true } },
      cases: SUMMARY_THREADS.map((thread) => ({
        key: newId(),
        title: thread.title,
        input: 'Summarize this thread for a support agent taking over the ticket.',
        reference: thread.document,
        expectedBehavior: 'A good summary is faithful to the document, covers the points listed below, and suits the reader named in the request.',
        kitFields: { kind: 'summarization' as const, requiredPoints: thread.points, mustNotMention: thread.avoid },
      })),
      configurations: seed.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt: 'You summarize customer-support threads for the agent who takes over. Be faithful to the thread and brief. Do not add facts that are not in it.' })),
    }),
  },
  {
    id: 'ticket-routing',
    name: 'Route support tickets',
    useCase: 'Classification kit (D-79): five tickets, five queues, an answer key, and an accuracy number next to the jury’s findings.',
    title: 'Support ticket routing',
    task: 'Which setup routes support tickets to the right queue, with reasoning a lead can trust?',
    apply: (seed, newId) => ({
      comparisonMode: 'model',
      rubricVersion: 'classification-v1',
      kit: { version: 'classification-v1', settings: { labels: [...ROUTING_LABELS], minReasoningWords: 5 } },
      cases: ROUTING_TICKETS.map((ticket) => ({
        key: newId(),
        title: ticket.title,
        input: ticket.text,
        reference: ROUTING_POLICY,
        expectedBehavior: "Judge whether the reasoning supports the label and rests on what the item actually says. The expected label, if given, is the judge's answer key.",
        kitFields: { kind: 'classification' as const, expectedLabel: ticket.label },
      })),
      configurations: seed.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt: 'You route incoming support tickets to one queue. Follow the routing policy in the context. Keep the reasoning to two or three sentences.' })),
    }),
  },
]
