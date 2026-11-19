/** Fixed P0 product limits (spec §5.3, §6.5). Operators may lower quotas via config, not these. */
export const LIMITS = {
  minCases: 1,
  maxCases: 5,
  /** F24: P1 allows a third configuration; operators may cap at 2 (MAX_CONFIGURATIONS_PER_RUN). */
  minConfigurationsPerRun: 2,
  /** Spec 07 §9.1 (D-110): up to five parties, within `maxTestimoniesPerHearing`. */
  maxConfigurationsPerRun: 5,
  /** Spec 07 Q5 (D-106): the deployment cap when MAX_CONFIGURATIONS_PER_RUN is unset; the live app stays at 3 until Avery raises it. */
  defaultConfigurationsPerRun: 3,
  /**
   * Spec 07 §9.1: parties × questions per hearing, imported parties included, so each juror scores at
   * most today's 15 testimonies (2–3 parties × 5 questions, or 4–5 parties × 3 questions).
   */
  maxTestimoniesPerHearing: 15,
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
  /** Answers from supplied sources (spec 05 §10, D-92). */
  grounded: {
    sourcesPerQuestion: { min: 1, max: 10 },
    sourceText: { min: 1, max: 6_000 },
    sourceTitle: { min: 1, max: 120 },
    sourceOrigin: { min: 1, max: 300 },
    /** Sum of source text per question, in code points. */
    questionChars: 24_000,
    /** Sum of source text over every question of a case, in code points. */
    caseChars: 60_000,
    /** UTF-8 of one question's sources as JSON, so its PUT fits the 128 KiB body cap. */
    questionBytes: 100 * 1024,
    importCsvBytes: 256 * 1024,
    maxCitationsParsed: 200,
    citationQuote: { min: 1, max: 1_000 },
    /** Juror reading-time hint (spec 05 §10). */
    readingWordsPerMinute: 250,
  },
  /** Tool calling with mock tools (spec 06 §9, D-99). */
  tools: {
    perQuestion: 8,
    name: 64,
    description: { min: 1, max: 1_000 },
    parametersBytes: 4 * 1024,
    parametersDepth: 4,
    parametersProperties: 24,
    enumValues: 50,
    responsesPerTool: 10,
    output: { min: 1, max: 4_000 },
    whenBytes: 1024,
    taskBytes: 12 * 1024,
    maxSteps: 6,
    defaultMaxSteps: 4,
    callsPerStep: 8,
    callsPerTrace: 24,
    requiredCalls: 8,
    forbiddenTools: 8,
    expectedAnswer: { min: 1, max: 500 },
    /** Arguments stored per call; larger ones are invalid and keep a preview. */
    argumentsBytes: 4 * 1024,
    argumentsPreviewBytes: 1024,
    /** Provider-native replay data kept per step until the attempt finishes. */
    replayBytes: 64 * 1024,
    traceBytes: 64 * 1024,
    /** A step's request body, checked before it is sent. */
    requestBodyBytes: 512 * 1024,
    /** Validator issues reported per value. */
    issues: 5,
  },
} as const
