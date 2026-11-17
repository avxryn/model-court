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
  problems: string[]
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
    problems,
  }
}
