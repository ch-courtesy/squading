import { expect, test } from '@playwright/test'

type PlayDiagnostics = {
  readonly activeSquad: 'teal' | 'scarlet'
  readonly tick: number
  readonly result: 'running' | 'success' | 'failure'
  readonly unitPositions: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  readonly snapshotUnits: readonly { readonly id: number; readonly x: number; readonly y: number; readonly tint: number }[]
  advance(ticks: number): void
  exportReport(): string
}

async function start(page: import('@playwright/test').Page, enemies: 100 | 300): Promise<void> {
  await page.goto(`?renderer=3d&enemies=${enemies}&seed=three-play-check`)
  await page.getByRole('button', { name: '게임 시작' }).click()
  await expect(page.locator('.game-stage canvas')).toBeVisible()
}

async function diagnostics(page: import('@playwright/test').Page): Promise<PlayDiagnostics> {
  return page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: PlayDiagnostics }).__TABLETOP_DIAGNOSTICS__)
}

test('keeps the shared manual input, deterministic tick, report, and restart flow for real-time 3D', async ({ page }) => {
  await start(page, 100)
  const before = await diagnostics(page)
  await page.keyboard.down('ArrowRight')
  await page.waitForTimeout(150)
  await page.keyboard.up('ArrowRight')
  const afterMove = await diagnostics(page)
  expect(afterMove.unitPositions['3'].x).toBeGreaterThan(before.unitPositions['3'].x)
  expect(afterMove.tick).toBeGreaterThan(before.tick)
  await page.keyboard.press('Tab')
  await expect.poll(async () => (await diagnostics(page)).activeSquad).toBe('scarlet')

  const report = await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: PlayDiagnostics }).__TABLETOP_DIAGNOSTICS__.exportReport())
  expect(JSON.parse(report)).toMatchObject({ renderer: '3d', mode: 'manual' })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON 내보내기' }).click()
  expect((await download).suggestedFilename()).toBe('tabletop-3d-report.json')

  await page.getByRole('button', { name: '다시 시작' }).click()
  await expect.poll(async () => (await diagnostics(page)).result).toBe('running')
  await expect.poll(async () => (await diagnostics(page)).tick).toBeGreaterThan(0)
})

test('matches Phaser and 2.5D terminal snapshot facts for the identical benchmark input log', async ({ page }) => {
  const collectTerminal = async (renderer: '2d' | 'hybrid' | '3d') => {
    await page.goto(`?renderer=${renderer}&enemies=300&seed=shared-benchmark-terminal&mode=benchmark`)
    await page.getByRole('button', { name: '게임 시작' }).click()
    await expect(page.locator('.game-stage canvas')).toBeVisible()
    await page.evaluate(() => (window as unknown as Window & { __TABLETOP_DIAGNOSTICS__: PlayDiagnostics }).__TABLETOP_DIAGNOSTICS__.advance(2_500))
    await expect(page.getByRole('status')).toContainText(/승리|전멸/)
    const scene = await diagnostics(page)
    return { result: scene.result, tick: scene.tick, units: scene.snapshotUnits }
  }

  const phaser = await collectTerminal('2d')
  const hybrid = await collectTerminal('hybrid')
  const three = await collectTerminal('3d')
  expect(phaser.units).toHaveLength(318)
  expect(hybrid.units).toHaveLength(318)
  expect(three.units).toHaveLength(318)
  expect(three.units[0]).toEqual({ id: 1, x: expect.any(Number), y: expect.any(Number), tint: expect.any(Number) })
  expect(three).toEqual(phaser)
  expect(three).toEqual(hybrid)
})
