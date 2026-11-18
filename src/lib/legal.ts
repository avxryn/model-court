/**
 * Who runs this deployment, for the privacy, terms and accessibility pages.
 * Fill these in before publishing; while DRAFT is true every legal page says
 * it is a draft awaiting legal review.
 */

export const LEGAL = {
  /** The person or company that operates this deployment. */
  operator: '[Operator name]',
  /** Where privacy, deletion, accessibility and legal requests go. */
  contact: '[contact email]',
  /** Whose law governs the terms, e.g. "the State of Texas, USA". */
  jurisdiction: '[jurisdiction]',
  effective: 'November 18, 2026',
  /** True until the text has had a legal review and the placeholders above are filled. */
  draft: true,
} as const
