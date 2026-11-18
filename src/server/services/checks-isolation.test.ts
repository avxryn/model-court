/**
 * Spec 03 §3.6 (D-76): check results leave the server only through getResults, which refuses
 * before unsealing. Only these files may name the table; any other source reading it fails here.
 */

import { describe, expect, it } from 'vitest'

const ALLOWED = new Set(['/src/server/services/checks.ts', '/src/server/services/backup.ts', '/src/server/db/migrations.ts'])

const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('testimony_checks isolation', () => {
  it('is named only by the checks service, the backup and the migrations', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    const offenders = Object.entries(SOURCES).filter(([path, source]) => !ALLOWED.has(path) && source.includes('testimony_checks')).map(([path]) => path)
    expect(offenders).toEqual([])
    for (const path of ALLOWED) expect(SOURCES[path]).toContain('testimony_checks')
  })
})
