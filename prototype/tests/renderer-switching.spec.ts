import { expect, test } from '@playwright/test'

type Diagnostics = {
  readonly tick: number
  readonly result: 'running' | 'success' | 'failure'
  readonly metrics: { readonly p95Ms: number }
  readonly qualityState: { readonly level: string; readonly phase: string; readonly recoveryOutcome: string | null }
  readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]
  advance(ticks: number): void
}

const diagnostics = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: Diagnostics }).__TABLETOP_DIAGNOSTICS__)

test('switches among renderers while preserving the benchmark snapshot and returns to selection on a forced error', async ({ page }) => {
  await page.goto('?renderer=2d&enemies=100&seed=task6-switch&mode=benchmark')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: Diagnostics }).__TABLETOP_DIAGNOSTICS__.advance(2500))
  const first = await diagnostics(page)
  await page.goto('?renderer=hybrid&enemies=100&seed=task6-switch&mode=benchmark')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: Diagnostics }).__TABLETOP_DIAGNOSTICS__.advance(2500))
  const second = await diagnostics(page)
  expect(second.snapshotUnits).toEqual(first.snapshotUnits)

  await page.goto('?renderer=3d&enemies=100&seed=task6-switch&mode=benchmark&forceRendererError=1')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.getByRole('heading', { name: '1. 렌더러 선택' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText(/렌더러|renderer/i)
})

test('diagnostic advance does not stop normal ticks after restart', async ({ page }) => {
  await page.goto('?renderer=2d&enemies=300&seed=task6-resume&mode=benchmark')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: Diagnostics }).__TABLETOP_DIAGNOSTICS__.advance(2500))
  await page.getByRole('button', { name: '다시 시작' }).click()
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(0)
})

test('benchmark diagnostics expose measured frame p95 and a stable quality state', async ({ page }) => {
  await page.goto('?renderer=2d&enemies=100&seed=task6-metrics&mode=benchmark')
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
  await expect.poll(async () => (await diagnostics(page)).metrics.p95Ms).toBeGreaterThan(0)
  await expect.poll(async () => (await diagnostics(page)).qualityState).toMatchObject({ level: 'full', phase: 'ready' })
})
