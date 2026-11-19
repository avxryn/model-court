/**
 * Starter cases ("Start from a template", D-25). Original, fictitious material
 * written for Model Court; not advice about real policies. Applied in the
 * browser by saving a draft over the server's seeded example, so no API
 * change is needed.
 */

import { extractionStarter } from '@/domain/extraction/starters'
import { EXTRACTION_DEFAULT_INPUT, EXTRACTION_V1 } from '@/domain/kits/extraction'
import { GROUNDED_V1 } from '@/domain/kits/grounded'
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
  /** Spec 04: text documents to upload after the draft is saved, by question position. */
  documents?: readonly string[]
  /** Spec 05 (D-95): numbered sources to save after the draft, by question position. */
  sources?: ReadonlyArray<ReadonlyArray<{ title?: string; text: string; origin?: string }>>
}

/** Fictitious help-center passages for the answers-from-sources template (spec 05), as a retriever might return them. */
const HELP_CENTER = [
  {
    title: 'Where is my order?',
    input: 'My order shipped four days ago and has not arrived. When will it get here, and can I get express shipping next time?',
    answerable: 'yes' as const,
    requiredSources: [1, 2],
    sources: [
      { title: 'Shipping times', text: 'Standard orders ship within 2 business days and arrive 3–7 business days after they ship. Tracking links are emailed when an order leaves the warehouse.', origin: 'help-center/shipping-times, retrieved Nov 12' },
      { title: 'Express shipping', text: 'Express shipping arrives 1–2 business days after an order ships. It is available for addresses in the contiguous United States only and is chosen at checkout.', origin: 'help-center/express, retrieved Nov 12' },
      { title: 'Gift wrapping', text: 'Gift wrapping can be added to any order for a flat fee. A gift note of up to 200 characters is printed on the packing slip.', origin: 'help-center/gifts, retrieved Nov 12' },
    ],
  },
  {
    title: 'Refund to a closed card',
    input: 'I returned a jacket last week, but the card I paid with is closed. How will I get my money back, and how long does it take?',
    answerable: 'partly' as const,
    requiredSources: [1],
    sources: [
      { title: 'Refunds', text: 'Refunds are issued to the original payment method within 5 business days after the return is received. The bank may take a few more days to show it.', origin: 'help-center/refunds, retrieved Nov 12' },
      { title: 'Return window', text: 'Most items can be returned within 30 days of delivery in their original condition. Final-sale items cannot be returned.', origin: 'help-center/returns, retrieved Nov 12' },
    ],
  },
  {
    title: 'Paying with a gift card',
    input: 'Can I pay for part of my order with a gift card and the rest with a credit card?',
    answerable: 'no' as const,
    requiredSources: [],
    sources: [
      { title: 'Payment methods', text: 'We accept Visa, Mastercard, American Express and PayPal. Payment is taken when the order ships.', origin: 'help-center/payments, retrieved Nov 12' },
      { title: 'Order changes', text: 'An order can be changed or canceled until it ships. After that, use a return instead.', origin: 'help-center/order-changes, retrieved Nov 12' },
    ],
  },
]

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

/** Fictitious intake emails for the extraction template (spec 04); null marks what an email doesn't say. */
const INTAKE_EMAILS = [
  {
    title: 'Studio enquiry',
    text: 'Hi, this is Dana Whitfield from Fabrikam Studio in Portland. We need a quote for 40 chairs.\nBest,\nDana\ndana.whitfield@fabrikam.example | (503) 555-0142',
    key: { fullName: 'Dana Whitfield', organization: 'Fabrikam Studio', email: 'dana.whitfield@fabrikam.example', phone: '503 555 0142', city: 'Portland' },
  },
  {
    title: 'Callback request',
    text: 'Please call me back about my order, I could not log in. Thanks, Arjun Mehta. Mobile 0161 496 0838.',
    key: { fullName: 'Arjun Mehta', organization: null, email: null, phone: '0161 496 0838', city: null },
  },
  {
    title: 'Forwarded signature',
    text: 'From: Lee Okafor <l.okafor@northwind.example>\nSubject: Invoices\n\nCan you resend March? We moved offices, so use the new address on file.\n\nLee Okafor | Accounts payable, Northwind Traders',
    key: { fullName: 'Lee Okafor', organization: 'Northwind Traders', email: 'l.okafor@northwind.example', phone: null, city: null },
  },
] as const

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
    id: 'extraction',
    name: 'Pull fields from documents',
    useCase: 'Extraction kit (spec 04): three intake emails, a contact field list and answer keys; jurors mark invented values.',
    title: 'Contact details from intake emails',
    task: 'Which setup pulls contact details out of intake emails correctly, and leaves a field empty instead of guessing?',
    apply: (seed, newId) => ({
      comparisonMode: 'model',
      rubricVersion: 'extraction-v1',
      kit: { version: 'extraction-v1', settings: { schema: extractionStarter('contact').schema, compare: { '/phone': 'alnum' } } },
      cases: INTAKE_EMAILS.map((email) => ({
        key: newId(),
        title: email.title,
        input: EXTRACTION_DEFAULT_INPUT,
        reference: '',
        expectedBehavior: EXTRACTION_V1.defaultJuryInstructions ?? '',
        kitFields: { kind: 'extraction' as const, answerKey: email.key },
      })),
      configurations: seed.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt: 'You extract contact details from emails for a CRM. Copy values as written. Leave a field empty when the email does not give it.' })),
    }),
    documents: INTAKE_EMAILS.map((email) => email.text),
  },
  {
    id: 'sources',
    name: 'Answers from sources',
    useCase: 'Answers-from-sources kit (spec 05): three help-center questions with the passages a retriever returned, one the sources answer only in part and one they cannot answer; citations and quotes checked for free.',
    title: 'Help-center answers from retrieved passages',
    task: 'Which setup answers only from the retrieved passages, cites them, and says so when they do not contain the answer?',
    apply: (seed, newId) => ({
      comparisonMode: 'model',
      rubricVersion: 'grounded-v1',
      kit: { version: 'grounded-v1', settings: {} },
      cases: HELP_CENTER.map((question) => ({
        key: newId(),
        title: question.title,
        input: question.input,
        reference: '',
        expectedBehavior: GROUNDED_V1.defaultJuryInstructions ?? '',
        kitFields: { kind: 'grounded' as const, answerable: question.answerable, requiredSources: question.requiredSources },
      })),
      configurations: seed.configurations.map((c) => (isImported(c) ? c : { ...c, systemPrompt: 'You answer customer questions for an online store. Be brief and friendly.' })),
    }),
    sources: HELP_CENTER.map((question) => question.sources),
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
