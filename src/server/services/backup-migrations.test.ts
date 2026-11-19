import { describe, expect, it } from 'vitest'
import { BACKUP_TABLES, creatingMigration } from './backup'

describe('backup tables and their migrations (D-80)', () => {
  it('every backed-up table is created by a known migration', () => {
    for (const table of BACKUP_TABLES) expect(creatingMigration(table), table).not.toBeNull()
    expect(creatingMigration('testimony_checks')).toBe('0011_task_kit_checks')
    expect(creatingMigration('generations')).toBe('0001_initial')
    expect(creatingMigration('nope')).toBeNull()
  })
})
