/**
 * AES-256-GCM protection for user provider keys (spec §9.6) using only the
 * Worker's standard Web Crypto. No business rules, no logging, no caching of
 * plaintext. Encryption at rest does not hide keys from trusted operators who
 * hold both the database and the root secret.
 */

import { canonicalJson, toHex } from '../domain/canonical'

export const CREDENTIAL_SCHEMA_VERSION = 1

export interface CredentialBinding {
  appId: string
  credentialId: string
  ownerUserId: string
  provider: string
  keyVersion: string
}

export interface SealedCredential {
  ciphertext: string
  nonce: string
}

export class CredentialCryptoError extends Error {
  constructor() {
    super('Credential could not be decrypted.')
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

/** Canonical associated data binds ciphertext to its owner, provider, and root version. */
function additionalData(binding: CredentialBinding): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    canonicalJson({
      app: binding.appId,
      credentialId: binding.credentialId,
      keyVersion: binding.keyVersion,
      owner: binding.ownerUserId,
      provider: binding.provider,
      schema: CREDENTIAL_SCHEMA_VERSION,
    }),
  )
}

function importAesKey(rawKey: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function sealCredential(rawKey: Uint8Array<ArrayBuffer>, binding: CredentialBinding, plaintext: string): Promise<SealedCredential> {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const key = await importAesKey(rawKey)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(binding), tagLength: 128 },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), nonce: toBase64(nonce) }
}

export async function openCredential(rawKey: Uint8Array<ArrayBuffer>, binding: CredentialBinding, sealed: SealedCredential): Promise<string> {
  try {
    const key = await importAesKey(rawKey)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.nonce), additionalData: additionalData(binding), tagLength: 128 },
      key,
      fromBase64(sealed.ciphertext),
    )
    return new TextDecoder().decode(plaintext)
  } catch {
    // Never surface the underlying error: it can carry input fragments.
    throw new CredentialCryptoError()
  }
}

export async function hmacHex(rawKey: Uint8Array<ArrayBuffer>, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}
