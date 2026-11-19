import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { catalogModelName } from '@/lib/scenario-words'
import { HearingList, type HearingVersionRow } from './HearingList'

const models = [
  { provider: 'openai', modelId: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { provider: 'openai', modelId: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
]
const party = (label: string, modelId: string) => ({ key: label, label, source: 'model' as const, provider: 'openai', modelId })
const rows: HearingVersionRow[] = [
  { id: 'r1', status: 'decided', createdAt: 1, scenarioVersion: 1, number: 1, partyCount: 2, parties: [party('Party A', 'gpt-6-luna'), party('Party B', 'gpt-6-luna')], changes: null },
  {
    id: 'r2',
    status: 'revealed',
    createdAt: 2,
    scenarioVersion: 1,
    number: 2,
    partyCount: 2,
    parties: [party('Party A', 'gpt-6-luna'), party('Party B', 'gpt-6.2-sol')],
    changes: [{ kind: 'model', label: 'Party B', from: { provider: 'openai', modelId: 'gpt-6-luna' }, to: { provider: 'openai', modelId: 'gpt-6.2-sol' } }, { kind: 'prompt', label: 'Party A' }],
  },
  { id: 'r3', status: 'reviewing', createdAt: 3, scenarioVersion: 2, number: 3, partyCount: 3, parties: null, changes: null },
]

const render = (draft: { draftScenarioVersion: number | null; nextScenarioVersion: number; draftDiff: any }) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <HearingList runs={rows} to={(run) => `/runs/${run.id}`} versions={{ rows, draft, modelName: catalogModelName(models) }} />
    </MemoryRouter>,
  )

describe('HearingList with scenario versions (D-68)', () => {
  it('groups by questions, newest version first, and names parties only once unsealed', () => {
    const html = render({ draftScenarioVersion: 1, nextScenarioVersion: 3, draftDiff: null })
    expect(html.indexOf('Questions v2')).toBeLessThan(html.indexOf('Questions v1'))
    expect(html).toContain('hearings 1 and 2')
    expect(html).toContain('Party A: OpenAI GPT-6 Luna · Party B: OpenAI GPT-6.2 Sol')
    expect(html).toContain('3 parties, named once this hearing is unsealed')
    expect(html).not.toMatch(/Hearing 3[^]*Party A: OpenAI[^]*Questions v1/)
    expect(html).toContain('Changed: Party B: model OpenAI GPT-6 Luna → OpenAI GPT-6.2 Sol; System instructions changed for Party A')
    expect(html).toMatch(/Draft questions match <strong[^>]*>v1<\/strong> \(hearings 1 and 2\)/)
  })

  it('says when the draft starts a new version', () => {
    const html = render({ draftScenarioVersion: null, nextScenarioVersion: 3, draftDiff: { added: [{ key: 'k', title: 'New one' }], removed: [], edited: [], rubricChanged: true, templateChanged: false, kitChanged: false } })
    expect(html).toMatch(/the next hearing starts <strong[^>]*>v3<\/strong>/)
    expect(html).toContain('What changed since the latest hearing')
  })

  it('keeps the plain list for jurors', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <HearingList runs={rows} to={(run) => `/runs/${run.id}`} />
      </MemoryRouter>,
    )
    expect(html).not.toContain('Questions v')
    expect(html).not.toContain('Party A')
  })
})
