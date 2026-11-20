# Submission

The submission for the task form, due **Friday Nov 20, 2026, 11:59 p.m. Eastern**. The form takes three
fields: the deployed app URL, the repository, and a writeup (what you built, which primitives you used,
where the agent helped). The full note follows the form text. Agent facts come from
[verification.md](verification.md) part A, and Avery's own lines from part B.

## Form fields

| Field | Value |
|---|---|
| Deployed app URL | `https://model-court.app.space/` |
| Repository | `github.com/avxryn/model-court` (reviewers need access: make it public or add them) |

### Writeup (plain text, paste as is)

```text
I built Model Court, a blind human-review app for choosing between AI setups (models, prompts, settings) on your own questions. A judge writes a case (up to 5 questions, a scoring guide, 2 to 5 parties), starts a hearing in which every party answers every question, and reviews the answers without knowing which setup wrote them, alone or with up to three invited jurors who can join as guests without an account. After unsealing, the record shows the jury's scores, free automatic checks, cost, speed and consistency, and the judge records a verdict. Kits cover plain Q&A, summaries, classification, field extraction from text or PDF, answers from supplied sources, and tool use against mock tools. Live generation is strictly BYOK: the judge's own OpenAI, Anthropic or Google key pays for every call; keys are encrypted with AES-256-GCM, pinned to each hearing, expire after 7 days, and only reach their own provider through a three-host allowlist.

DeepSpace primitives: authentication; an app-owned SQLite Durable Object as the transactional store (the free tier refuses D1, and unique submissions, unseal ordering, frozen snapshots and budget reservations need guarded writes); JobRoom for paid generation and tool-step jobs (outbox, guarded claim, send outside a transaction, fenced commit, no automatic paid retry); CronRoom for repair, maintenance and sealed daily backups; RecordRoom for ID-only live notices; the app secrets store for the key-encryption roots; the owner's private app files for backups; and deepspace deploy.

Where the agent helped: the coding agent wrote the code, tests, docs and deploys from my spec and seven roadmap specs, ran parallel sessions with independent review passes, and kept its own checks apart from mine: 679 unit and 296 integration tests (each on local D1 and the real Durable Object), 42 Playwright tests including signed-in flows. I set the rules (strict BYOK, keys never shown or logged, agent checks recorded separately), decided what shipped and when, and verified it live myself: on Nov 20 I ran a full hearing on the deployed app with my own keys, GPT-6 Luna against Claude Haiku 5.5, all 10 calls succeeded, a guest juror scored blind, and I recorded the verdict after unsealing. Known limitation: that live evidence is one juror on five questions, and extraction, PDF, tool use, conversations and Gemini stay off until their paid live checks run.
```

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
> personally verified that the signed-in pages load on the live app (Nov 17). I also ran one full live
> hearing on Nov 20. I saved my own OpenAI and Anthropic keys and started a five-question hearing, GPT-6
> Luna against Claude Haiku 5.5, and all 10 calls succeeded. A guest juror with no account scored the
> answers blind from a separate private window. After unsealing, I chose the verdict: Claude Haiku 5.5,
> for better grounding.
>
> I decided that live generation stays strictly BYOK, with no sponsored calls, and that keys are never
> shown, logged or sent anywhere but their own provider. I also decided that the agent's checks and mine
> are recorded separately. Finally, I chose to deploy the roadmap on Nov 19, before this deadline and
> without a backup, because no backup path existed yet.
>
> Known limitation: the live evidence is small, one juror on five questions. Conversations, extraction,
> PDF, tool use and Gemini stay off until their paid smoke checks run, and those checks come next. After
> them come turning on the sealed daily backups and reviewing the four- and five-party screens.
>
> Live URL: https://model-court.app.space. Repository: https://github.com/avxryn/model-court.

## Checklist

- [x] The live URL works for a fresh judge account and a second juror account: one full hearing,
      unsealed, with a verdict (Nov 20: 10/10 live calls, a guest juror, unsealed, judgment entered; [verification.md](verification.md))
- [x] Both providers verified with a real call (Nov 17; [provider-contracts.md](provider-contracts.md))
- [ ] The repository is accessible to reviewers. `avxryn/model-court` is private; make it public or
      add the reviewers. The tree and full history were scanned for real key formats before each push
      and none were found.
- [x] `master` matches what is live (fast-forwarded to `claude/roadmap-1-3` on Nov 20)
- [x] Part B of [verification.md](verification.md) holds your own checks (Nov 17 and Nov 20)
- [ ] The note above contains only observed facts, and you have read it through (every bracket is filled)
- [x] The exposed Anthropic key is rotated (Nov 20)
- [ ] Submitted before **Friday Nov 20, 2026, 11:59 p.m. Eastern**
