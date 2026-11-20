# Security policy

## Reporting a vulnerability

Please report security problems privately, using GitHub's **Report a vulnerability** button on the
repository's Security tab. Don't open a public issue for them.

Never put a real API key, password, invitation link or personal data in a report. Describe the problem
and how to reproduce it with test values instead.

## Scope

- The app at https://model-court.app.space and the code in this repository.
- Of most interest: anything that exposes a saved provider key, lets a juror learn which model wrote an
  answer before the record is unsealed, sends a request to a host outside the three provider origins, or
  lets one account read another's cases.

## How keys and data are protected

See [docs/security.md](docs/security.md): BYOK key handling, blinding, the outbound allowlist, guest
jurors, exports and backups, and the review history.
