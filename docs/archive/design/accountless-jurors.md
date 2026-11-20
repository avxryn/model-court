# Design note: accountless jurors (phase 7, optional)

Status: **built on `next`, Nov 17, 2026 (D-41)**, with the departures D-41 lists. Research in [README.md](README.md) found that DeepSpace 0.44.2 has no
email-link or open email signup, so this is the only way a juror without GitHub or Google could take part.

## Today's identity model (what must keep holding)

- `api.ts` accepts only a verified platform JWT (`verifyToken`), and caller-supplied IDs are never read.
  Every service takes a `userId`.
- An invite is a 256-bit secret in the URL fragment, stored as a SHA-256 hash, single-use, 24 h, with at most 3
  slots per hearing counting unused links (`createInvite`, `activeInviteSlots`). `redeemInvite` binds it to the
  first signed-in redeemer and inserts `review_sessions (…, reviewer_user_id, context_type 'invited')`, which is
  `UNIQUE (run_id, reviewer_user_id)`.
- `loadRunAccess` returns `owner` only when `owner_user_id === userId`. Otherwise the caller must hold a non-revoked
  invited session. Everything else is a 404.
- Live updates are `mc_notices` rows keyed by `recipientUserId` and read over the RecordRoom socket with a JWT.
  RecordRoom gives unauthenticated sockets `anon-…` IDs with the `viewer` role, which `mc_notices` refuses to read.
- Mutations: an Origin check (it passes when `Origin` is **absent**) and `mut:<userId>` at 30 per minute. Reads are not rate-limited (D-13).

## Design

**Juror principal.** New table `juror_principals`: `id`, `run_id` FK cascade, `invite_id` (unique), `display_name`
(1–40 code points, control characters refused), `created_at`, `revoked_at`. New table `juror_devices`:
`id`, `principal_id` FK cascade, `secret_hash`, `created_at`, `last_seen_at`, `revoked_at`, with at most 3 live
devices per principal. The session row uses the **synthetic ID** `mcj_<principalId>` as `reviewer_user_id`. The prefix must
never match a platform user ID or RecordRoom's `anon-` prefix (verify the platform ID format, open question 1).
Because the session row is unchanged, `UNIQUE (run_id, reviewer_user_id)`, `loadRunAccess`, the scorer, the
`Juror N` labels, and every reviewer projection work with no change.

**Cookie.** `__Host-mcj-<runId>`: the value is `<deviceId>.<secret>` (256-bit random; the server stores only SHA-256),
with `HttpOnly; Secure; SameSite=Strict; Path=/` and `Max-Age` up to 14 days. The `__Host-` prefix stops a sibling
`*.app.space` app from planting a same-named cookie with `Domain=app.space`. It needs `Path=/`, so scope is enforced
on the server:
- The identity middleware tries the JWT first. With no Bearer token, it accepts a juror cookie **only** for
  `GET /runs/:runId`, `GET|PUT /runs/:runId/review`, `POST /runs/:runId/review/submit`, and `GET /runs/:runId/results`, and only
  when the cookie's `runId` and the path's `:runId` match the principal's `run_id`. Every other route returns 401.
- The caller becomes `{ userId: 'mcj_<id>', kind: 'juror', runId }`, so `requireOwner` can never pass.

**CSRF.** Cookies bring CSRF, which Bearer tokens did not. For cookie-authenticated mutations: require
`Origin` to be present and equal to `publicOrigin`, or `Sec-Fetch-Site: same-origin`; keep `SameSite=Strict`; and require
the custom `If-Match` and `Idempotency-Key` headers the routes already use. A cross-site form cannot set those.

**Joining.** `/join#token=…` offers "Sign in" (today's flow) or "Join with a name". `POST /api/v1/invites/redeem-as-guest`
sits outside the JWT middleware, takes `{ token, displayName }`, and is rate-limited per IP (`ip:<HMAC(ip)>`; the raw IP is never
stored). It runs the **same guards** as `redeemInvite`, inserting the principal, device, and session in one guarded batch,
then sets the cookie and returns `{ runId, resumeUrl }`. If the request also carries a valid JWT for the hearing's
owner, it is refused, as today.

**Resuming on another device.** The response includes a **resume link** `/join#resume=<256-bit secret>`, shown once with
a copy button and "Save this to continue on another device." There is no email, because the platform has no
email-link support. `POST /api/v1/juror/resume` (IP rate-limited, 5 per hour per principal, then a lockout) adds a device and
sets its cookie. The link works until review closes or the owner revokes the juror. Concurrent edits from two
devices are already safe: `saveReview` checks the session `revision`, and a stale `If-Match` gets 409.

**Owner controls.** The reviewer list shows display name, join time, and device count. "Remove juror" reuses
`revokeSession` rules (an unsubmitted session only; submitted evidence stays, spec §9.3) and also revokes every
device. "Sign out devices" revokes devices but keeps the session, and the owner can then issue a new resume link.

**Live updates without sign-in.** Polling: the review page polls `GET /runs/:runId` every 20 s while visible.
`If-None-Match` support is added (the ETag already exists) so most polls return 304. `noticeRecipients` skips `mcj_` IDs.
**D-13 read rate limiting must ship first**, with a per-principal read limit.

## Abuse limits

- Per invite link: still single-use, so one principal per link, and the 3-slot ceiling counts guest and signed-in jurors alike.
- Per IP: guest redeem 10 per hour, resume 5 per hour, and guest reads 120 per minute.
- Per principal: `mut:mcj_<id>` at 30 per minute (existing), devices ≤ 3, and display names never shown to other jurors.
- A leaked link lets anyone join as that juror, just as today, but without account accountability. The owner sees joins live,
  can remove a draft juror, and invites still expire in 24 h. An optional "owner approves guests" toggle is open question 3.

## Re-proving pre-reveal blinding (each must be a test)

1. Guests see only the existing allowlisted projections (`reviewerRunView`, `getReview`). No new DTO is added.
2. No configuration key, generation or attempt ID, provider, model, usage, or peer rating appears in any guest response.
3. A guest cookie cannot reach another hearing: a principal/path `runId` mismatch, or no session there, gives 401 or 404.
4. A guest can never act as owner (the synthetic namespace), can never redeem a second link into the same hearing (the unique
   session), and gets the same `stateConflict` on results before reveal.
5. Secrets (cookie, resume, invite) are only hashed at rest, never in URLs sent to the server, logs, receipts, or audit metadata.
6. Guests get no socket access, so no notice rows can leak through RecordRoom.
7. Each device of one principal sees the **same** shuffle (`assignment_json` is per session and immutable), and different jurors
   get independent shuffles.

## Tests needed

- A **blinding matrix**: every reviewer route is called as a JWT juror and as a guest juror on the same fixture. The response
  key sets must be identical, and a forbidden-strings scan must pass (extend T10 in `tests/integration/review.test.ts`).
- Integration, on both stores: guest redeem races with signed-in redeem and reveal (extend the T13 race loop);
  slot counting; revoked device → 401; principal removal; resume lockout; CSRF (missing Origin, cross-site Origin,
  missing custom header); polling 304; purge deletes principals and devices.
- Playwright: guest joins, saves a draft, resumes in a second browser context, submits, and the judge unseals.

## Open questions

1. What is the platform user-ID format, and is `app.space` on the Public Suffix List? The second decides how much the `__Host-`
   prefix matters.
2. Should guest jurors see results after unsealing, as signed-in jurors do today?
3. Should there be an owner-approval step for guest joins?
4. Should results distinguish guest from signed-in jurors (owner-only)?
