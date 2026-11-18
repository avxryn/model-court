/**
 * `general-v1`: exactly today's behaviour (spec 03 §2). Free-form answers, the question's own
 * template (qa-v1, or chat-v1 when a question carries a conversation), the default rubric, and
 * no automatic checks, so a general hearing stores nothing new. Chosen by omission: drafts and
 * snapshots without a `kit` use it, and their bytes and hashes are unchanged. Never edit.
 */

import { templateFor } from '../messages'
import { RUBRIC_VERSION } from '../rubric'
import type { TaskKit } from './types'

export const GENERAL_V1: TaskKit<undefined, undefined> = {
  version: 'general-v1',
  family: 'general',
  name: 'General answers',
  description: 'Free-form answers the jury scores with the rubric. No automatic checks.',
  listed: true,
  inputKinds: ['text', 'conversation'],
  outputContract: { kind: 'text' },
  settingsSchema: null,
  caseFieldsSchema: null,
  defaultSettings: undefined,
  selectTemplate: templateFor,
  defaultRubricVersion: RUBRIC_VERSION,
  defaultJuryInstructions: null,
  checks: [],
}
