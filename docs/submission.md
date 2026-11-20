# Submission

The note to submit, and the checklist to finish first. Due **Friday Nov 20, 2026, 11:59 p.m. Eastern**.

> [!IMPORTANT]
> Draft. Everything below except the bracketed lines is taken from [verification.md](verification.md)
> part A (agent checks). Fill each bracket with only what you observed yourself, then delete this box.

## Note

> I built Model Court, an app for comparing AI setups (models, prompts, settings) on your own questions
> through blind human review. A judge writes a case, starts a hearing in which two to five parties answer
> every question, reviews the answers without knowing which setup wrote them (alone or with up to three
> invited jurors, who can join as guests without an account), unseals the record and records a verdict.
>
> It runs on DeepSpace. It uses DeepSpace authentication, an app-owned SQLite Durable Object as the
> transactional store, JobRoom for paid generation jobs, CronRoom for maintenance and backups, RecordRoom
> for ID-only live notices, the app secrets store, the app's private files for sealed backups, and
> DeepSpace deployment. The spec planned managed D1, but the free tier refuses D1 bindings. The same schema
> therefore runs in a SQLite Durable Object, with every write in one transaction. Unique submissions,
> unseal-versus-submit ordering, frozen snapshots and budget reservations all need those guards.
>
> Live generation is strictly BYOK. The judge's own OpenAI, Anthropic or Google key pays for every call.
> Keys are encrypted with AES-256-GCM before storage, pinned to each hearing, and expire after 7 days unless
> renewed. Removing a key, or its expiry, stops queued work. Admin keys and keys pasted on the wrong
> provider's card are refused. Every request goes through an explicit allowlist of three provider hosts.
> Jurors never need keys. My main tradeoff was small, fixed datasets (up to 5 questions and 15 answers per
> juror) and a fixed three-line rubric, instead of automatic judging or large suites.
>
> Scope: I finished and deployed the spec's P0 first (tag `submission-candidate-1`), then v2 and seven
> roadmap items, each from its own spec, with tests and recorded decisions:
> - cost, speed and consistency per setup;
> - reusable scenarios and re-hearing;
> - task kits with free automatic checks (summaries, classification, field extraction from text or PDF,
>   answers from supplied sources, tool use with mock tools);
> - Google Gemini as a third provider;
> - up to five parties.
>
> Capabilities that haven't passed a paid live check stay off on the live app and say so in plain words:
> conversations, extraction, PDF, tool use and Gemini.
>
> The coding agent implemented the code, tests, docs and deploys, and ran the checks recorded in
> `docs/verification.md` part A: 679 unit tests and 296 integration tests, each integration test run on
> local D1 and on the real Durable Object store, plus 42 Playwright tests including signed-in flows. I
> personally verified [only what you checked yourself: docs/verification.md part B] and decided
> [your own decisions, for example deploying the roadmap before the deadline]. [Known limitation and next
> step, for example the paid smoke checks that turn on extraction and tool use.]
>
> Live URL: https://model-court.app.space. Repository: [the URL reviewers can open].

## Checklist

- [ ] The live URL works for a fresh judge account and a second juror account: one full hearing,
      unsealed, with a verdict
- [x] Both providers verified with a real call (Nov 17; [provider-contracts.md](provider-contracts.md))
- [ ] The repository is accessible to reviewers. `avxryn/model-court` is private; make it public or
      add the reviewers. The tree and full history were scanned for real key formats before each push
      and none were found.
- [ ] `master` matches what is live: merge `claude/roadmap-1-3` into `master`, or submit the branch
- [ ] Part B of [verification.md](verification.md) holds your own checks
- [ ] The note above contains only observed facts, and every bracket is filled
- [ ] The exposed Anthropic key is rotated
- [ ] Submitted before **Friday Nov 20, 2026, 11:59 p.m. Eastern**
