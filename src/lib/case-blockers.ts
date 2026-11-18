/** What still stands between a case draft and its next hearing, in plain sentences. */

import type { DraftInput } from '@/domain/contracts'
import { PROVIDER_NAMES, type ModelRoute, type ProviderId } from '@/domain/registry'
import { describeIssue, importCoverageIssues, readinessIssues } from '@/domain/snapshot'

export function caseBlockers({ draft, routes, imports, dirty, hasErrors, missingProviders, hasActiveHearing, generationDisabled }: { draft: DraftInput; routes: ModelRoute[] | null; imports: Parameters<typeof importCoverageIssues>[1]; dirty: boolean; hasErrors: boolean; missingProviders: ProviderId[]; hasActiveHearing: boolean; generationDisabled: boolean }): string[] {
  return [
    ...(dirty ? ['Save the draft first — a hearing uses the saved version.'] : []),
    ...(hasErrors ? ['Fix the highlighted fields.'] : []),
    ...(routes ? readinessIssues(draft, routes).map((issue) => describeIssue(issue, draft.cases)) : []),
    ...new Set(importCoverageIssues(draft, imports).map((issue) => describeIssue(issue))),
    ...missingProviders.map((provider) => `Add your ${PROVIDER_NAMES[provider]} key in Settings.`),
    ...(hasActiveHearing ? ['This case already has an unfinished hearing.'] : []),
    ...(generationDisabled ? ['Live generation is disabled on this deployment.'] : []),
  ]
}
