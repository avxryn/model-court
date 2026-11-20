# Design notes (v2 phases 4–7)

Written Nov 17, 2026 against the `next` branch (SDK `deepspace@0.44.2`). Docs only: nothing here is built.

| Note | Phase | One-line summary |
|---|---|---|
| [imported-evidence.md](imported-evidence.md) | 4 | Imported parties (human baseline, exported transcripts) stored in their own immutable table; the snapshot hashes each imported text; blinding lint before a hearing starts |
| [conversations.md](conversations.md) | 5 | `chat-v1` template plus multi-message adapters keyed by `adapterVersion`; scripted whole conversations as one job per turn, with per-turn budget and failure rules; `conversation-v1` rubric |
| [special-master.md](special-master.md) | 6 | AI grader on the judge's key, after unsealing only, owner-only, in its own tables; pointwise and blind to identity; calibration shown first |
| [accountless-jurors.md](accountless-jurors.md) | 7 | Guest juror principal with a synthetic session ID and a `__Host-` HttpOnly cookie scoped on the server; a resume link; IP and principal limits; a seven-point blinding re-proof |

Findings that cut across notes:
- **Never rebuild `generations`.** With FKs on, dropping it cascades into the evidence tables. Every note uses additive tables.
- ~~`ADAPTERS` is keyed by provider while snapshots record `adapterVersion`. Phase 5 must key it by version.~~ Done in D-48.
- `DIMENSIONS` and `draftRatingSchema` are hard-wired to the three `reference-qa-v1` fields. Phases 5 and 6 depend on
  phase 3's versioned rubrics.
- Phase 7 depends on D-13 (read rate limiting).

## Research: can jurors sign in with an email link or email/password?

**Answer: no, not for real users on DeepSpace today.** Phase 3's "email-link sign-in for jurors" should be
recorded as unsupported and stopped, as `docs/archive/v2-plan.md` says. Checks were read-only: package sources, the CLI's
`--help`, and the public docs. No account was created and nothing was deployed.

Evidence:

1. **No magic link or email OTP is wired.** `createDeepSpaceAuth` (`node_modules/deepspace/dist/server.js`, about line 9277)
   imports only `organization` and `twoFactor` from `better-auth/plugins`. The bundled Better Auth ships `magic-link` and
   `email-otp` plugins, but DeepSpace does not register them. The client `authClient` (`dist/index.d.ts`, line 1608) has the same
   two plugins. Its route list holds only `/organization/*` and `/two-factor/*` (the "OTP" error codes there belong to two-factor).
   The 0.44.x CHANGELOG says, of a Better Auth advisory batch that included Magic Link, that "DeepSpace uses none of those features."
2. **Email/password exists, but only for existing accounts.** The server config defaults
   `emailAndPassword.enabled` to `config.emailAndPassword ?? true` and sets no `sendVerificationEmail` or
   `sendResetPassword`. `AuthOverlay` (`dist/index.js`, about line 1001) renders "Sign in with email", which calls `signIn.email`.
   It has no sign-up form, and `providers` accepts only `'github' | 'google'`.
3. **Signup is closed platform-wide.** Auth runs on the platform's hosted auth worker (`auth.deep.space`); the app only proxies
   `/api/auth/*` (`src/server/http-routes.ts`). The authentication guide (`docs.deep.space/guides/authentication.md`)
   says the email form is "not a signup form" and that "Public email signup is closed platform-wide". Accounts that use it
   are test accounts, while real users sign in with GitHub or Google. The client auth reference lists only GitHub and Google
   OAuth buttons and leaves magic links to "advanced flows" the app would have to build itself.
4. **Test accounts are not a juror path.** `deepspace test accounts create` makes capped `@deepspace.test`
   email/password accounts for Playwright (`TEST_ACCOUNT_EMAIL_SUFFIX` in `dist/server.js`). They are a developer
   testing tool, and handing them to real jurors would mean the judge creates and distributes passwords.
5. `npx deepspace auth --help` lists only `login`, `logout`, `whoami`, and `agent`, which manage the developer's own CLI
   session. There is no end-user auth setting.

What would change the answer: DeepSpace enabling public email signup, or registering the `magic-link`/`email-otp`
plugin on its auth worker. An app cannot do either, because it does not run its own auth instance. Until then, phase 7
(accountless jurors) is the only way to remove the GitHub/Google requirement.
