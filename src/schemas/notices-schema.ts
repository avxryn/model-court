import type { CollectionSchema } from 'deepspace/schema'

/**
 * Safe live-invalidation notices (spec §5.2 "Safe live collection").
 *
 * Each row holds only a recipient, opaque evaluation/run IDs, and a revision
 * timestamp. It is a hint to refetch from the authorized API — never a copy of
 * evaluation state and never an authorization source. Rows are written only by
 * trusted Worker code (X-App-Action); clients may read their own rows and
 * cannot create, update, or delete any.
 */
export const NOTICES_COLLECTION = 'mc_notices'

export const noticesSchema: CollectionSchema = {
  name: NOTICES_COLLECTION,
  columns: [
    { name: 'recipientUserId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'evaluationId', storage: 'text', interpretation: 'plain', required: true, immutable: true },
    { name: 'runId', storage: 'text', interpretation: 'plain' },
    { name: 'revision', storage: 'number', interpretation: 'plain', required: true },
    { name: 'updatedAt', storage: 'number', interpretation: 'plain', required: true },
  ],
  ownerField: 'recipientUserId',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: 'own', create: false, update: false, delete: false },
  },
}
