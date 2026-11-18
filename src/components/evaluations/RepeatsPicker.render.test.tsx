import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { GenerationSection } from '@/components/hearing/GenerationSection'
import { makeExampleDraft } from '@/domain/example'
import type { OwnerRunView } from '@/lib/dto'
import { RepeatsPicker } from './RepeatsPicker'

const newId = () => crypto.randomUUID()
const imported = () => ({ kind: 'imported' as const, key: newId(), label: 'Baseline', provenance: { sourceType: 'human_baseline' as const, description: 'Written by the support team.', redacted: false } })

describe('RepeatsPicker (D-66)', () => {
  const draft = makeExampleDraft(newId, ['openai-gpt-6-luna', 'anthropic-claude-haiku-5-5'])

  it('shows the paid-call count with the samples multiplied in', () => {
    const html = renderToStaticMarkup(<RepeatsPicker draft={{ ...draft, samplesPerAnswer: 2 }} max={3} onChange={() => {}} />)
    expect(html).toContain('Repeats')
    expect(html).toContain('Twice')
    expect(html).toContain('20 paid calls')
    expect(html).toMatch(/This hearing makes <strong>20 paid calls<\/strong> \(5 questions × 2 model parties × 2 samples\), billed to your keys\./)
    expect(html).toContain('Jurors still score one answer per party')
  })

  it('says imported answers are used once when some parties are imported', () => {
    const html = renderToStaticMarkup(<RepeatsPicker draft={{ ...draft, comparisonMode: 'configuration', configurations: [draft.configurations[0], imported()], samplesPerAnswer: 3 }} max={3} onChange={() => {}} />)
    expect(html).toContain('Imported answers are used once.')
    expect(html).toContain('15 paid calls')
  })

  it('is hidden for imported-only drafts and when the deployment allows one sample', () => {
    expect(renderToStaticMarkup(<RepeatsPicker draft={{ ...draft, comparisonMode: 'configuration', configurations: [imported(), imported()] }} max={3} onChange={() => {}} />)).toBe('')
    expect(renderToStaticMarkup(<RepeatsPicker draft={draft} max={1} onChange={() => {}} />)).toBe('')
  })
})

describe('hearing page with repeats', () => {
  const generation = (id: string, caseKey: string, configurationKey: string, sampleNo: number, status: string) => ({ id, caseKey, configurationKey, sampleNo, status, attemptCount: 1, errorCode: status === 'failed' ? 'PROVIDER_RATE_LIMITED' : null, retryable: status === 'failed', durationMs: 1200, queueWaitMs: 5 })
  const run = (samples: number) =>
    ({
      runId: 'run1',
      status: 'ready',
      revision: 3,
      samplesPerAnswer: samples,
      pinnedKeys: [],
      configurations: [
        { key: 'A', label: 'Party A', source: 'generated', provider: 'openai', modelId: 'gpt-6-luna', provenance: null },
        { key: 'B', label: 'Party B', source: 'generated', provider: 'anthropic', modelId: 'claude-haiku-5-5', provenance: null },
      ],
      cases: [{ key: 'q1', title: 'Late return' }],
      imported: [],
      generations: ['A', 'B'].flatMap((party) => Array.from({ length: samples }, (_, i) => generation(`${party}${i + 1}`, 'q1', party, i + 1, party === 'A' && i === samples - 1 ? 'failed' : 'succeeded'))),
      counts: { planned: 2 * samples, pending: 0, running: 0, succeeded: 2 * samples - 1, failed: 1, uncertain: 0, canceled: 0 },
      eligibility: { caseKeys: ['q1'], excludedCaseKeys: [], frozen: false },
    }) as unknown as OwnerRunView

  it('groups each question and party into sample dots, with one retry box per failed sample', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GenerationSection run={run(3)} busy={false} act={async () => {}} folded={false} />
      </MemoryRouter>,
    )
    expect(html).toContain('aria-label="2 of 3 samples answered"')
    expect(html).toContain('aria-label="3 of 3 samples answered"')
    expect(html).toContain('Sample 3')
    expect(html).toContain('Select Late return / Party A, sample 3, for retry')
    expect(html.match(/for retry/g)?.length).toBe(1)
  })

  it('keeps the single-sample layout unchanged', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GenerationSection run={run(1)} busy={false} act={async () => {}} folded={false} />
      </MemoryRouter>,
    )
    expect(html).not.toContain('samples answered')
    expect(html).not.toContain('Sample 1')
    expect(html).toContain('Select Late return / Party A for retry')
  })
})
