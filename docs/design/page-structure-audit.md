# Page structure audit (Nov 17, 2026)

Written against `claude/open-folder-design-c7a6ea` (D-45). The audit came first; nothing in it was built at the time. **Status:** you approved all of R1–R14, and they were built with the mechanical items (D-46). Each page entry lists what the page holds, what its reader needs, and proposals. Proposals tagged **[R#]** change the page layout and need approval. **[M]** items are mechanical: file splits and shadcn swaps that keep the page looking and behaving the same.

Out of scope: the model and party picker internals (`src/domain/registry.ts`, the provider adapters, the model `Select` inside `ConfigurationsEditor`), which a parallel session owns, and the static landing page `src/pages/index.tsx`.

## Cross-cutting findings

### Duplicated markup and helpers

| Pattern | Where | Proposal |
|---|---|---|
| Radio "choice card" (Label + RadioGroupItem, `border-foreground bg-slip` when chosen) | `RubricPicker`, comparison mode, verdict form | One `ChoiceCard` / `ChoiceCardGroup` in `components/court` **[M]** |
| Question pager (Q1…Qn buttons, done ticks, `aria-current="step"`) plus Previous/Next | `runs/[id]/review.tsx`, `sample.tsx` | `QuestionPager` + `QuestionStepper` in `components/review` **[M]** |
| Worksheet grid (sticky case material and testimony cards) | review, sample | `WorksheetGrid` in `components/review` **[M]** |
| Findings table (rubric lines by party, overall-mean row) | `results.tsx` (`CohortTable`), `sample.tsx`, `judgment.tsx` (raw `<table>`) | One `FindingsTable` on `ui/table`, with a `print` density for the judgment **[M]** |
| Judge's signature line and stamp | results `VerdictSection`, sample example judgment, judgment page | `JudgeSignature` in `components/court` **[M]** |
| Hearing list (one row per hearing with a status badge) | case page juror view and Hearings divider | `HearingList` in `components/evaluations` **[M]** |
| `beforeunload` warning on unsaved edits | case page, review | `useUnsavedChangesWarning(dirty)` in `lib/` **[M]** |
| `<p role="alert" className="text-sm text-destructive">` form errors | run dialog, verdict form, key form, imported answers | `FieldError` from `ui/field` **[M]** |
| Counted text field (Label, input, help or error, n/max) | `DraftEditor` `TextField`, verdict reasons | `CountedField` built on `ui/field` **[M]** |
| `rounded-[2px] bg-white ring-1 ring-exhibit-edge` panels | KeyStatus, party mapping cards, special-master runs, `Exhibit` | `Panel` (the `exhibit-panel` class) **[M]** |
| Dashed instruction slip (`border-dashed border-slip-edge bg-slip`) | key safety notes ×2, `JuryInstructions`, conversation editor, blockers popover | One `Slip` component **[M]** |
| `rounded-[2px] bg-slip px-5 py-4 … muted` quiet notes | `CohortTable`, sample findings placeholder | Existing `Note` **[M]** |

### Hand-rolled markup that a shadcn component covers

| Markup | Where | Replace with |
|---|---|---|
| `<details>/<summary>` ×7 | results (system instructions, testimony per question, earlier revisions), Proceedings `Collapsible`, special master ×2, case blockers | New `ui/collapsible` (Base UI Collapsible); testimony per question uses new `ui/accordion` (multiple open) |
| Blockers dropdown built from `<details>` with an absolute panel | case action bar | New `ui/popover` (Base UI Popover). Today it does not close on outside click or Escape |
| Raw `<button className="underline">` | case page draft-conflict alert | `Button variant="link"` in `AlertAction` |
| Raw `<button>` ×2 | `Sidebar` menu toggle and folder chevron | `Button variant="ghost" size="icon-sm"` |
| Raw `<table>` | `judgment.tsx` findings | `ui/table` with print styles |
| Hand-built breadcrumbs (`<nav><ol>` with chevrons) | `common.tsx` `Breadcrumbs` | New `ui/breadcrumb` (shadcn Breadcrumb, `render` for links) |
| Label + help `<p>` stacks | key form, delete-case confirm, verdict, draft fields | `Field`, `FieldLabel`, `FieldDescription`, `FieldError` (already in `ui/field`, used nowhere) |
| "Saved" `Badge` with ad hoc success classes | API keys | `StatusBadge` tone `good` |

### Tokens

- `bg-white` is used for exhibit panels and inputs in about a dozen places. It is not a palette token. Add `--exhibit` (and `bg-exhibit`) to `src/styles.css`.
- `Exhibit` uses an ad hoc `shadow-[0_6px_14px_-6px_rgb(60_45_15/0.18)]`. Make it a `--shadow-exhibit` token.
- No hex values in components. The hex values sit in `styles.css` tokens, which is correct.

### `src/components/common.tsx` (297 lines, a grab-bag)

It holds 17 exports across five concerns. Split as follows **[M]**:

- `components/layout/Page.tsx`: `Page`, `PageHeader`, `Breadcrumbs` (moved onto `ui/breadcrumb`)
- `components/status/StatusBadge.tsx` and `lib/status.ts`: `RUN_STATUS`, `statusInfo`, `TONE_DOT`, `StatusBadge`. `StatusBadge` reads `RUN_STATUS` directly and does not call `statusInfo`; merge the two lookups.
- `components/feedback/*`: `ErrorPanel`, `StaleNotice`, `NotFoundPanel`, `PageSkeleton`, `EmptyState`, `SaveIndicator`
- `components/court/Paper.tsx`: `Plain`, `Panel`, `Note`, and the new `Slip`
- `lib/format.ts`: `formatTime`, `formatDuration`; `lib/error-text.ts`: `ERROR_TEXT`

`common.tsx` is deleted, not kept as a re-export barrel.

## Pages

### Case page: `evaluations/[id].tsx` (532 lines)

**Contains.** A loader switch. A juror view (caption plus hearing list). The judge's view, which holds:

- the draft state, saving, validation, the readiness blockers and the `beforeunload` warning;
- the folder with dividers A Questions, B Parties and C Hearings;
- a caption with the stage line, hearing count, latest hearing and task description;
- a conflict alert and an active-hearing alert;
- under Questions, the rubric picker and the question cards;
- under Parties, the party cards, the imported-answer editors and "Keys this comparison needs";
- under Hearings, a list;
- a sticky action bar (Save, save state, blockers, paid-call count, Start);
- the start dialog with consent, the ⋯ menu, and the delete dialog.

**The judge needs:** to edit questions and parties, to see what blocks a hearing, to start one, and to get to existing hearings. **A juror needs:** a link to their worksheet.

**Proposals.**
- **[R1] Fold each question's optional parts.** The conversation-so-far box and the language field sit open on every question card, even when empty. Put them behind a collapsible "More: earlier conversation, language" per question. It opens on its own when either has content or an error. This roughly halves the height of each question card.
- **[R2] Rubric becomes a one-line summary.** The rubric picker takes three cards at the top of Questions. Show "Rubric: Standard · Change" and open the cards in a collapsible. A rubric is chosen once per case.
- **[R3] Keys only when missing.** "Keys this comparison needs" repeats what the blockers popover already says ("Add your OpenAI key"). Show it only when a key is missing, as a compact `Alert` at the top of Parties linking to Settings. When all keys are saved, one line under the party cards says so.
- **[R4] Open on Hearings once there is one.** With an active or past hearing, the folder opens on C Hearings, and the latest hearing is the first row with its stage. Today it always opens on Questions.
- **[M]** Split the file into `components/evaluations/`: `JurorCaseView`, `useCaseDraft` (draft, save, errors, unload warning), `caseBlockers()` as a pure function in `lib/`, `CaseActionBar`, `StartHearingDialog`, `DeleteCaseDialog`, `CaseActionsMenu`, `KeyStatus`, `HearingList`. Swap the blockers `<details>` for a Popover and the raw `<button>` for `Button variant="link"`.

### Record: `runs/[id]/results.tsx` (518 lines)

**Contains:**
- the sealed-state alert and the caption;
- a contents bar with 5 to 7 entries;
- Parties (who is who, with provenance or system instructions);
- Findings (jury/judge tabs, chart and table) and a caution alert;
- Judgment (the latest judgment, signature, earlier revisions, and the enter/revise form);
- Testimony (one `<details>` per question with the conversation, question, instructions, responses side by side and a ratings table);
- Reliability (coverage table) and By language (table);
- Special master and Export, both judge only.

**A juror needs:** who was who, the findings and the judgment. **The judge also needs:** the testimony for justifying the judgment, reliability, entering judgment, export and the special master.

**Proposals.** This is the longest scroll in the app. The hearing already has a Judgment divider (today a print view).
- **[R5] Judgment form moves to the Judgment divider.** The Judgment divider becomes the place to enter, revise and print judgment. It already shows the findings and the parties, so the judge writes with the numbers in view. The Record keeps a short "Judgment" summary (outcome, signature) with "Enter judgment →" or "Revise →".
- **[R6] Export moves to the Judgment divider.** The certified record download sits beside "Print judgment". Both are "the file you take away".
- **[R7] Special master gets its own divider.** It becomes `E Special master`, judge only, locked until unsealing, at `/runs/:id/special-master`. It is a separate, paid, advisory tool and should not sit among the jury's findings.
- **[R8] Reliability and By language fold into one collapsed section.** "Reliability" is collapsed by default, with its headline in the summary ("12/12 answers taken · 0 failed"). By language goes inside it.
- **[M]** Testimony per question uses `Accordion` (multiple, first open). Earlier revisions and system instructions use `Collapsible`. `CohortTable` becomes the shared `FindingsTable`, the party cards use `Panel`, and the judge's signature uses `JudgeSignature`. Split into `components/record/`: `PartiesSection`, `FindingsSection`, `TestimonySection`, `ReliabilitySection`, `VerdictSection`, `VerdictForm`, `CertifiedRecord`.

The juror's Record keeps Parties, Findings, Judgment (summary) and Testimony.

### Proceedings: `runs/[id]/index.tsx` (438 lines)

**Contains:**
- polling and the live socket;
- a caption with the stage line, a status badge and the live indicator;
- generation progress, collapsed (`<details>`) once deliberation opens;
- the per-question/per-party table with retry checkboxes, and Retry / Open deliberation / Cancel hearing;
- the jury panel (participants, guest device sign-out, remove, summonses and revoke, own review, summon a juror, unseal);
- the invitation link dialog.

**The judge needs:** while generating, progress and failures (retry). When ready, Open deliberation. While deliberating, who has filed, a way to summon, and Unseal. Afterwards, the way to the record.

**Proposals.**
- **[R9] Current stage first.** Once deliberation opens, the jury panel comes first and generation drops below it as a collapsed "Testimony taken: 12/12 · 0 failed".
- **[R10] Cancel hearing moves into a ⋯ "Hearing actions" menu.** It goes beside the breadcrumbs, as on the case page. A destructive action should not sit next to Open deliberation.
- **[R11] One status signal in the caption.** Drop the `StatusBadge` there, since the stage line says the same thing. Keep the Live / Reconnecting indicator.
- **[M]** Swap the local `Collapsible` (`<details>`) for `ui/collapsible`. Split into `components/hearing/`: `GenerationTable`, `GenerationControls` (retry, open deliberation, cancel), `JuryPanel`, `JurySummonsDialog`, `UnsealButton`, `OpenDeliberationButton`.

### Draft editor: `components/evaluations/DraftEditor.tsx` (420 lines)

**Contains:** `TextField`, `CasesEditor`, `ConversationEditor`, `RubricPicker`, `ConfigurationsEditor` (comparison mode, shared instructions, party cards, the model `Select`, add-party buttons) and `ImportedPartyFields`.

**Proposals.**
- R1 and R2 above.
- **[M]** Move `TextField` (as `CountedField` on `ui/field`), `CasesEditor` (as `QuestionsEditor.tsx`), `ConversationEditor`, `RubricPicker` and `ImportedPartyFields` into their own files. Use `ChoiceCard` for the rubric and the comparison mode. `ConfigurationsEditor`, including the model `Select`, stays in `DraftEditor.tsx` untouched so the model-catalog session's edits merge cleanly.

### `common.tsx`

See the cross-cutting section.

### API keys: `settings/api-keys.tsx` (278 lines)

**Contains:** the page header, one card per provider (saved state, an add/replace form with consent, renew, remove), and two safety slips.

**The judge needs:** whether each key is saved, and the add / replace / renew / remove actions. The safety text matters most when adding a key.

**Proposals.**
- **[R12] Safety advice sits with the form.** "Use a key you can afford to lose" appears inside the add/replace form, as a `Slip` beside the key field, where it is acted on. "How keys are stored" stays on the page as one short paragraph, with the operator-trust detail in a collapsible.
- **[M]** Move `ProviderKeyCard` to `components/settings/` and build the form on `Field` and `FieldError`. "Saved" becomes `StatusBadge`. The slips become `Slip`.

### Sample: `sample.tsx` (276 lines)

**Contains:** the illustrative alert, the question pager, the worksheet grid and Previous/Next with "Unseal". After unsealing, a who-was-who table, practice findings (chart and table), an example judgment and restart buttons.

**Proposals.**
- No layout change. It should keep mirroring the real worksheet and record.
- **[M]** It shrinks by reusing `QuestionPager`, `QuestionStepper`, `WorksheetGrid`, `FindingsTable` and `JudgeSignature`.

### Worksheet: `runs/[id]/review.tsx` (263 lines)

**Contains:**
- a header with the save state and the "filed" stamp;
- up to four stacked alerts (jury closed, findings filed, the judge's context-aware notice, a conflict);
- the question pager and the worksheet grid;
- Previous/Next, File findings (confirm) and "n items left".

**A juror needs:** the question, the testimony, the rubric, save state, moving between questions, and filing.

**Proposals.**
- **[R13] Fewer stacked alerts.** The judge's "you know which parties you chose" alert becomes one line under the header's description, since it is shown on every visit. "Findings filed" merges with the FILED stamp's line. Only the jury-closed and conflict alerts stay as `Alert`.
- **[R14] Progress where you file.** "n items left" moves into the File findings row, next to the button, as "8 of 10 scored".
- **[M]** Move autosave into a `useWorksheetAutosave` hook. Reuse `QuestionPager`, `QuestionStepper`, `WorksheetGrid` and `useUnsavedChangesWarning`.

## Components to add to `src/components/ui`

These follow the shadcn Base UI registry pattern used by the existing ones:

- `collapsible`
- `accordion`
- `popover`
- `breadcrumb`
