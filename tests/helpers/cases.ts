import { expect, type Page } from '@playwright/test'

const CASE_PATH = /\/evaluations\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * Deletes every case a test account owns, through the app's own "Delete case…" flow, so the
 * signed-in specs never hit the 10-case limit however often they run (or fail). Test accounts only:
 * the accounts live in ~/.deepspace/test-accounts.json and hold nothing but these specs' cases.
 */
export async function clearCases(page: Page): Promise<void> {
  for (let round = 0; round < 15; round++) {
    await page.goto('/evaluations')
    await expect(page.getByRole('heading', { name: 'Your cases' })).toBeVisible()
    await expect(page.getByLabel('Loading your cases')).toHaveCount(0)
    const hrefs = await page.locator('a[href*="/evaluations/"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    const next = hrefs.find((href) => CASE_PATH.test(href))
    if (!next) return
    await page.goto(next)
    await page.getByRole('button', { name: 'Case actions' }).click()
    await page.getByRole('menuitem', { name: /Delete case/ }).click()
    const dialog = page.getByRole('dialog')
    const title = ((await dialog.getByRole('heading').first().textContent()) ?? '').replace(/^Delete “/, '').replace(/”\?$/, '')
    await dialog.getByLabel(/Type the title to confirm/).fill(title)
    await dialog.getByRole('button', { name: 'Delete permanently' }).click()
    await expect(page).toHaveURL(/\/evaluations$/)
  }
  throw new Error('clearCases: more than 15 cases, or a delete did not take effect')
}
