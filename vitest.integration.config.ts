import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Integration suite: real Hono API + real local D1 (Miniflare). External
// boundaries (auth issuer, JobRoom, notices, provider HTTP) are stubbed.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
