import { describe, expect, it } from 'vitest'
import { quotaBlock, quotaStanding, repeatHint } from './quota'

const CAPS = { dailyPerUser: 20, dailyGlobal: 100, lifetimeGlobal: 500 }
const NOW = Date.UTC(2026, 10, 18, 15, 0, 0)

describe('quotaStanding', () => {
  it('starts with every cap free and resets at the next UTC midnight', () => {
    const standing = quotaStanding(CAPS, { userToday: 0, globalToday: 0, globalLifetime: 0 }, NOW)
    expect(standing.user).toEqual({ limit: 20, used: 0, remaining: 20 })
    expect(standing.globalToday.remaining).toBe(100)
    expect(standing.globalLifetime.remaining).toBe(500)
    expect(standing.available).toBe(20)
    expect(standing.resetsAt).toBe(Date.UTC(2026, 10, 19))
  })

  it('takes the tightest of the three caps as available', () => {
    expect(quotaStanding(CAPS, { userToday: 4, globalToday: 90, globalLifetime: 10 }, NOW).available).toBe(10)
    expect(quotaStanding(CAPS, { userToday: 4, globalToday: 10, globalLifetime: 10 }, NOW).available).toBe(16)
    expect(quotaStanding(CAPS, { userToday: 4, globalToday: 10, globalLifetime: 495 }, NOW).available).toBe(5)
  })

  it('never reports negative remaining, even if a cap was lowered below what is already used', () => {
    const standing = quotaStanding({ dailyPerUser: 5, dailyGlobal: 100, lifetimeGlobal: 500 }, { userToday: 8, globalToday: 8, globalLifetime: 8 }, NOW)
    expect(standing.user.remaining).toBe(0)
    expect(standing.available).toBe(0)
  })
})

describe('quotaBlock (Start gating)', () => {
  it('allows a hearing that fits, including one that uses exactly what is left', () => {
    const standing = quotaStanding(CAPS, { userToday: 10, globalToday: 10, globalLifetime: 10 }, NOW)
    expect(quotaBlock(10, standing)).toBeNull()
    expect(quotaBlock(0, standing)).toBeNull()
  })

  it('names the per-judge daily cap when that is what runs out', () => {
    const block = quotaBlock(10, quotaStanding(CAPS, { userToday: 14, globalToday: 14, globalLifetime: 14 }, NOW))
    expect(block?.cap).toBe('user')
    expect(block?.message).toBe('This hearing needs 10 calls, but you have 6 calls left today (20 a day per judge). Remove questions or parties, or start after the daily reset.')
  })

  it('names the deployment daily cap', () => {
    const block = quotaBlock(10, quotaStanding(CAPS, { userToday: 0, globalToday: 95, globalLifetime: 95 }, NOW))
    expect(block?.cap).toBe('globalToday')
    expect(block?.message).toContain('5 calls left today (100 a day shared by everyone)')
  })

  it('names the lifetime cap, also on a tie, because a daily reset would not help', () => {
    expect(quotaBlock(10, quotaStanding(CAPS, { userToday: 0, globalToday: 0, globalLifetime: 499 }, NOW))?.message).toContain('1 call left of its 500-call lifetime cap')
    expect(quotaBlock(10, quotaStanding(CAPS, { userToday: 20, globalToday: 20, globalLifetime: 500 }, NOW))?.cap).toBe('globalLifetime')
  })
})

describe('repeatHint (D-65)', () => {
  const party = { kind: 'model' }
  const draft = (samplesPerAnswer?: number, parties = 3) => ({ cases: [1, 2, 3, 4, 5], configurations: Array.from({ length: parties }, () => party), samplesPerAnswer })
  const fresh = quotaStanding(CAPS, { userToday: 0, globalToday: 0, globalLifetime: 0 }, NOW)

  it('offers asking once when the repeats do not fit but once does', () => {
    // 5 × 3 × 2 = 30 > 20; once = 15 fits.
    expect(quotaBlock(30, fresh)?.cap).toBe('user')
    expect(repeatHint(draft(2), fresh)).toBe('Ask each party once instead (15 calls).')
  })

  it('says nothing without repeats, when the repeats fit, or when even once does not fit', () => {
    expect(repeatHint(draft(undefined), fresh)).toBeNull()
    expect(repeatHint(draft(2, 2), fresh)).toBeNull() // 20 fits exactly
    const late = quotaStanding(CAPS, { userToday: 10, globalToday: 10, globalLifetime: 10 }, NOW)
    expect(repeatHint(draft(2), late)).toBeNull() // 15 > 10 left
  })
})
