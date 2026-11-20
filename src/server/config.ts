/**
 * Server configuration (spec §14.1). Parsed once per request from Worker
 * bindings; invalid or missing values disable the dependent capability
 * (fail closed) instead of falling back to defaults that spend money.
 */

import { LIMITS } from '../domain/limits'

export interface ConfigEnv {
  GENERATION_ENABLED?: string
  CREDENTIAL_WRITES_ENABLED?: string
  CREDENTIAL_ACTIVE_KEY_VERSION?: string
  CREDENTIAL_ENCRYPTION_KEY_V1?: string
  CREDENTIAL_ENCRYPTION_KEY_V2?: string
  CREDENTIAL_REQUEST_HMAC_KEY?: string
  MAX_DAILY_CALLS_PER_USER?: string
  MAX_DAILY_CALLS_GLOBAL?: string
  MAX_LIFETIME_CALLS_GLOBAL?: string
  PUBLIC_APP_ORIGIN?: string
  PROVIDER_TIMEOUT_MS?: string
  CREDENTIAL_TTL_DAYS?: string
  MAX_CONFIGURATIONS_PER_RUN?: string
  /** D-65: the most samples per answer a hearing may ask for, 1–3 (1 turns repeats off). Default 3. */
  MAX_SAMPLES_PER_ANSWER?: string
  /** Spec 04 §4.2: document bytes one user may store (default 32 MiB) and the deployment in total (default 256 MiB). */
  MAX_DOCUMENT_BYTES_PER_USER?: string
  MAX_DOCUMENT_BYTES_GLOBAL?: string
  /** Operator-only: re-encrypt every active key to this root version on each cron tick. */
  CREDENTIAL_REKEY_TARGET_VERSION?: string
  /** Operator-only: during re-keying, revoke keys that fail authentication under their recorded root. */
  CREDENTIAL_REKEY_REVOKE_UNREADABLE?: string
  /** Operator-only, after a store restore: revoke every active key created before this epoch-ms instant. */
  CREDENTIAL_REVOKE_CREATED_BEFORE?: string
  /** V9 (D-117): the operator's P-256 public key (base64 SPKI). Set = daily sealed backups on. Public, not a secret. */
  BACKUP_PUBLIC_KEY?: string
  /** V9: how many backups to keep in the owner's private folder (1–60, default 14). */
  BACKUP_KEEP?: string
  /** V9: operator-only; take one backup now unless one exists at or after this epoch-ms instant. */
  BACKUP_REQUESTED_AT?: string
  APP_COMMIT?: string
  DEEPSPACE_APP_ID: string
}

export interface AppConfig {
  appId: string
  appCommit: string
  publicOrigin: string | null
  generationEnabled: boolean
  credentialWritesEnabled: boolean
  /** Raw 32-byte AES keys by version (e.g. "v1"); only well-formed roots are present. */
  encryptionKeys: Map<string, Uint8Array<ArrayBuffer>>
  activeKeyVersion: string | null
  hmacKey: Uint8Array<ArrayBuffer> | null
  limits: { dailyPerUser: number; dailyGlobal: number; lifetimeGlobal: number }
  providerTimeoutMs: number
  /** F24: 2 or 3 configurations per run; operators may hold a deployment at 2. */
  maxConfigurationsPerRun: number
  /** D-65: 1–3; 1 turns repeats off for this deployment. */
  maxSamplesPerAnswer: number
  /** Spec 04 §4.2 (D-87): byte quotas for extraction documents. */
  documentStorage: { perUserBytes: number; globalBytes: number }
  /** Saved provider keys expire this long after saving or renewal (D-23). */
  credentialTtlMs: number
  /** Operator credential maintenance run by the cron (docs/runbook.md). Null/false = off. */
  credentialOps: {
    rekeyTargetVersion: string | null
    rekeyRevokeUnreadable: boolean
    revokeCreatedBefore: number | null
  }
  /**
   * V9 (D-117): sealed backups to the owner's private files. `publicKey` null = off. Problems here are
   * logged by the backup task and never make the app unready.
   */
  backup: { publicKey: string | null; keep: number; requestedAt: number | null; problems: string[] }
  problems: string[]
}

