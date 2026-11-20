# Security review of v2 (branch `next`), Nov 17, 2026

Three reviewer agents each read one area of `git diff master...next` on their own, without the
builder's conclusions: guest-juror authentication, paid calls and imported evidence, and the frontend.
Every finding was then checked against the code before it was fixed. No finding was critical or high.

## Findings and outcomes

| # | Area | Severity | Finding | Outcome |
|---|---|---|---|---|
| 1 | Guest jurors | Medium (found by two reviewers) | A resume link redeemed itself on page load and overwrote this browser's guest cookie for the hearing, so a guest could plant another guest into their own seat. | **Fixed.** Resuming needs a click; the server refuses a resume when the browser already holds a valid cookie for a different juror in that hearing. |
| 2 | Guest jurors | Low | The "one-time" resume link could be reused until review closed, and could linger in a shared machine's history. | **Fixed.** Each use consumes the link (guarded on its hash) and returns a fresh one to the new device only. |
| 3 | Guest jurors | Low | The judge, or an already-seated juror, could take a guest seat; fabricated seats looked like real jurors. | **Fixed (signed-in case).** A guest join carrying a token for the judge or a seated juror is refused. Guest jurors are labelled "(guest, no account)" in the record and export, so seats taken without an account are visible. A judge using a private window can still create guest seats; the label makes them visible to every reader. |
| 4 | Guest jurors | Low | Device cookies had no server-side expiry, and a filed guest could not be signed out. | **Fixed.** Devices stop working 14 days after they were added. The judge can "Sign out devices" for any guest, filed or not; the worksheet stays. |
| 5 | Guest jurors | Low | With no client IP header, every request shared one rate-limit bucket that junk requests could exhaust. | **Fixed.** Without an IP the per-IP limit is skipped (Cloudflare always sets the header in production); per-juror limits still apply and secrets are 256-bit. |
| 6 | Guest jurors | Low | The restore "empty store" check ignored the guest-juror tables. | **Fixed.** Both tables must be empty before a restore. |
| 7 | Paid calls | Low | Deleting a case did not stop its special-master runs; queued grader units were never refunded. | **Fixed.** Deletion cancels grader runs, ends their outbox, and releases queued units; the send-time check also requires the case not to be deleted. |
| 8 | Paid calls | Low | A call fenced out just before sending (provably unsent) kept its budget unit until the lease expired as uncertain. Also true of hearings since v1. | **Fixed for both.** The unit is released and the attempt closed as `CANCELED`. |
| 9 | Paid calls | Low | Starting a hearing checked the generation switch before ownership, so a juror could learn whether every party was imported. | **Fixed.** Ownership is checked first. |
| 10 | Paid calls | Low (design) | Long imported answers can give the human party away by length. | **Unchanged by design (D-38).** The editor warns at 1.5× a generated answer's length. |
| 11 | Paid calls | Low | Purge left the special-master start receipt (IDs and a count only). | **Fixed.** Purge removes it. |
| 12 | Paid calls | Consistency | Grader output that finished after the key was removed was still accepted (hearings refuse this). | **Fixed.** Grader commits require the pinned key to still be active. |
| 13 | Frontend | Nit | A failed guest join leaves the invitation token in session storage for 30 minutes. | **Left.** The token is single-use and expires; a later sign-in would only retry it. |

## Checked and found sound (summary)

Route matching for guest cookies (no case, slash, encoding, HEAD, or query bypass); cookie/hearing
binding; the reserved `mcj_` namespace; CSRF rules for cookie mutations; pre-reveal blinding for guests
(identical projections); 256-bit secrets stored only as hashes and kept out of logs, audit, and URLs
sent to the server; BYOK ownership on every paid path (no cross-user credential pinning); fences and
single-winner claims; grader isolation from the findings; imported-evidence immutability and hashing;
CSV formula neutralization; no `dangerouslySetInnerHTML`, no open redirects, React-escaped rendering of
all model, imported, and user text; CSP unchanged and sufficient.
