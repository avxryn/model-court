# Submission

The note to submit, and the checklist to finish first. Due **Friday Nov 20, 2026, 11:59 p.m. Eastern**.

> [!IMPORTANT]
> Ready for your read-through. The agent facts come from [verification.md](verification.md) part A. Your
> own lines come from part B and from what you said in the working session. Change anything that isn't
> how you'd put it, then delete this box.

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
- [ ] The exposed Anthropic key is rotated
- [ ] Submitted before **Friday Nov 20, 2026, 11:59 p.m. Eastern**
