/**
 * Task kits in the signed-in app (spec 03 §11, D-79). Needs one usable DeepSpace test account and
 * makes no provider call: it opens a case from "Route support tickets", checks the kit, its labels
 * and an answer key on the Questions divider, and that switching the kit names what it removes
 * before removing it. The hearing itself (imported parties, sealed worksheet, unsealed checks) is
 * covered by tests/integration/task-kits.test.ts on both stores.
 *
 *   npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin
 */
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 1, `Needs 1 usable test account, found ${usableTestAccounts}. Create one with \`npx deepspace test accounts create\`.`)

test('a ticket-routing case carries its kit, and switching kits asks first', async ({ users }) => {
  const [judge] = await users(1)
  const page = judge.page
  await page.goto('/evaluations')
  await page.getByRole('button', { name: 'Open a new case' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Route support tickets').click()
  await dialog.getByRole('button', { name: 'Open case' }).click()
  await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/)

  await page.getByRole('tab', { name: /Questions/ }).click()
  await expect(page.getByText('Task kit')).toBeVisible()
  await expect(page.getByText('Classification', { exact: true }).first()).toBeVisible()
  await expect(page.getByLabel('Allowed labels, one per line')).toHaveValue('Billing\nBug\nAccount access\nFeature request\nOther')
  await expect(page.getByText('Classification: answer keys').first()).toBeVisible()

  // Switching to Summaries would drop five answer keys: the slip names them, and keeping the kit changes nothing.
  await page.getByRole('button', { name: /^Classification · \d+ automatic.*Change$/ }).click()
  await page.getByText('Summaries', { exact: true }).click()
  const slip = page.getByRole('alertdialog')
  await expect(slip).toContainText('Switching to Summaries removes answer keys from 5 questions.')
  await slip.getByRole('button', { name: 'Keep Classification' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByLabel('Allowed labels, one per line')).toBeVisible()
})
