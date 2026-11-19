/** Fixed P0 product limits (spec §5.3, §6.5). Operators may lower quotas via config, not these. */
export const LIMITS = {
  minCases: 1,
  maxCases: 5,
  /** F24: P1 allows a third configuration; operators may cap at 2 (MAX_CONFIGURATIONS_PER_RUN). */
  minConfigurationsPerRun: 2,
  maxConfigurationsPerRun: 3,
  /** D-65: repeats. A hearing may ask each generated party 1–3 times per question; operators may lower it (MAX_SAMPLES_PER_ANSWER). */
  maxSamplesPerAnswer: 3,
  /** Sample k is first dispatched (k − 1) × this after the hearing starts, to spread the burst over cron ticks. */
  sampleStaggerMs: 60_000,
  /** Spec 02 (D-69, Q2): hearings a case may hold, canceled ones included. Duplicate the case to keep going. */
  hearingsPerEvaluation: 20,
  /** Spec 02 (D-70): hearings in one comparison, so one read loads at most five records. */
  compareHearingsMax: 5,
  /** Spec 02 (D-71): a scenario file or certified record read for import (same as the CSV import and body caps). */
  scenarioFileBytes: 128 * 1024,
  caseTitle: { min: 1, max: 100 },
  caseInput: { min: 1, max: 4_000 },
  caseReference: { min: 0, max: 8_000 },
  caseExpectedBehavior: { min: 1, max: 2_000 },
  caseLanguage: { max: 35 },
  provenanceDescription: { min: 1, max: 500 },
  importedText: { min: 1, max: 16_000 },
  historyMessage: { min: 1, max: 4_000 },
  historyMessages: 10,
  historyChars: 8_000,
  configurationLabel: { min: 1, max: 60 },
  systemPrompt: { min: 1, max: 4_000 },
  evaluationTitle: { min: 1, max: 120 },
  taskDescription: { min: 0, max: 2_000 },
  maxOutputTokens: 512,
  /**
   * Extra output tokens sent to models whose reasoning cannot be turned off (D-48): their
   * reasoning counts against the provider's output cap, and with 512 alone the answer can be empty.
   */
  reasoningHeadroomTokens: 8_192,
  draftJsonBytes: 96 * 1024,
  /** CSV case import (browser-side parse). */
  caseImportCsvBytes: 128 * 1024,
  snapshotJsonBytes: 96 * 1024,
  requestBodyBytes: 128 * 1024,
  credentialRequestBytes: 16 * 1024,
  credentialKeyBytes: 8 * 1024,
  credentialLabel: { min: 1, max: 60 },
  providerOutputBytes: 16 * 1024,
  providerResponseBodyBytes: 256 * 1024,
  ratingNote: { min: 10, max: 1_000 },
  verdictRationale: { min: 20, max: 2_000 },
  verdictLimitations: { min: 0, max: 1_000 },
  maxAttemptsPerGeneration: 2,
  readsPerMinute: 120,
  invitedReviewersPerRun: 3,
  inviteTtlMs: 24 * 60 * 60 * 1000,
  ownEvaluationsPerUser: 10,
  providerTimeoutMs: 90_000,
  attemptLeaseMs: 120_000,
  receiptTtlMs: 24 * 60 * 60 * 1000,
  /** Task kits and automatic checks (spec 03 §10, D-75). */
  kits: {
    labels: { min: 2, max: 20 },
    label: { min: 1, max: 40 },
    alsoAccept: 5,
    requiredPoints: 6,
    requiredPointText: { min: 1, max: 160 },
    phrasesPerPoint: 4,
    phrase: { min: 1, max: 60 },
    mustNotMention: 8,
    summaryMaxWords: 300,
    summaryMaxCharacters: 2_000,
    minReasoningWords: 50,
    checksPerTestimony: 20,
    checkReasonChars: 300,
    checkDetailBytes: 1_024,
    checkResultsJsonBytes: 16 * 1_024,
  },
  /** Structured extraction (spec 04 §7.2, §10, D-85). */
  extraction: {
    schemaBytes: 16 * 1024,
    answerKeyBytes: 8 * 1024,
    compareBytes: 4 * 1024,
    compareRules: 60,
    textDocumentBytes: 64 * 1024,
    pdfBytes: 4 * 1024 * 1024,
    pdfPages: 20,
    maxOutputTokens: 2_048,
    leafFields: 60,
    nullableFields: 16,
    depth: 4,
    enumValues: 50,
    enumValuesTotal: 200,
    enumValueChars: 100,
    describeChars: 300,
    answerKeyArrayItems: 50,
    validatorErrors: 10,
    fieldFlags: 100,
    /** Input-token estimate per native PDF page until the pdf smoke check records a real number (spec 04 §10.3). */
    estimatedTokensPerPdfPage: 4_500,
    /** Allowance for the provider's own schema prompt (spec 04 §10.3). */
    estimatedSchemaPromptTokens: 300,
  },
} as const
