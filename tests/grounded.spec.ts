/**
 * Answers from sources in the signed-in app (spec 05 §11, D-96). Needs one usable DeepSpace test
 * account and makes no provider call: it opens a case from the "Answers from sources" template,
 * checks the saved sources, the plain line about who gets them, the grounding key and the
 * required-source ticks on the Questions divider, the sources CSV import, and the Parties line.
 * The hearing itself (sources and chips on the worksheet, no check result before unsealing, the
 * record's quote findings) is covered by tests/integration/grounded-sources.test.ts on both
 * stores and the components by render tests.
 *
 *   npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin
 */
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 1, `Needs 1 usable test account, found ${usableTestAccounts}. Create one with \`npx deepspace test accounts create\`.`)

test('an answers-from-sources case carries its sources and grounding keys', async ({ users }) => {
  const [judge] = await users(1)
  const page = judge.page
  await page.goto('/evaluations')
  await page.getByRole('button', { name: 'Open a new case' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByText('Answers from sources').click()
  await dialog.getByRole('button', { name: 'Open case' }).click()
  await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/)

  await page.getByRole('tab', { name: /Questions/ }).click()
  await expect(page.getByText('Answers from sources', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/Sources are sent to every party.s provider and shown to your jurors/).first()).toBeVisible()
  await expect(page.getByText('Exhibits S1–S3').first()).toBeVisible()
  await expect(page.getByRole('radio', { name: /Partly/ }).nth(1)).toBeChecked()
  await expect(page.getByRole('checkbox', { name: /S1/ }).first()).toBeChecked()
  await expect(page.getByRole('button', { name: 'Import sources from CSV' })).toBeVisible()
  await expect(page.getByText(/minutes? of reading for each juror/).first()).toBeVisible()

  await page.getByRole('tab', { name: /Parties/ }).click()
  await expect(page.getByText(/The kit adds the citation format/)).toBeVisible()
})