/** A P-256 SPKI is 91 bytes and starts with this DER prefix (id-ecPublicKey, prime256v1). Full check at seal time. */
const P256_SPKI_PREFIX = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]

function backupConfig(env: ConfigEnv): AppConfig['backup'] {
  const problems: string[] = []
  let publicKey: string | null = null
  const raw = env.BACKUP_PUBLIC_KEY?.trim()
  if (raw) {
    const bytes = decodeBase64Key(raw, 91)
    if (bytes && P256_SPKI_PREFIX.every((byte, index) => bytes[index] === byte)) publicKey = raw
    else problems.push('BACKUP_PUBLIC_KEY is not a base64 P-256 public key; backups are off.')
  }
  let keep = 14
  const keepRaw = env.BACKUP_KEEP?.trim()
  if (keepRaw) {
    const parsed = Number(keepRaw)
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 60) keep = parsed
    else problems.push('BACKUP_KEEP is not an integer from 1 to 60; keeping 14.')
  }
  let requestedAt: number | null = null
  const requested = env.BACKUP_REQUESTED_AT?.trim()
  if (requested) {
    const parsed = Number(requested)
    if (Number.isSafeInteger(parsed) && parsed > 0) requestedAt = parsed
    else problems.push('BACKUP_REQUESTED_AT is not a positive epoch-millisecond integer; ignored.')
  }
  return { publicKey, keep, requestedAt, problems }
}

function decodeBase64Key(value: string | undefined, bytes: number): Uint8Array<ArrayBuffer> | null {
  if (!value) return null
  try {
    const binary = atob(value.trim())
    if (binary.length !== bytes) return null
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return null
  }
}

function positiveInt(value: string | undefined, fallback: number, problems: string[], name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    problems.push(`${name} is not a non-negative integer; using 0 (generation blocked).`)
    return 0
  }
  return parsed
}

function configurationCap(value: string | undefined, problems: string[]): number {
  if (value === undefined || value.trim() === '') return LIMITS.defaultConfigurationsPerRun
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= LIMITS.minConfigurationsPerRun && parsed <= LIMITS.maxConfigurationsPerRun) return parsed
  problems.push(`MAX_CONFIGURATIONS_PER_RUN must be ${LIMITS.minConfigurationsPerRun}–${LIMITS.maxConfigurationsPerRun}; using ${LIMITS.minConfigurationsPerRun}.`)
  return LIMITS.minConfigurationsPerRun
}

function samplesCap(value: string | undefined, problems: string[]): number {
  if (value === undefined || value.trim() === '') return LIMITS.maxSamplesPerAnswer
  const parsed = Number(value)
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= LIMITS.maxSamplesPerAnswer) return parsed
  problems.push(`MAX_SAMPLES_PER_ANSWER must be 1–${LIMITS.maxSamplesPerAnswer}; using 1 (repeats off).`)
  return 1
}

