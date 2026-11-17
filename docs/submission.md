# Submission note — DRAFT (do not submit until bracketed items are filled with observed facts)

> I built Model Court, a small app for comparing AI configurations through blind human review. Users create cases, generate responses, review them without configuration metadata, and record a verdict backed by the responses and ratings.
>
> The app uses DeepSpace authentication, an app-owned SQLite Durable Object, background jobs (JobRoom), scheduled tasks (CronRoom), RecordRoom live notices, the app secrets store, and DeepSpace deployment. The spec planned managed D1, but the free tier refuses D1 bindings, so the same schema runs in a SQLite Durable Object with every write in one transaction. I needed a transactional store for the authoritative data because unique submissions, reveal-versus-submit ordering, frozen snapshots, and quota reservations need transactional guards; RecordRoom only carries ID-only invalidation notices. My main tradeoff was a fixed rubric and small text datasets (5 cases, 2 configurations) instead of automatic judging or larger suites.
>
> Live generation is strictly BYOK: the evaluation owner (shown in the app as the judge) supplies OpenAI and/or Anthropic API keys and pays those providers. Keys are encrypted with AES-256-GCM before storage, pinned to each run, expire after 7 days unless renewed, and are removable at any time; removal or expiry stops queued work and rejects late outputs. Admin keys are refused. [Confirm against your live run before submitting.] The public sample and jurors need no keys. DeepSpace supplies the platform primitives above; the direct OpenAI Responses and Anthropic Messages calls are separate integrations. This adds setup friction but keeps live model charges on the user's own provider account.
>
> The coding agent implemented [specific work — see docs/verification.md part A]. I personally verified [only what you checked — docs/verification.md part B] and changed [your actual corrections/decisions]. [Known limitation and next step.]
>
> Live URL: https://model-court.app.space. Repository: [URL — the only remote today is the DeepSpace deploy repo; push to a repository reviewers can open].

## Deliverable checklist

- [ ] Live URL works for a fresh account (judge) and a second account (juror)
- [x] Both providers verified with a real call (registry `verifiedAt` set; provider-contracts table filled, Nov 17)
- [ ] Repository accessible (no secrets committed: a scan of the tree and full history for real key formats found none on Nov 17)
- [ ] Human verification rows filled in `docs/verification.md`
- [ ] Note above contains only observed facts
- [ ] Submitted before **Friday Nov 20, 2026, 11:59 p.m. Eastern**
