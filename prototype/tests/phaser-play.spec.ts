import { expect, test } from '@playwright/test'

type PlayDiagnostics = {
  readonly activeSquad: 'teal' | 'scarlet'
  readonly tick: number
  readonly result: 'running' | 'success' | 'failure'
  readonly unitPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  advance(ticks: number): void
}

async function start(page: import('@playwright/test').Page, enemies: 100 | 200 | 300): Promise<void> {
  await page.goto(`?renderer=2d&enemies=${enemies}&seed=play-check`)
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
}

async function diagnostics(page: import('@playwright/test').Page): Promise<PlayDiagnostics> {
  return page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: PlayDiagnostics }).__TABLETOP_DIAGNOSTICS__)
}

test('starts all documented enemy-count URLs and exports the active 2D JSON report', async ({ page }) => {
  for (const enemies of [100, 200, 300] as const) {
    await start(page, enemies)
    await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(0)
    const report = await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: { exportReport(): string } }).__TABLETOP_DIAGNOSTICS__.exportReport())
    expect(JSON.parse(report)).toMatchObject({ renderer: '2d', mode: 'manual' })
  }

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON 내보내기' }).click()
  expect((await download).suggestedFilename()).toBe('tabletop-2d-report.json')
})

test('moves with keyboard and pointer, then changes squads through Tab and the visible squad button', async ({ page }) => {
  await start(page, 100)
  const before = await diagnostics(page)
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(150)
  await page.keyboard.up('ArrowRight')
  await page.locator('.game-stage canvas').click({ position: { x: 700, y: 300 } })
  await page.waitForTimeout(150)
  const afterMove = await diagnostics(page)
  expect(afterMove.unitPositions['3'].x).toBeGreaterThan(before.unitPositions['3'].x)

  await page.keyboard.press('Tab')
  await expect.poll(async () => (await diagnostics(page)).activeSquad).toBe('scarlet')
  await page.getByRole('button', { name: '분대 전환' }).click()
  await expect.poll(async () => (await diagnostics(page)).activeSquad).toBe('teal')
})

test('uses deterministic diagnostic acceleration only for the 300-person terminal-state and restart check', async ({ page }) => {
  await start(page, 300)
  await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: PlayDiagnostics }).__TABLETOP_DIAGNOSTICS__.advance(2_500))
  await expect(page.getByRole('status')).toContainText(/승리|전멸/)
  await page.getByRole('button', { name: '다시 시작' }).click()
  await expect.poll(async () => (await diagnostics(page)).result).toBe('running')
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(0)
})
