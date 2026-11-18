import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Fold } from '@/components/court/Fold'
import { Note, Panel } from '@/components/court/Paper'
import { StatusBadge } from '@/components/status/StatusBadge'
import type { PartyChange, ScenarioDiff } from '@/domain/scenario'
import { formatTime, plural } from '@/lib/format'
import { describePartyChange, describeScenarioDiff, hearingNumbers, type ModelName } from '@/lib/scenario-words'

export interface HearingRow {
  id: string
  status: string
  createdAt: number
}

/** The judge's extra facts per hearing (D-68). Parties are present only once that hearing is unsealed. */
export interface HearingVersionRow extends HearingRow {
  scenarioVersion: number
  number: number
  partyCount: number
  parties: ReadonlyArray<{ key: string; label: string; source: 'model' | 'imported'; provider: string | null; modelId: string | null }> | null
  changes: PartyChange[] | null
}

export interface DraftVersion {
  draftScenarioVersion: number | null
  nextScenarioVersion: number
  draftDiff: ScenarioDiff | null
}

function Row({ run, to, latest, version }: { run: HearingRow; to: string; latest: boolean; version?: { row: HearingVersionRow; modelName: ModelName; actions?: ReactNode } }) {
  const row = version?.row
  const modelName: ModelName = version?.modelName ?? ((_provider, modelId) => modelId)
  return (
    <li className="relative">
      <Link to={to} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4 outline-none transition-colors duration-150 hover:bg-slip focus-visible:bg-slip focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
        <span className="min-w-0">
          <span className="font-heading">
            {row ? `Hearing ${row.number}` : 'Hearing'} · {formatTime(run.createdAt)}
            {latest && <span className="ml-2 font-sans text-xs text-muted-foreground">latest</span>}
          </span>
          {row && (
            <span className="mt-1 block text-sm text-muted-foreground">
              {row.parties
                ? row.parties.map((party) => `${party.label}: ${party.source === 'imported' ? 'imported answers' : modelName(party.provider ?? '', party.modelId ?? '')}`).join(' · ')
                : `${plural(row.partyCount, 'party', 'parties')}, named once this hearing is unsealed`}
            </span>
          )}
          {row?.changes && row.changes.length > 0 && <span className="mt-0.5 block text-sm text-foreground/80">Changed: {row.changes.map((change) => describePartyChange(change, modelName)).join('; ')}</span>}
        </span>
        <StatusBadge status={run.status} />
      </Link>
      {version?.actions && <div className="px-5 pb-4">{version.actions}</div>}
    </li>
  )
}

/** Where the draft stands against the hearings' questions. */
function DraftStanding({ draft, groups }: { draft: DraftVersion; groups: Map<number, HearingVersionRow[]> }) {
  if (groups.size === 0) return null
  if (draft.draftScenarioVersion !== null) {
    const numbers = (groups.get(draft.draftScenarioVersion) ?? []).map((row) => row.number)
    return (
      <Note>
        Draft questions match <strong className="font-semibold text-foreground">v{draft.draftScenarioVersion}</strong> ({hearingNumbers(numbers)}). A hearing started now can be compared with {numbers.length === 1 ? 'it' : 'them'}.
      </Note>
    )
  }
  const lines = draft.draftDiff ? describeScenarioDiff(draft.draftDiff) : []
  return (
    <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
      <p>
        Draft questions differ from every hearing: the next hearing starts <strong className="font-semibold text-foreground">v{draft.nextScenarioVersion}</strong>.
      </p>
      {lines.length > 0 && (
        <Fold summary="What changed since the latest hearing" className="mt-1">
          <ul className="list-disc space-y-1 pl-5 text-foreground/80 marker:text-mark">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Fold>
      )}
    </div>
  )
}

/**
 * A case's hearings, newest first; each row opens that hearing. `to` picks the page (owner or juror).
 * With `versions` (the judge only), hearings are grouped by the questions they asked (D-68).
 */
export function HearingList({
  runs,
  to,
  versions,
}: {
  runs: ReadonlyArray<HearingRow>
  to: (run: HearingRow) => string
  versions?: { rows: ReadonlyArray<HearingVersionRow>; draft: DraftVersion; modelName: ModelName; actions?: (row: HearingVersionRow) => ReactNode }
}) {
  if (runs.length === 0) return <Note>No hearings yet. Each hearing freezes an unchangeable copy of the saved draft.</Note>
  const newestFirst = [...runs].sort((a, b) => b.createdAt - a.createdAt)
  const latestId = runs.length > 1 ? newestFirst[0].id : null
  if (!versions) {
    return (
      <Panel as="ul" className="divide-y divide-paper-rule overflow-hidden">
        {newestFirst.map((run) => (
          <Row key={run.id} run={run} to={to(run)} latest={run.id === latestId} />
        ))}
      </Panel>
    )
  }
  const groups = new Map<number, HearingVersionRow[]>()
  for (const run of newestFirst) {
    const row = versions.rows.find((item) => item.id === run.id)
    if (row) groups.set(row.scenarioVersion, [...(groups.get(row.scenarioVersion) ?? []), row])
  }
  // Newest version first: the group holding the newest hearing leads.
  const ordered = [...groups.entries()].sort(([, a], [, b]) => b[0].createdAt - a[0].createdAt)
  return (
    <div className="space-y-5">
      <DraftStanding draft={versions.draft} groups={groups} />
      {ordered.map(([version, rows]) => (
        <section key={version} aria-labelledby={`questions-v${version}`}>
          <h3 id={`questions-v${version}`} className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
            Questions v{version}
            <span className="font-normal text-muted-foreground">
              {hearingNumbers(rows.map((row) => row.number))}
              {rows.length > 1 && ', same questions'}
            </span>
          </h3>
          <Panel as="ul" className="divide-y divide-paper-rule overflow-hidden">
            {rows.map((row) => (
              <Row key={row.id} run={row} to={to(row)} latest={row.id === latestId} version={{ row, modelName: versions.modelName, actions: versions.actions?.(row) }} />
            ))}
          </Panel>
        </section>
      ))}
    </div>
  )
}
