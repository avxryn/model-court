/**
 * WebSocket routing (scaffold pattern, narrowed for Model Court).
 *
 * Only the app RecordRoom socket is exposed; it carries the safe notice
 * collection and the users profile. The Yjs, canvas, presence, cron, and
 * job sockets are not registered: Model Court has no client use for them, and
 * job/cron control must stay server-side (spec §9.2, V4). Caller identity in
 * query parameters and headers is never trusted; only a verified JWT is.
 */

import type { Hono } from 'hono'
import { authenticatedRoomRequest, verifyJwt } from 'deepspace/worker'
import type { VerifyResult } from 'deepspace/worker'
import type { AppContext } from '../../worker.js'

export function registerRealtimeRoutes(app: Hono<AppContext>): void {
  app.get('/ws/:roomId', async (c) => {
    const roomId = c.req.param('roomId')
    // One room per app; never let callers mint arbitrary Durable Objects.
    if (roomId !== `app:${c.env.DEEPSPACE_APP_ID}`) return new Response('Not found', { status: 404 })
    const token = new URL(c.req.url).searchParams.get('token')
    let auth: VerifyResult | null = null
    if (token) {
      auth = (await verifyJwt({ publicKey: c.env.AUTH_JWT_PUBLIC_KEY, issuer: c.env.AUTH_JWT_ISSUER }, token)).result
      if (!auth) return new Response('Unauthorized', { status: 401 })
    }
    const stub = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(roomId))
    return stub.fetch(authenticatedRoomRequest(c.req.raw, auth))
  })
}