export function parseConfig(env: ConfigEnv): AppConfig {
  const problems: string[] = []
  const encryptionKeys = new Map<string, Uint8Array<ArrayBuffer>>()
  for (const [version, raw] of [['v1', env.CREDENTIAL_ENCRYPTION_KEY_V1], ['v2', env.CREDENTIAL_ENCRYPTION_KEY_V2]] as const) {
    if (raw === undefined) continue
    const key = decodeBase64Key(raw, 32)
    if (key) encryptionKeys.set(version, key)
    else problems.push(`CREDENTIAL_ENCRYPTION_KEY_${version.toUpperCase()} is not base64 of 32 bytes.`)
  }

  const requestedVersion = env.CREDENTIAL_ACTIVE_KEY_VERSION?.trim() || 'v1'
  const activeKeyVersion = encryptionKeys.has(requestedVersion) ? requestedVersion : null
  if (!activeKeyVersion) problems.push(`Active credential encryption root ${requestedVersion} is not configured.`)

  const hmacKey = decodeBase64Key(env.CREDENTIAL_REQUEST_HMAC_KEY, 32)
  if (!hmacKey) problems.push('CREDENTIAL_REQUEST_HMAC_KEY is missing or not base64 of 32 bytes.')

  let publicOrigin: string | null = null
  if (env.PUBLIC_APP_ORIGIN) {
    try {
      const url = new URL(env.PUBLIC_APP_ORIGIN)
      if (url.protocol === 'https:' || url.hostname === '127.0.0.1' || url.hostname === 'localhost') publicOrigin = url.origin
      else problems.push('PUBLIC_APP_ORIGIN must be an https origin.')
    } catch {
      problems.push('PUBLIC_APP_ORIGIN is not a valid URL.')
    }
  }

  // Operator credential maintenance. A malformed value disables the operation (fail closed).
  let rekeyTargetVersion: string | null = null
  const rekeyTarget = env.CREDENTIAL_REKEY_TARGET_VERSION?.trim()
  if (rekeyTarget) {
    if (encryptionKeys.has(rekeyTarget)) rekeyTargetVersion = rekeyTarget
    else problems.push(`Re-key target root ${rekeyTarget} is not configured; re-keying is paused.`)
  }
  let revokeCreatedBefore: number | null = null
  const cutoff = env.CREDENTIAL_REVOKE_CREATED_BEFORE?.trim()
  if (cutoff) {
    const parsed = Number(cutoff)
    if (Number.isSafeInteger(parsed) && parsed > 0) revokeCreatedBefore = parsed
    else problems.push('CREDENTIAL_REVOKE_CREATED_BEFORE is not a positive epoch-millisecond integer; ignored.')
  }

  const credentialsReady = activeKeyVersion !== null && hmacKey !== null
  const generationFlag = env.GENERATION_ENABLED === 'true'
  if (generationFlag && !credentialsReady) problems.push('Generation is enabled but credential encryption is not ready.')

  return {
    appId: env.DEEPSPACE_APP_ID,
    appCommit: env.APP_COMMIT?.trim() || 'unknown',
    publicOrigin,
    generationEnabled: generationFlag && credentialsReady,
    credentialWritesEnabled: env.CREDENTIAL_WRITES_ENABLED !== 'false' && credentialsReady,
    encryptionKeys,
    activeKeyVersion,
    hmacKey,
    limits: {
      dailyPerUser: positiveInt(env.MAX_DAILY_CALLS_PER_USER, 20, problems, 'MAX_DAILY_CALLS_PER_USER'),
      dailyGlobal: positiveInt(env.MAX_DAILY_CALLS_GLOBAL, 100, problems, 'MAX_DAILY_CALLS_GLOBAL'),
      lifetimeGlobal: positiveInt(env.MAX_LIFETIME_CALLS_GLOBAL, 500, problems, 'MAX_LIFETIME_CALLS_GLOBAL'),
    },
    // Operators may shorten, never lengthen, the 90s provider deadline.
    providerTimeoutMs: Math.min(positiveInt(env.PROVIDER_TIMEOUT_MS, LIMITS.providerTimeoutMs, problems, 'PROVIDER_TIMEOUT_MS') || LIMITS.providerTimeoutMs, LIMITS.providerTimeoutMs),
    maxConfigurationsPerRun: configurationCap(env.MAX_CONFIGURATIONS_PER_RUN, problems),
    maxSamplesPerAnswer: samplesCap(env.MAX_SAMPLES_PER_ANSWER, problems),
    documentStorage: {
      perUserBytes: positiveInt(env.MAX_DOCUMENT_BYTES_PER_USER, 32 * 1024 * 1024, problems, 'MAX_DOCUMENT_BYTES_PER_USER'),
      globalBytes: positiveInt(env.MAX_DOCUMENT_BYTES_GLOBAL, 256 * 1024 * 1024, problems, 'MAX_DOCUMENT_BYTES_GLOBAL'),
    },
    credentialOps: {
      rekeyTargetVersion,
      rekeyRevokeUnreadable: rekeyTargetVersion !== null && env.CREDENTIAL_REKEY_REVOKE_UNREADABLE === 'true',
      revokeCreatedBefore,
    },
    backup: backupConfig(env),
    credentialTtlMs: Math.min(Math.max(positiveInt(env.CREDENTIAL_TTL_DAYS, 7, problems, 'CREDENTIAL_TTL_DAYS') || 7, 1), 90) * 24 * 60 * 60 * 1000,
    problems,
  }
}
