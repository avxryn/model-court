/**
 * Starter field lists for the extraction kit (spec 04 §3.1). Each stays inside the portable
 * subset (unit-tested) and uses text, not integers, for identifiers.
 */

import type { ExtractionSchema } from './schema'

export interface ExtractionStarter {
  id: 'invoice' | 'contact' | 'contract-dates' | 'ticket-triage'
  name: string
  description: string
  schema: ExtractionSchema
}

export const EXTRACTION_STARTERS: readonly ExtractionStarter[] = [
  {
    id: 'invoice',
    name: 'Invoice',
    description: 'Supplier, invoice number, dates, currency, total and line items.',
    schema: {
      type: 'object',
      properties: {
        supplierName: { type: 'string', title: 'Supplier', description: 'The business that issued the invoice.' },
        invoiceNumber: { type: 'string', title: 'Invoice number', description: 'As printed, including letters and dashes.' },
        issueDate: { type: 'string', format: 'date', title: 'Issue date' },
        dueDate: { type: 'string', format: 'date', title: 'Due date', description: 'Leave empty if the invoice gives no due date.' },
        currency: { type: 'string', title: 'Currency', description: 'ISO 4217 code, for example USD or EUR.' },
        total: { type: 'number', title: 'Total', description: 'The amount due, including tax, without the currency symbol.' },
        purchaseOrder: { type: 'string', title: 'Purchase order', description: 'Leave empty if the invoice names none.' },
        lineItems: {
          type: 'array',
          title: 'Line items',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string', title: 'Description' },
              quantity: { type: 'number', title: 'Quantity' },
              amount: { type: 'number', title: 'Amount', description: 'The line total, without the currency symbol.' },
            },
            required: ['description', 'quantity', 'amount'],
          },
        },
      },
      required: ['supplierName', 'invoiceNumber', 'issueDate', 'currency', 'total', 'lineItems'],
    },
  },
  {
    id: 'contact',
    name: 'Contact details',
    description: 'A person or business: name, organization, email, phone and city.',
    schema: {
      type: 'object',
      properties: {
        fullName: { type: 'string', title: 'Name' },
        organization: { type: 'string', title: 'Organization', description: 'Leave empty if none is given.' },
        email: { type: 'string', format: 'email', title: 'Email', description: 'Leave empty if none is given.' },
        phone: { type: 'string', title: 'Phone', description: 'As written. Leave empty if none is given.' },
        city: { type: 'string', title: 'City', description: 'Leave empty if none is given.' },
      },
      required: ['fullName'],
    },
  },
  {
    id: 'contract-dates',
    name: 'Contract key dates',
    description: 'Parties, effective date, term end, notice period and auto-renewal.',
    schema: {
      type: 'object',
      properties: {
        parties: { type: 'array', title: 'Parties', items: { type: 'string' } },
        effectiveDate: { type: 'string', format: 'date', title: 'Effective date' },
        endDate: { type: 'string', format: 'date', title: 'End date', description: 'Leave empty if the contract runs until ended.' },
        noticePeriodDays: { type: 'integer', title: 'Notice period (days)', description: 'Leave empty if the contract states none.' },
        autoRenews: { type: 'boolean', title: 'Renews automatically' },
        governingLaw: { type: 'string', title: 'Governing law', description: 'The state or country named. Leave empty if none.' },
      },
      required: ['parties', 'effectiveDate', 'autoRenews'],
    },
  },
  {
    id: 'ticket-triage',
    name: 'Support ticket triage',
    description: 'Product area, urgency, customer-reported order number and a one-line summary.',
    schema: {
      type: 'object',
      properties: {
        productArea: { type: 'string', title: 'Product area', enum: ['Billing', 'Shipping', 'Account', 'Product defect', 'Other'] },
        urgency: { type: 'string', title: 'Urgency', enum: ['Low', 'Normal', 'High'] },
        orderNumber: { type: 'string', title: 'Order number', description: 'As the customer wrote it. Leave empty if none is given.' },
        refundRequested: { type: 'boolean', title: 'Asks for a refund' },
        summary: { type: 'string', title: 'Summary', description: 'One sentence in plain words.' },
      },
      required: ['productArea', 'urgency', 'refundRequested', 'summary'],
    },
  },
]

export function extractionStarter(id: ExtractionStarter['id']): ExtractionStarter {
  return EXTRACTION_STARTERS.find((starter) => starter.id === id)!
}
