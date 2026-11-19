/**
 * Tool use with mock tools in the signed-in app (spec 06 §11.3, D-103). Needs one usable DeepSpace
 * test account and makes no provider call: it opens a case from the "Tool use (mock tools)"
 * template, checks the tools editor and its never-sent labels, uses "Try a call" (a pure browser
 * function), and sees that Start is refused for unchecked routes. The browser suite has no fake
 * provider, so a generated tool hearing (the trace on the worksheet, the record) is covered by
 * tests/integration/tool-loop.test.ts on both stores and the components by render tests.
 *
 *   npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin
 */
import { expect, loadAllTestAccounts, test } from 'deepspace/testing'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(usableTestAccounts < 1, `Needs 1 usable test account, found ${usableTestAccounts}. Create one with \`npx deepspace test accounts create\`.`)

for (const width of [1280, 390]) {
  test(`a tool-use case: tools, canned responses and "Try a call" (${width} px)`, async ({ users }) => {
    const [judge] = await users(1)
    const page = judge.page
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/evaluations')
    await page.getByRole('button', { name: 'Open a new case' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByText('Tool use (mock tools)').click()
    await dialog.getByRole('button', { name: 'Open case' }).click()
    await expect(page).toHaveURL(/\/evaluations\/[0-9a-f-]+$/)

    await page.getByRole('tab', { name: /Questions/ }).click()
    await expect(page.getByText(/names, descriptions and argument schemas are sent to the models/).first()).toBeVisible()
    await expect(page.getByText(/never sent to the models; checked for free after each answer/).first()).toBeVisible()
    await expect(page.getByText('Each party may make up to 4 calls to its model for this question.').first()).toBeVisible()

    const tryIt = page.getByRole('region', { name: 'Try a call' }).first()
    await tryIt.getByLabel('Arguments').fill('{"order_id": "a-1042 "}')
    await tryIt.getByRole('button', { name: 'Try it' }).click()
    await expect(tryIt.getByText('Matched response 1.')).toBeVisible()
    await tryIt.getByLabel('Arguments').fill('{}')
    await tryIt.getByRole('button', { name: 'Try it' }).click()
    await expect(tryIt.getByText(/the error response is sent: `order_id` is required/)).toBeVisible()

    // No route has a recorded live tool check yet, so Start names the missing check.
    await expect(page.getByText(/hasn't passed a live tool check yet/).first()).toBeVisible()
  })
}
