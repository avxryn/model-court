/**
 * Multi-user collaboration spec — verifies two users sign in into
 * separate browser contexts and the app distinguishes them.
 *
 * `users(2)` takes any two accounts from your pool, so this spec passes on a
 * fresh app with no setup beyond having two test accounts:
 *   npx deepspace test accounts list
 *   npx deepspace test accounts create --email a@deepspace.test --name "A" --password-stdin
 *
 * Ask for accounts *by name* (`users(['Alice', 'Bob'])`) only when the
 * behaviour under test depends on which identity acts — otherwise naming them
 * couples the spec to one machine's pool.
 *
 * The `users` fixture handles sign-in caching (per-account storageState
 * persisted to `~/.deepspace/playwright-states/`), context creation, and
 * cleanup. No need to manage browser contexts manually.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

// A machine that has never created test accounts is the normal state of a
// fresh checkout, and there `users()` throws — turning "you have no pool yet"
// into three red tests about the app, which it is not. Skip the file instead
// and say what creates the pool. The count is of accounts usable HERE: the
// pool is global per developer, but passwords live only on the machine that
// created the account.
const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)

  // /home is dynamic (under src/pages/(app)/), so it mounts the nav shell;
  // '/' is the static landing and has no navigation.
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

  // Email, not name. The page renders the *session's* `name || email`, while
  // `user.name` here comes from the LOCAL account registry — and the two are
  // not the same fact: a display name is optional, and an account recovered on
  // another machine has none stored locally at all. The email is the credential
  // the context signed in with, so it is the one identity both sides agree on,
  // and asserting it proves the page is showing THIS browser's account.
  // The two accounts are distinct, so two exact matches is also the proof that
  // the contexts are not sharing one session.
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

    // The identity chip shows `name || email`. Its text is not predictable, but
    // its presence is: something must be there once the profile has loaded.
    // (It is `hidden sm:inline` in some templates, so assert text, not
    // visibility.)
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })

    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, {
      timeout: 15_000,
    })
  }
})

test('an evaluation created by one account is invisible to another', async ({ users }) => {
  const [owner, other] = await users(2)

  await owner.page.goto('/evaluations')
  await owner.page.getByRole('button', { name: /Open a new case/ }).first().click()
  const title = `E2E isolation ${Date.now()}`
  await owner.page.getByLabel('Title').fill(title)
  await owner.page.getByRole('button', { name: 'Open case' }).click()
  await expect(owner.page).toHaveURL(/\/evaluations\/[0-9a-f-]{36}$/, { timeout: 15_000 })
  await expect(owner.page.getByRole('heading', { name: title })).toBeVisible()
  const url = owner.page.url()

  // Same URL, different account: the uniform not-found page, never the draft.
  await other.page.goto(url)
  await expect(other.page.getByRole('heading', { name: 'Not found' })).toBeVisible({ timeout: 15_000 })
  await expect(other.page.getByText(title)).toHaveCount(0)
  await other.page.goto('/evaluations')
  await expect(other.page.getByText(title)).toHaveCount(0)
})

test('API keys page never shows a stored key and requires storage consent', async ({ users }) => {
  const [user] = await users(1)
  await user.page.goto('/settings/api-keys')
  await expect(user.page.getByRole('heading', { name: 'Provider API keys' })).toBeVisible({ timeout: 15_000 })
  await user.page.getByRole('button', { name: /Add key|Replace key/ }).first().click()
  const keyInput = user.page.getByLabel('API key')
  await expect(keyInput).toHaveAttribute('type', 'password')
  await keyInput.fill('sk-e2e-not-a-real-key')
  // Save stays disabled until the storage consent is given.
  await expect(user.page.getByRole('button', { name: /^Save key$/ })).toBeDisabled()
  await user.page.getByRole('button', { name: 'Cancel' }).click()
})
