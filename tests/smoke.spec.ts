import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests covering both page kinds this template ships:
 *   - '/'      → the static landing (top level of src/pages/): no providers,
 *                so no auth fetch and no records WebSocket on load.
 *   - '/home'  → a dynamic page (under src/pages/(app)/): the providers mount,
 *                the nav shell renders, and the records WebSocket connects.
 *
 * The "static contract" test is the guardrail for the per-page opt-out: if
 * someone moves the providers back up into _app.tsx, it fails.
 */

/** Wait for the React app shell (present on every page). */
async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static landing loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('landing carries one title, one description, one canonical', async ({ page }) => {
    // <Seo> (src/pages/index.tsx, values from src/seo.ts) hoists these into
    // <head>. Exactly one of each: index.html ships no static description or
    // canonical, because React 19 would not dedupe against them on mount.
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: landing fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    // Only the DO room route counts — vite's own HMR socket is a dev artifact.
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('dynamic app boundary mounts on /home', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
  })

  test('sign-in button visible when logged out', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})

/** Scores every line of every sample testimony 2 (no notes needed), question by question. */
async function scoreSample(page: import('@playwright/test').Page) {
  for (let question = 0; question < 5; question++) {
    const twos = page.getByRole('radio', { name: /^2: / })
    await expect(twos).toHaveCount(6)
    // The visible digit sits over the visually hidden radio; click its label as a person would.
    for (let i = 0; i < 6; i++) await twos.nth(i).locator('xpath=..').click()
    if (question < 4) await page.getByRole('button', { name: 'Next question' }).click()
  }
}

test.describe('public sample (F19/T19)', () => {
  test('works signed out and makes no API or provider requests', async ({ page }) => {
    const calls: string[] = []
    page.on('request', (request) => {
      const url = request.url()
      if (url.includes('/api/') || url.includes('openai.com') || url.includes('anthropic.com')) calls.push(url)
    })
    await page.goto('/sample')
    await expect(page.getByText('Illustrative sample')).toBeVisible()
    const unseal = page.getByRole('button', { name: 'Unseal the record' })
    await expect(unseal).toBeDisabled()
    await expect(page.getByText('0 of 10 testimonies scored')).toBeVisible()
    await scoreSample(page)
    await expect(page.getByText('10 of 10 testimonies scored')).toBeVisible()
    await unseal.click()
    await expect(page.getByRole('heading', { name: 'Headline from your scores' })).toBeVisible()
    await expect(page.getByText('A tie: all 5 questions scored the same for both parties.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Who gave which testimony' })).toBeVisible()
    await expect(page.getByText('Judgment (example)').first()).toBeVisible()
    await page.getByRole('button', { name: 'Start the sample over' }).click()
    expect(calls).toEqual([])
  })
})

// WCAG 2.2 A/AA by axe on the public pages, light and dark (D-55). Signed-in
// pages need an account and are checked by hand.
test.describe('accessibility (axe, WCAG 2.2 AA)', () => {
  const axeSource = readFileSync(fileURLToPath(new URL('../node_modules/axe-core/axe.min.js', import.meta.url)), 'utf8')
  for (const path of ['/', '/sample', '/glossary', '/join', '/privacy', '/terms', '/accessibility']) {
    for (const theme of ['light', 'dark']) {
      test(`${path} (${theme}) has no WCAG A/AA violations`, async ({ browser }) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' })
        await context.addInitScript((t) => window.localStorage.setItem('mc.theme', t), theme)
        const page = await context.newPage()
        await page.goto(path, { waitUntil: 'networkidle' })
        await page.addScriptTag({ content: axeSource })
        const violations = await page.evaluate(async () => {
          const result = await (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })
          return result.violations.map((v) => `${v.id} (${v.nodes.length})`)
        })
        expect(violations).toEqual([])
        await context.close()
      })
    }
  }
  for (const theme of ['light', 'dark']) {
    test(`/sample unsealed (${theme}) has no WCAG A/AA violations`, async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: 'reduce' })
      await context.addInitScript((t) => window.localStorage.setItem('mc.theme', t), theme)
      const page = await context.newPage()
      await page.goto('/sample', { waitUntil: 'networkidle' })
      await scoreSample(page)
      await page.getByRole('button', { name: 'Unseal the record' }).click()
      await expect(page.getByRole('heading', { name: 'Headline from your scores' })).toBeVisible()
      await page.addScriptTag({ content: axeSource })
      const violations = await page.evaluate(async () => {
        const result = await (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; nodes: unknown[] }> }> } }).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] })
        return result.violations.map((v) => `${v.id} (${v.nodes.length})`)
      })
      expect(violations).toEqual([])
      await context.close()
    })
  }
})
