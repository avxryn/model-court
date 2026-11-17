import { mergeConfig } from 'vitest/config'
import base from './vitest.integration.config'

// Same integration suite, run against the production ModelCourtStore Durable
// Object (SQLite) instead of local D1. See tests/integration/harness.ts.
export default mergeConfig(base, { test: { env: { MC_STORE: 'do' } } })
