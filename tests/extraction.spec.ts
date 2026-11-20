/**
 * Field extraction in the signed-in app (spec 04 §11.3, D-88). Needs one usable DeepSpace test
 * account and makes no provider call: it opens a case from "Pull fields from documents", checks
 * the field list, the must-fill warning and the privacy line, a refused keyword's fix, the saved
 * documents and an answer key on the Questions divider. The hearing itself (worksheet fields,
 * flags, unsealed Extraction section) is covered by tests/integration/extraction.test.ts on both
 * stores, and the components by render tests.
 *
 *   npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin
 */
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 1, `Needs 1 usable test account, found ${usableTestAccounts}. Create one with \`npx deepspace test accounts create\`.`)

test('a field-extraction case carries its field list, documents and answer keys', async ({ users }) => {
  const [judge] = await users(1)
  const page = judge.page
  await page.goto('/evaluations')
  await page.getByRole('button', { name: 'Open a new case' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Pull fields from documents').click()
  await dialog.getByRole('button', { name: 'Open case' }).click()
  await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/)

  await page.getByRole('tab', { name: /Questions/ }).click()
  await expect(page.getByText('Pull fields from documents', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/A field marked Must be filled can.t be left empty/)).toBeVisible()
  await expect(page.getByText(/Field names, descriptions and allowed values are sent to OpenAI and Anthropic/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Name must be filled/ })).toBeChecked()
  await expect(page.getByText(/Saved · (under 1|[\d,]+) KB of text/).first()).toBeVisible()
  await expect(page.getByLabel(/Answer key \(optional\)/).first()).toHaveValue(/Dana Whitfield/)

  // D-119: at phone width the editor never scrolls sideways (a fieldset used to keep its min-content width).
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 1280, height: 720 })

  // An unsupported keyword shows its fix before anything is saved.
  await page.getByText('Edit the field list as JSON Schema').click()
  await page.getByLabel('Field list (JSON Schema)').fill('{"type": "object", "properties": {"total": {"type": "number", "minimum": 0}}}')
  await expect(page.getByText(/`minimum` isn.t supported by Anthropic.s structured outputs/)).toBeVisible()
})
