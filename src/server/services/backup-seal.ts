/**
 * Operator-sealed backups (V9, D-117). A backup is sealed to the operator's P-256 public key: the
 * Worker holds only that public key, so it can write new backups but can never read an old one, and
 * there is no backup secret to upload. Only whoever holds the private key (Avery, offline) can open a
 * file. Scheme: an ephemeral P-256 key per file, ECDH with the recipient key, HKDF-SHA-256 to a fresh
 * AES-256-GCM key, the header authenticated as additional data.
 *
 * Pure Web Crypto, no Worker bindings: `scripts/backup.ts` uses the same functions in Node.
 */

import { canonicalJson, sha256Hex } from '../../domain/canonical'
import type { StoreSnapshot } from './backup'

export const SEALED_BACKUP_FORMAT = 'model-court-store-backup'
export const SEALED_BACKUP_VERSION = 2
export const SEALED_BACKUP_ALG = 'ECDH-P256+HKDF-SHA256+AES-256-GCM'

export interface OperatorSealedBackup {
  format: typeof SEALED_BACKUP_FORMAT
  version: typeof SEALED_BACKUP_VERSION
  alg: typeof SEALED_BACKUP_ALG
  appId: string
  exportedAt: number
  /** First 16 hex characters of sha256(recipient SPKI): which operator key opens this file. */
  recipient: string
  /** The ephemeral public key, raw uncompressed point, base64. */
  ephemeralKey: string
  nonce: string
  ciphertext: string
}

export class SealError extends Error {}

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(value.trim()), (char) => char.charCodeAt(0))
  } catch {
    throw new SealError('Not valid base64.')
  }
}

/** Which operator key a file is sealed to: 16 hex characters of sha256 over the SPKI bytes. */
export async function recipientId(spki: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki))
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** A new operator key pair: the public half for `BACKUP_PUBLIC_KEY`, the private half kept offline. */
export async function generateOperatorKeyPair(): Promise<{ publicSpki: string; privatePkcs8: string; recipient: string }> {
  const pair = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  return { publicSpki: toBase64(spki), privatePkcs8: toBase64(pkcs8), recipient: await recipientId(spki) }
}

const headerAad = (header: Omit<OperatorSealedBackup, 'nonce' | 'ciphertext'>) =>
  new TextEncoder().encode(
    canonicalJson({ alg: header.alg, appId: header.appId, ephemeralKey: header.ephemeralKey, exportedAt: header.exportedAt, format: header.format, recipient: header.recipient, version: header.version }),
  )

async function contentKey(shared: ArrayBuffer, ephemeralRaw: Uint8Array<ArrayBuffer>, recipient: string, usage: KeyUsage): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ephemeralRaw, info: new TextEncoder().encode(`model-court-backup-v2:${recipient}`) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

async function importRecipient(publicSpki: string): Promise<{ key: CryptoKey; id: string }> {
  const spki = fromBase64(publicSpki)
  try {
    return { key: await crypto.subtle.importKey('spki', spki, P256, false, []), id: await recipientId(spki) }
  } catch {
    throw new SealError('BACKUP_PUBLIC_KEY is not a P-256 public key (base64 SPKI).')
  }
}

/** Seals a snapshot to the operator's public key. The plaintext never leaves this function. */
export async function sealSnapshotTo(publicSpki: string, snapshot: StoreSnapshot): Promise<OperatorSealedBackup> {
  const recipient = await importRecipient(publicSpki)
  const ephemeral = (await crypto.subtle.generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair
  const ephemeralRaw = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey))
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient.key }, ephemeral.privateKey, 256)
  const header = {
    format: SEALED_BACKUP_FORMAT,
    version: SEALED_BACKUP_VERSION,
    alg: SEALED_BACKUP_ALG,
    appId: snapshot.appId,
    exportedAt: snapshot.exportedAt,
    recipient: recipient.id,
    ephemeralKey: toBase64(ephemeralRaw),
  } as const
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: headerAad(header), tagLength: 128 },
    await contentKey(shared, ephemeralRaw, recipient.id, 'encrypt'),
    new TextEncoder().encode(JSON.stringify(snapshot)),
  )
  return { ...header, nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

/** Opens a file with the operator's private key; refuses another key, a changed header or changed bytes. */
export async function openSnapshotWith(privatePkcs8: string, sealed: OperatorSealedBackup): Promise<StoreSnapshot> {
  if (sealed.format !== SEALED_BACKUP_FORMAT || sealed.version !== SEALED_BACKUP_VERSION || sealed.alg !== SEALED_BACKUP_ALG) throw new SealError('Not a Model Court operator-sealed backup (version 2).')
  let privateKey: CryptoKey
  try {
    privateKey = await crypto.subtle.importKey('pkcs8', fromBase64(privatePkcs8), P256, true, ['deriveBits'])
  } catch {
    throw new SealError('The private key is not a P-256 private key (base64 PKCS#8).')
  }
  // The matching public key, to name the wrong-key case plainly instead of as a failed decryption.
  const jwk = await crypto.subtle.exportKey('jwk', privateKey)
  const publicKey = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, P256, true, [])
  const id = await recipientId(new Uint8Array(await crypto.subtle.exportKey('spki', publicKey)))
  if (id !== sealed.recipient) throw new SealError(`This file is sealed to key ${sealed.recipient}, not to this private key (${id}).`)
  let snapshot: StoreSnapshot
  try {
    const ephemeralRaw = fromBase64(sealed.ephemeralKey)
    const ephemeral = await crypto.subtle.importKey('raw', ephemeralRaw, P256, false, [])
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: ephemeral }, privateKey, 256)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.nonce), additionalData: headerAad(sealed), tagLength: 128 },
      await contentKey(shared, ephemeralRaw, id, 'decrypt'),
      fromBase64(sealed.ciphertext),
    )
    snapshot = JSON.parse(new TextDecoder().decode(plaintext)) as StoreSnapshot
  } catch {
    throw new SealError('Backup could not be opened: the file was altered or is incomplete.')
  }
  if (snapshot.appId !== sealed.appId || snapshot.exportedAt !== sealed.exportedAt) throw new SealError('Backup header does not match its content.')
  if ((await sha256Hex(canonicalJson(snapshot.tables))) !== snapshot.contentDigest) throw new SealError('Backup content digest does not match.')
  return snapshot
}
