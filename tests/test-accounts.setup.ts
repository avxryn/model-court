/**
 * Runs once before the signed-in specs (a Playwright setup project): deletes every case the test
 * accounts own, so the specs never hit the 10-case limit however often they run or fail. Test
 * accounts only (~/.deepspace/test-accounts.json); skipped when there are none.
 */
import { loadAllTestAccounts, test } from 'deepspace/testing'
import { clearCases } from './helpers/cases'

const accounts = loadAllTestAccounts().length

test('clear the test accounts’ cases', async ({ users }) => {
  test.skip(accounts < 1, 'No test accounts.')
  test.setTimeout(120_000)
  for (const user of await users(accounts)) await clearCases(user.page)
})
