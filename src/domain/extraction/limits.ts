/** The extraction limits the catalog publishes (spec 04 §5, `GET /catalog` `limits.extraction`). */

import { LIMITS } from '../limits'

export interface ExtractionLimits {
  schemaBytes: number
  answerKeyBytes: number
  textDocumentBytes: number
  pdfBytes: number
  pdfPages: number
  maxOutputTokens: number
  nullableFields: number
  leafFields: number
  depth: number
}

export function extractionLimits(): ExtractionLimits {
  const X = LIMITS.extraction
  return {
    schemaBytes: X.schemaBytes,
    answerKeyBytes: X.answerKeyBytes,
    textDocumentBytes: X.textDocumentBytes,
    pdfBytes: X.pdfBytes,
    pdfPages: X.pdfPages,
    maxOutputTokens: X.maxOutputTokens,
    nullableFields: X.nullableFields,
    leafFields: X.leafFields,
    depth: X.depth,
  }
}
